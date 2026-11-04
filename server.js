import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { createRequire } from 'node:module';
import path from 'node:path';
import { stat, readdir, rm } from 'node:fs/promises';
import { detectPlatform } from './server/platforms.js';

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver'); // archiver v8: class-based API
import {
  getYtdlpInfo,
  downloadViaYtdlp,
  createYtdlpStream,
  createYtdlpTempDir,
  buildFormatSelector,
  scheduleYtdlpAutoUpdate,
} from './server/ytdlp.js';

const TIKWM_API = 'https://www.tikwm.com/api/';
const TIKWM_ORIGIN = 'https://www.tikwm.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:']);
const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const HOST = '127.0.0.1'; // local tool: never expose downloads (or cookies) to the LAN
const MAX_CONCURRENT_MERGES = 2; // ffmpeg merge is CPU/RAM heavy

const app = express();
const PORT = 3001;

// Only the local dev UI may read responses cross-origin; requests without an
// Origin header (curl, same-origin via the vite proxy) are unaffected.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(cors({ origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin)) }));
app.use(express.json({ limit: '8kb' }));

// ---- Download job tracking (SSE progress + simple FIFO queue) ----

const jobs = new Map(); // jobId -> { phase, percent, downloaded, expected, speed, error }

function setJobPhase(jobId, phase) {
  const job = jobs.get(jobId);
  if (job) {
    job.phase = phase;
    if (phase === 'done' || phase === 'error') {
      setTimeout(() => jobs.delete(jobId), 60000).unref();
    }
  }
}

async function dirSize(dir) {
  try {
    const entries = await readdir(dir);
    let total = 0;
    for (const name of entries) {
      try {
        total += (await stat(path.join(dir, name))).size;
      } catch { /* file vanished between readdir and stat */ }
    }
    return total;
  } catch {
    return 0;
  }
}

// Polls the temp dir once per second: yt-dlp writes partial files there while
// downloading, so directory size is a reliable progress signal without having
// to parse yt-dlp output.
function startProgressPoller(jobId, tmpDir, expectedSize) {
  const job = jobs.get(jobId);
  let lastBytes = 0;
  let lastTime = Date.now();
  const margin = 1.1; // selector also fetches the audio track (~10% more)
  const timer = setInterval(async () => {
    const bytes = await dirSize(tmpDir);
    const now = Date.now();
    if (bytes === lastBytes) {
      if (job.phase === 'downloading' && bytes > 0) job.phase = 'merging';
      return;
    }
    job.downloaded = bytes;
    job.speed = Math.max(0, Math.round((bytes - lastBytes) / ((now - lastTime) / 1000)));
    lastBytes = bytes;
    lastTime = now;
    if (expectedSize > 0) {
      const ratio = bytes / (expectedSize * margin);
      job.percent = Math.min(97, Math.round(ratio * 100));
      job.phase = ratio >= 0.97 ? 'merging' : 'downloading';
    } else {
      job.phase = 'downloading';
      job.percent = null;
    }
  }, 1000);
  return () => clearInterval(timer);
}

const downloadSlots = { active: 0, waiting: [] };

async function acquireSlot(jobId) {
  downloadSlots.waiting.push(jobId);
  while (downloadSlots.active >= MAX_CONCURRENT_MERGES || downloadSlots.waiting[0] !== jobId) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  downloadSlots.waiting.shift();
  downloadSlots.active++;
}

// Get video info from any supported platform URL
app.post('/api/video-info', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return res.status(400).json({
      error: 'Unsupported platform. Supported: TikTok, YouTube, Facebook, Instagram.',
    });
  }

  try {
    const info = platform.engine === 'tikwm'
      ? await fetchTikwmInfo(url)
      : await getYtdlpInfo(url);
    res.json({ success: true, data: { ...info, platform: platform.id } });
  } catch (error) {
    console.error(`Error fetching ${platform.id} video info:`, error.message);
    res.status(500).json({
      error: error.message || 'Failed to fetch video info. Please try again.',
    });
  }
});

