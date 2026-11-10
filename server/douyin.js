import { createHash, randomUUID } from 'node:crypto';
import { detectPlatform } from './platforms.js';

const DOUYIN_ORIGIN = 'https://www.douyin.com';
const DOUYIN_AID = '6383';
const DOUYIN_SEC_SALT = 'A96D855A08C0A9707F8BEF0D9A527E4E';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function getDouyinInfo(pageUrl) {
  const sourceUrl = await resolveDouyinUrl(pageUrl);
  const videoId = sourceUrl.match(/\/video\/(\d+)/)?.[1];
  const session = await createGuestSession();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const query = new URLSearchParams({
    aweme_id: videoId,
    aid: DOUYIN_AID,
    uifid: session.uifid,
    timestamp,
  });
  const signature = createHash('md5')
    .update(`${session.uifid}_${timestamp}_${DOUYIN_SEC_SALT}_${query}`)
    .digest('hex');
  query.set('x-secsdk-web-signature', signature);

  const response = await fetch(`${DOUYIN_ORIGIN}/aweme/v1/web/aweme/detail/?${query}`, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: `${DOUYIN_ORIGIN}/`,
      Cookie: `passport_csrf_token=${randomUUID().replaceAll('-', '')}; ${session.ttwid}`,
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Douyin returned HTTP ${response.status}`);
  const payload = await response.json();
  const detail = payload.aweme_detail;
  if (!detail) {
    throw new Error(payload.status_msg || 'Douyin could not provide this video. It may be private or unavailable.');
  }

  const video = detail.video || {};
  const bitRates = (video.bit_rate || [])
    .filter((rate) => firstUrl(rate.play_addr))
    .sort((a, b) =>
      (b.quality_type || 0) - (a.quality_type || 0) ||
      ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)) ||
      (b.data_size || 0) - (a.data_size || 0)
    );
  const videoUrl = firstUrl(video.play_addr);
  const hdVideoUrl = firstUrl(bitRates[0]?.play_addr) || videoUrl;
  if (!hdVideoUrl) throw new Error('This Douyin post does not contain a downloadable video.');

  return {
    id: detail.aweme_id || videoId,
    title: detail.desc || 'Douyin video',
    duration: video.duration ? Math.round(video.duration / 1000) : undefined,
    cover: firstUrl(video.cover) || firstUrl(detail.cover_url?.[0]),
    author: {
      name: detail.author?.nickname || detail.author?.unique_id || 'Unknown',
      username: detail.author?.unique_id || detail.author?.short_id || 'unknown',
      avatar: firstUrl(detail.author?.avatar_thumb),
    },
    stats: {
      plays: detail.statistics?.play_count,
      likes: detail.statistics?.digg_count,
      comments: detail.statistics?.comment_count,
      shares: detail.statistics?.share_count,
    },
    videoUrl,
    hdVideoUrl,
    wmVideoUrl: firstUrl(video.download_addr),
    previewUrl: videoUrl || hdVideoUrl,
    sourceUrl,
    music: {
      title: detail.music?.title,
      author: detail.music?.author,
      url: firstUrl(detail.music?.play_url),
      cover: firstUrl(detail.music?.cover_hd),
    },
  };
}

async function resolveDouyinUrl(pageUrl) {
  let current = new URL(pageUrl);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const id = extractVideoId(current);
    if (id) return `${DOUYIN_ORIGIN}/video/${id}`;

    const response = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30000),
    });
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) break;
    current = new URL(location, current);
    if (detectPlatform(current.href)?.id !== 'douyin') {
      throw new Error('The Douyin share link redirected to an unsupported URL.');
    }
  }
  throw new Error('Could not resolve a Douyin video from this URL.');
}

function extractVideoId(url) {
  return url.pathname.match(/\/(?:video|note|share\/video)\/(\d+)/)?.[1] || null;
}

async function createGuestSession() {
  const register = await fetch(`${DOUYIN_ORIGIN}/ttwid/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ aid: Number(DOUYIN_AID), service: 'www.douyin.com' }),
    signal: AbortSignal.timeout(30000),
  });
  await register.body?.cancel();
  if (!register.ok) throw new Error(`Douyin guest session returned HTTP ${register.status}`);
  const cookies = register.headers.getSetCookie?.() || [register.headers.get('set-cookie') || ''];
  const ttwid = cookies.map((cookie) => cookie.split(';')[0]).find((cookie) => cookie.startsWith('ttwid='));
  if (!ttwid) throw new Error('Douyin did not provide a guest session cookie.');

  const home = await fetch(`${DOUYIN_ORIGIN}/`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  });
  await home.body?.cancel();
  const uifid = home.headers.get('x-tt-trace-host');
  if (!uifid) throw new Error('Douyin did not provide the required guest request identifier.');
  return { ttwid, uifid };
}

function firstUrl(source) {
  return source?.url_list?.find((url) => typeof url === 'string' && url.startsWith('https://')) || null;
}
