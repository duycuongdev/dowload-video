import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Get video info from TikTok URL
app.post('/api/video-info', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const response = await axios.post(
      'https://www.tikwm.com/api/',
      new URLSearchParams({ url, hd: 1 }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 30000,
      }
    );

    const data = response.data;

    if (data.code !== 0) {
      return res.status(400).json({ error: data.msg || 'Failed to fetch video info' });
    }

    const videoData = data.data;

    const formatUrl = (path) => {
      if (!path) return null;
      if (path.startsWith('http')) return path;
      return `https://www.tikwm.com${path.startsWith('/') ? '' : '/'}${path}`;
    };

    // Build response with video info
    const result = {
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

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching video info:', error.message);
    res.status(500).json({ error: 'Failed to fetch video info. Please try again.' });
  }
});

// Proxy download endpoint to avoid CORS
app.get('/api/download', async (req, res) => {
  const { url, filename } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 120000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tikwm.com/',
      },
    });

    const contentType = response.headers['content-type'] || 'video/mp4';
    const safeName = filename || 'tiktok_video.mp4';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (error) {
    console.error('Error downloading:', error.message);
    res.status(500).json({ error: 'Download failed. Please try again.' });
  }
});

// Proxy for preview video (no download header)
app.get('/api/preview', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tikwm.com/',
      },
    });

    const contentType = response.headers['content-type'] || 'video/mp4';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (error) {
    console.error('Error proxying preview:', error.message);
    res.status(500).json({ error: 'Preview failed' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 TikTok Downloader API running on http://localhost:${PORT}`);
});