async function fetchTikwmInfo(url) {
  const response = await axios.post(
    TIKWM_API,
    new URLSearchParams({ url, hd: '1' }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      timeout: 30000,
    }
  );

  const data = response.data;

  if (data.code !== 0) {
    throw new Error(data.msg || 'Failed to fetch video info');
  }

  const videoData = data.data;

  const formatUrl = (path) => {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return `${TIKWM_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
  };

  return {
    id: videoData.id,
    title: videoData.title,
    duration: videoData.duration,
    author: {
      name: videoData.author?.nickname || videoData.author?.unique_id || 'Unknown',
      username: videoData.author?.unique_id || 'unknown',
      avatar: formatUrl(videoData.author?.avatar),
    },
    stats: {
      plays: videoData.play_count,
      likes: videoData.digg_count,
      comments: videoData.comment_count,
      shares: videoData.share_count,
    },
    cover: formatUrl(videoData.cover),
    originCover: formatUrl(videoData.origin_cover),
    // Video URLs
    videoUrl: formatUrl(videoData.play),
    hdVideoUrl: formatUrl(videoData.hdplay),
    wmVideoUrl: formatUrl(videoData.wmplay),
    // Photo slideshow (when the post is images only)
    images: videoData.images?.map(formatUrl) || [],
    // Music info
    music: {
      title: videoData.music_info?.title || 'Unknown',
      author: videoData.music_info?.author || 'Unknown',
      url: formatUrl(videoData.music_info?.play),
      cover: formatUrl(videoData.music_info?.cover),
    },
  };
}

// Proxy download endpoint to avoid CORS
app.get('/api/download', (req, res) => proxyMedia(req, res, true, 120000));

// Proxy for preview video (no download header)
app.get('/api/preview', (req, res) => proxyMedia(req, res, false, 60000));

// Live download progress (SSE). The frontend picks the jobId itself and
// subscribes right after starting the download request.
app.get('/api/progress/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = () => {
    const job = jobs.get(jobId) || { phase: 'starting' };
    if (job.phase === 'queued') {
      job.position = downloadSlots.waiting.indexOf(jobId) + 1;
    }
    res.write(`data: ${JSON.stringify(job)}\n\n`);
    if (job.phase === 'done' || job.phase === 'error') {
      clearInterval(timer);
      res.end();
    }
  };
  const timer = setInterval(send, 1000);
  send();
  req.on('close', () => clearInterval(timer));
});

// Download via yt-dlp (YouTube / Facebook / Instagram): the best-quality
// streams are separate video+audio, so yt-dlp merges them to a temp file first.
app.get('/api/download-ytdlp', async (req, res) => {
  const { url, selector, filename, job: jobId, expected } = req.query;

  const platform = typeof url === 'string' ? detectPlatform(url) : null;
  if (!platform || platform.engine !== 'ytdlp') {
    return res.status(400).json({ error: 'A supported YouTube/Facebook/Instagram URL is required' });
  }
  if (typeof selector !== 'string' || !selector || selector.length > 200 || selector.startsWith('-')) {
    return res.status(400).json({ error: 'A valid format selector is required' });
  }

  const tracked = typeof jobId === 'string' && /^[a-f0-9-]{8,64}$/i.test(jobId);
  const releaseSlot = () => { downloadSlots.active--; };
  let stopPoller = () => {};
  let tmpDir = null;

  if (tracked) {
    const expectedSize = Number(expected) || 0;
    jobs.set(jobId, { phase: 'queued', percent: 0, downloaded: 0, expected: expectedSize, speed: 0 });
    await acquireSlot(jobId);
    setJobPhase(jobId, 'downloading');
    tmpDir = await createYtdlpTempDir();
    stopPoller = startProgressPoller(jobId, tmpDir, expectedSize);
  }

  try {
    const { filePath, cleanup } = await downloadViaYtdlp(url, buildFormatSelector(selector), tmpDir);
    try {
      const fileStat = await stat(filePath);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`);
      res.setHeader('Content-Length', fileStat.size);
      res.on('close', () => {
        stopPoller();
        if (tracked) {
          setJobPhase(jobId, 'done');
          releaseSlot();
        }
        cleanup();
      });
      if (tracked) setJobPhase(jobId, 'saving');
      createYtdlpStream(filePath).pipe(res);
    } catch (streamError) {
      stopPoller();
      cleanup();
      if (tracked) releaseSlot();
      throw streamError;
    }
  } catch (error) {
    stopPoller();
    if (tracked) {
      const job = jobs.get(jobId);
      if (job) {
        job.phase = 'error';
        job.error = error.message;
        setTimeout(() => jobs.delete(jobId), 60000).unref();
      }
      releaseSlot();
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    console.error('Error downloading via yt-dlp:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Download failed. Please try again.' });
    }
  }
});

