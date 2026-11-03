import { API_BASE } from './config';
import type { VideoInfo } from './types';

type VideoInfoResponse = { success: boolean; data?: VideoInfo; error?: string };

export async function fetchVideoInfo(url: string): Promise<VideoInfo> {
  const response = await fetch(`${API_BASE}/video-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await response.json() as VideoInfoResponse;
  if (!response.ok || !data.success || !data.data) {
    throw new Error(data.error || 'Failed to fetch video information');
  }
  return data.data;
}

export function getDownloadUrl(sourceUrl: string, filename: string): string {
  return `${API_BASE}/download?url=${encodeURIComponent(sourceUrl)}&filename=${encodeURIComponent(filename)}`;
}

// Server-side yt-dlp download (YouTube / Facebook / Instagram): the server
// fetches + merges the best streams, so we pass the page URL and format id.
export function getYtdlpDownloadUrl(pageUrl: string, formatId: string, filename: string): string {
  return `${API_BASE}/download-ytdlp?url=${encodeURIComponent(pageUrl)}&selector=${encodeURIComponent(formatId)}&filename=${encodeURIComponent(filename)}`;
}

export function getPreviewUrl(sourceUrl: string): string {
  return `${API_BASE}/preview?url=${encodeURIComponent(sourceUrl)}`;
}
