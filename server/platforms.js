// Platform detection shared by the API routes.

export const PLATFORMS = {
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    engine: 'tikwm',
    color: '#111111',
    hosts: ['tiktok.com'],
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    engine: 'ytdlp',
    color: '#ff0000',
    hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'm.youtube.com'],
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    engine: 'ytdlp',
    color: '#1877f2',
    hosts: ['facebook.com', 'fb.watch', 'm.facebook.com', 'web.facebook.com'],
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    engine: 'ytdlp',
    color: '#c13584',
    hosts: ['instagram.com', 'instagr.am', 'ddinstagram.com'],
  },
};

export function detectPlatform(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const platform of Object.values(PLATFORMS)) {
    if (platform.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return platform;
    }
  }
  return null;
}
