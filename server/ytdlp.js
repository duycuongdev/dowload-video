import { mkdir, readdir, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ytdl from 'youtube-dl-exec';
import ffmpegPath from 'ffmpeg-static';
import { detectPlatform } from './platforms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_FORMATS = 6;

// Best-quality selector: prefer H.264/AAC (mp4) for player compatibility,
// fall back to any video+audio, then to the best pre-merged stream.
const BEST_FORMAT_SELECTOR = 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b';

// Login cookies for Facebook/Instagram content that blocks anonymous
// visitors. Populated by refresh-fb-cookies.bat (see README).
const COOKIE_PROFILE_DIR = path.join(__dirname, 'cookies', 'fb-profile');
const COOKIE_PLATFORMS = new Set(['facebook', 'instagram']);
const HAS_COOKIE_PROFILE = existsSync(path.join(COOKIE_PROFILE_DIR, 'Network', 'Cookies'));
const LOGIN_COOKIE_FLAG = HAS_COOKIE_PROFILE
  ? { cookiesFromBrowser: `chromium:${COOKIE_PROFILE_DIR}` }
  : {};

export function buildFormatSelector(selection) {
  if (!selection || selection === 'best') return BEST_FORMAT_SELECTOR;
  // Prefer AAC audio for maximum mp4 player compatibility, fall back to any.
  return `${selection}+ba[ext=m4a]/${selection}+ba/${selection}/b`;
}

// Links copied from the Facebook app (/share/v/<id>, /share/r/<id>) are not
// recognized by yt-dlp; try the pasted URL first, then canonical rewrites.
export function buildAttemptUrls(pageUrl) {
  const attempts = [pageUrl];
  const platform = detectPlatform(pageUrl);
  if (platform?.id === 'facebook') {
    const shareId = pageUrl.match(/facebook\.com\/share\/[rv]\/([^/?#]+)/i)?.[1];
    if (shareId && /^\d+$/.test(shareId)) {
      attempts.push(
        `https://www.facebook.com/reel/${shareId}/`,
        `https://www.facebook.com/watch/?v=${shareId}`
      );
    }
  }
  return attempts;
}

function cookieFlagFor(pageUrl) {
  const platform = detectPlatform(pageUrl);
  return platform && COOKIE_PLATFORMS.has(platform.id) ? LOGIN_COOKIE_FLAG : {};
}

export async function getYtdlpInfo(pageUrl) {
  const cookieFlag = cookieFlagFor(pageUrl);
  let lastError = null;

  for (const url of buildAttemptUrls(pageUrl)) {
    try {
      const raw = await ytdl(url, {
        dumpSingleJson: true,
        noPlaylist: true,
        noWarnings: true,
        noCheckCertificates: true,
        socketTimeout: 30,
        ...cookieFlag,
      });
      return { ...mapYtdlpInfo(raw), sourceUrl: url };
    } catch (error) {
      lastError = error;
    }
  }
  throw translateError(lastError);
}

function mapYtdlpInfo(raw) {
  return {
    id: raw.id,
    title: raw.title,
    duration: raw.duration,
    cover: raw.thumbnail || null,
    author: {
      name: raw.uploader || raw.channel || raw.uploader_id || 'Unknown',
      username: raw.uploader_id || raw.channel_id || 'unknown',
      avatar: null,
    },
    stats: {
      plays: raw.view_count,
      likes: raw.like_count,
    },
    formats: pickVideoFormats(raw),
    // Best pre-merged (video+audio in one stream) format for in-browser preview.
    previewUrl: findProgressiveFormat(raw)?.url || null,
    bestSelector: BEST_FORMAT_SELECTOR,
  };
}

function pickVideoFormats(raw) {
  const videoFormats = (raw.formats || []).filter(
    (f) => f.vcodec && f.vcodec !== 'none' && f.ext !== 'mhtml' && f.height
  );

  // Quality is labeled by the short side: landscape 3840x2160 -> "2160p",
  // vertical 1080x1920 -> "1080p".
  const qualityHeight = (f) =>
    f.width && f.height ? Math.min(f.width, f.height) : f.height;

  const byQuality = new Map();
  for (const format of videoFormats) {
    const q = qualityHeight(format);
    const current = byQuality.get(q);
    if (!current || formatRank(format) > formatRank(current)) {
      byQuality.set(q, format);
    }
  }

  return [...byQuality.entries()]
    .sort((a, b) => b[0] - a[0] || (b[1].fps || 0) - (a[1].fps || 0))
    .slice(0, MAX_FORMATS)
    .map(([q, f]) => ({
      formatId: String(f.format_id),
      height: q,
      fps: f.fps || null,
      label: `${q}p${f.fps && f.fps > 30 ? f.fps : ''}`,
      filesize: f.filesize || approximateSize(f, raw.duration),
      hasAudio: Boolean(f.acodec && f.acodec !== 'none'),
    }));
}

function formatRank(format) {
  // Prefer direct https streams over HLS (m3u8): faster and more reliable.
  const protocolBonus = (format.protocol || '').includes('m3u8') ? -100 : 0;
  return (format.fps || 0) * 10000 + (format.tbr || 0) + protocolBonus;
}

function findProgressiveFormat(raw) {
  const candidates = (raw.formats || []).filter(
    (f) =>
      f.vcodec && f.vcodec !== 'none' &&
      f.acodec && f.acodec !== 'none' &&
      f.url && f.ext !== 'mhtml'
  );
  return candidates
    .filter((f) => (f.height || 0) <= 720)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0] || null;
}

function approximateSize(format, duration) {
  if (!format.tbr || !duration) return null;
  return Math.round((format.tbr * duration * 1000) / 8);
}

// Downloads via yt-dlp into a fresh temp dir (merge needs ffmpeg and seeks
// in both streams, so piping to stdout is not possible). Returns the single
// merged file plus a cleanup function the caller MUST call after streaming.
export async function downloadViaYtdlp(pageUrl, formatSelector = BEST_FORMAT_SELECTOR) {
  const cookieFlag = cookieFlagFor(pageUrl);
  let lastError = null;

  for (const url of buildAttemptUrls(pageUrl)) {
    const tmpDir = path.join(
      os.tmpdir(),
      `videosave-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    await mkdir(tmpDir, { recursive: true });

    try {
      await ytdl.exec(url, {
        f: formatSelector,
        mergeOutputFormat: 'mp4',
        ffmpegLocation: ffmpegPath || undefined,
        o: path.join(tmpDir, 'video.%(ext)s'),
        noPlaylist: true,
        noWarnings: true,
        noCheckCertificates: true,
        restrictFilenames: true,
        ...cookieFlag,
      });

      const files = await readdir(tmpDir);
      if (files.length === 0) {
        throw new Error('yt-dlp produced no output file');
      }
      return {
        filePath: path.join(tmpDir, files[0]),
        cleanup: () => rm(tmpDir, { recursive: true, force: true }),
      };
    } catch (error) {
      lastError = error;
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
  throw translateError(lastError);
}

export function createYtdlpStream(filePath) {
  return createReadStream(filePath);
}

function translateError(error) {
  const message = [error?.message, error?.stderr].filter(Boolean).join(' ');
  if (/confirm you'?re not a bot|Sign in to confirm/i.test(message)) {
    return new Error('YouTube is asking for verification for this video. Try another video or retry later.');
  }
  if (/Cannot parse data/i.test(message)) {
    return new Error(
      'Facebook blocked extraction of this video — it usually requires login. ' +
      'Run refresh-fb-cookies.bat once (accept the Windows prompt) and restart the app.'
    );
  }
  if (/private video|login required|requested content is not available|requires authentication/i.test(message)) {
    return new Error('This content is private or requires a logged-in account.');
  }
  if (/unsupported url/i.test(message)) {
    return new Error('This URL format is not supported.');
  }
  if (/age|confirm your age/i.test(message)) {
    return new Error('This video is age-restricted and cannot be downloaded without sign-in.');
  }
  if (/http error (\d+)/i.test(message)) {
    const code = message.match(/http error (\d+)/i)[1];
    return new Error(`The platform returned HTTP ${code}. The video may be unavailable.`);
  }
  return new Error(error?.message || 'Failed to download video via yt-dlp');
}
