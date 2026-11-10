export const API_BASE = '/api';
export const DEFAULT_AVATAR = '/favicon.svg';
export const DOWNLOAD_FILE_EXTENSION = '.mp4';

export type PlatformId = 'tiktok' | 'douyin' | 'youtube' | 'facebook' | 'instagram';

export const PLATFORM_META: Record<PlatformId, { name: string; color: string }> = {
  tiktok: { name: 'TikTok', color: '#fe2c55' },
  douyin: { name: 'Douyin', color: '#161823' },
  youtube: { name: 'YouTube', color: '#ff0000' },
  facebook: { name: 'Facebook', color: '#1877f2' },
  instagram: { name: 'Instagram', color: '#c13584' },
};

const PLATFORM_HOSTS: Array<[PlatformId, string[]]> = [
  ['tiktok', ['tiktok.com']],
  ['douyin', ['douyin.com', 'iesdouyin.com']],
  ['youtube', ['youtube.com', 'youtu.be', 'youtube-nocookie.com']],
  ['facebook', ['facebook.com', 'fb.watch']],
  ['instagram', ['instagram.com', 'instagr.am']],
];

export function detectPlatformId(value: string): PlatformId | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const [id, hosts] of PLATFORM_HOSTS) {
      if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return id;
    }
    return null;
  } catch {
    return null;
  }
}
