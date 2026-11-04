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
// jobId/expected enable live progress via /api/progress/:jobId (SSE).
export function getYtdlpDownloadUrl(
  pageUrl: string,
  formatId: string,
  filename: string,
  jobId?: string,
  expectedSize?: number
): string {
  let target = `${API_BASE}/download-ytdlp?url=${encodeURIComponent(pageUrl)}&selector=${encodeURIComponent(formatId)}&filename=${encodeURIComponent(filename)}`;
  if (jobId) target += `&job=${encodeURIComponent(jobId)}`;
  if (expectedSize && expectedSize > 0) target += `&expected=${expectedSize}`;
  return target;
}

export function getImagesZipUrl(pageUrl: string, filename: string): string {
  return `${API_BASE}/images-zip?url=${encodeURIComponent(pageUrl)}&filename=${encodeURIComponent(filename)}`;
}

export function getProgressUrl(jobId: string): string {
  return `${API_BASE}/progress/${encodeURIComponent(jobId)}`;
}

export function getPreviewUrl(sourceUrl: string): string {
  return `${API_BASE}/preview?url=${encodeURIComponent(sourceUrl)}`;
}
