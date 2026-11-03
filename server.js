import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { stat } from 'node:fs/promises';
import { detectPlatform } from './server/platforms.js';
import {
  getYtdlpInfo,
  downloadViaYtdlp,
  createYtdlpStream,
  buildFormatSelector,
} from './server/ytdlp.js';

const TIKWM_API = 'https://www.tikwm.com/api/';
const TIKWM_ORIGIN = 'https://www.tikwm.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:']);
const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

const app = express();
const PORT = 3001;

app.use(cors({ origin: true }));
app.use(express.json({ limit: '8kb' }));

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
    // Music info
    music: {
      title: videoData.music_info?.title || 'Unknown',
      author: videoData.music_info?.author || 'Unknown',
      url: formatUrl(videoData.music_info?.play),
      cover: formatUrl(videoData.music_info?.cover),
    },
    // Image slideshow (if applicable)
    images: videoData.images?.map(formatUrl) || [],
  };
}

// Proxy download endpoint to avoid CORS
app.get('/api/download', (req, res) => proxyMedia(req, res, true, 120000));

// Proxy for preview video (no download header)
app.get('/api/preview', (req, res) => proxyMedia(req, res, false, 60000));

// Download via yt-dlp (YouTube / Facebook / Instagram): the best-quality
// streams are separate video+audio, so yt-dlp merges them to a temp file first.
app.get('/api/download-ytdlp', async (req, res) => {
  const { url, selector, filename } = req.query;

  const platform = typeof url === 'string' ? detectPlatform(url) : null;
  if (!platform || platform.engine !== 'ytdlp') {
    return res.status(400).json({ error: 'A supported YouTube/Facebook/Instagram URL is required' });
  }
  if (typeof selector !== 'string' || !selector || selector.length > 200 || selector.startsWith('-')) {
    return res.status(400).json({ error: 'A valid format selector is required' });
  }

  try {
    const { filePath, cleanup } = await downloadViaYtdlp(url, buildFormatSelector(selector));
    try {
      const fileStat = await stat(filePath);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`);
      res.setHeader('Content-Length', fileStat.size);
      res.on('close', cleanup);
      createYtdlpStream(filePath).pipe(res);
    } catch (streamError) {
      cleanup();
      throw streamError;
    }
  } catch (error) {
    console.error('Error downloading via yt-dlp:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Download failed. Please try again.' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`VideoSave API running on http://localhost:${PORT}`);
});

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
  return cleaned.endsWith('.mp4') ? cleaned : `${cleaned}.mp4`;
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