// TikTok photo slideshow: fetch all images server-side and stream a zip.
app.get('/api/images-zip', async (req, res) => {
  const { url, filename } = req.query;
  const platform = typeof url === 'string' ? detectPlatform(url) : null;
  if (!platform || platform.id !== 'tiktok') {
    return res.status(400).json({ error: 'A TikTok URL is required' });
  }

  let images;
  try {
    images = (await fetchTikwmInfo(url)).images || [];
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to fetch post info' });
  }
  if (images.length === 0) {
    return res.status(400).json({ error: 'This post contains no photos' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`);
  const archive = new ZipArchive({ zlib: { level: 0 } }); // images are already compressed
  archive.pipe(res);

  let saved = 0;
  for (let i = 0; i < images.length; i++) {
    try {
      const response = await axios.get(images[i], {
        responseType: 'stream',
        timeout: 30000,
        headers: { 'User-Agent': USER_AGENT, Referer: TIKWM_ORIGIN },
      });
      const ext = extensionFromUrl(images[i]) || 'jpg';
      archive.append(response.data, { name: `photo_${String(i + 1).padStart(2, '0')}.${ext}` });
      saved++;
    } catch (error) {
      console.warn(`Image ${i + 1}/${images.length} failed: ${error.message}`);
    }
  }

  if (saved === 0) {
    archive.abort();
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to fetch any photos' });
    }
    return res.end();
  }
  await archive.finalize();
});

app.listen(PORT, HOST, () => {
  scheduleYtdlpAutoUpdate();
  console.log(`VideoSave API running on http://localhost:${PORT} (bound to ${HOST})`);
});

function extensionFromUrl(value) {
  try {
    const match = new URL(value).pathname.match(/\.(jpe?g|png|webp|heic)$/i);
    return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : null;
  } catch {
    return null;
  }
}

function isPrivateHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return true;
  if (/^(10|127)\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  return false;
}

function isAllowedMediaUrl(value) {
  try {
    const parsed = new URL(value);
    return ALLOWED_URL_SCHEMES.has(parsed.protocol) && !isPrivateHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function sanitizeFilename(value) {
  const fallback = 'video.mp4';
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const cleaned = value.replace(/[\r\n\"\\\\/]/g, '').replace(/[^\w.-]/g, '_').slice(0, 80);
  if (/\.(mp4|mp3|m4a|jpg|jpeg|png|webp|zip)$/i.test(cleaned)) {
    return cleaned.replace(/\.jpeg$/i, '.jpg');
  }
  return `${cleaned}.mp4`;
}

async function proxyMedia(req, res, asAttachment, timeout) {
  const { url, filename } = req.query;

  if (!url || typeof url !== 'string' || !isAllowedMediaUrl(url)) {
    return res.status(400).json({ error: 'A valid media URL is required' });
  }

  try {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout,
      headers: {
        'User-Agent': USER_AGENT,
        Referer: TIKWM_ORIGIN,
      },
    });

    const contentType = response.headers['content-type'] || 'video/mp4';
    res.setHeader('Content-Type', contentType);
    if (asAttachment) {
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`);
    } else {
      res.setHeader('Accept-Ranges', 'bytes');
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    response.data.pipe(res);
  } catch (error) {
    console.error(asAttachment ? 'Error downloading:' : 'Error proxying preview:', error.message);
    res.status(500).json({ error: asAttachment ? 'Download failed. Please try again.' : 'Preview failed' });
  }
}
