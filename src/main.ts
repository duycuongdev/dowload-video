import './style.css';
import { fetchVideoInfo, getDownloadUrl, getPreviewUrl, getYtdlpDownloadUrl } from './api';
import {
  DEFAULT_AVATAR,
  DOWNLOAD_FILE_EXTENSION,
  PLATFORM_META,
  detectPlatformId,
  type PlatformId,
} from './config';
import { downloadWithPicker } from './download';
import type { VideoFormat, VideoInfo } from './types';

const form = document.querySelector<HTMLFormElement>('#download-form')!;
const urlInput = document.querySelector<HTMLInputElement>('#url-input')!;
const pasteButton = document.querySelector<HTMLButtonElement>('#paste-btn')!;
const loading = document.querySelector<HTMLDivElement>('#loading')!;
const errorMessage = document.querySelector<HTMLDivElement>('#error-message')!;
const resultContainer = document.querySelector<HTMLDivElement>('#result-container')!;

pasteButton.addEventListener('click', pasteUrl);
form.addEventListener('submit', handleSubmit);

async function pasteUrl(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text;
      urlInput.focus();
    }
  } catch {
    showError('Could not paste from clipboard. Please paste manually.');
  }
}

async function handleSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!detectPlatformId(url)) {
    showError('Please enter a valid video URL from TikTok, YouTube, Facebook or Instagram');
    return;
  }
  hideError();
  resultContainer.classList.add('hidden');
  loading.classList.remove('hidden');
  try {
    renderResult(await fetchVideoInfo(url));
  } catch (error) {
    showError(error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.');
  } finally {
    loading.classList.add('hidden');
  }
}

function renderResult(video: VideoInfo): void {
  resultContainer.replaceChildren(createPreview(video), createVideoInfo(video));
  resultContainer.classList.remove('hidden');
}

function createPreview(video: VideoInfo): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'video-preview';

  const showCover = (): void => {
    if (!video.cover) return;
    container.replaceChildren(createCoverImage(video));
  };

  // TikTok streams directly; yt-dlp platforms expose a pre-merged stream
  // for preview. Fall back to the cover image if it cannot play.
  const source = video.hdVideoUrl || video.videoUrl || video.previewUrl;
  if (source) {
    const preview = document.createElement('video');
    preview.src = getPreviewUrl(source);
    preview.poster = video.cover || '';
    preview.controls = true;
    preview.preload = 'metadata';
    preview.addEventListener('error', showCover, { once: true });
    container.appendChild(preview);
  } else {
    showCover();
  }
  return container;
}

function createCoverImage(video: VideoInfo): HTMLImageElement {
  const image = document.createElement('img');
  image.src = video.cover || '';
  image.alt = 'Video cover';
  return image;
}

function createVideoInfo(video: VideoInfo): HTMLDivElement {
  const info = document.createElement('div');
  info.className = 'video-info';
  info.append(createAuthor(video), createDescription(video), createStats(video), createDownloadOptions(video));
  return info;
}

function createAuthor(video: VideoInfo): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'author-info';
  const avatar = document.createElement('img');
  avatar.className = 'author-avatar';
  avatar.src = video.author?.avatar || DEFAULT_AVATAR;
  avatar.alt = video.author?.name || 'Author';
  avatar.addEventListener('error', () => { avatar.src = DEFAULT_AVATAR; }, { once: true });
  const details = document.createElement('div');
  details.className = 'author-details';
  const name = document.createElement('h3');
  name.textContent = video.author?.name || 'Unknown';
  const username = document.createElement('p');
  username.textContent = `@${video.author?.username || 'unknown'}`;
  details.append(name, username, createPlatformBadge(video.platform));
  wrapper.append(avatar, details);
  return wrapper;
}

function createPlatformBadge(platformId?: string): HTMLDivElement {
  const meta = PLATFORM_META[(platformId || '') as PlatformId];
  const badge = document.createElement('div');
  badge.className = 'platform-badge';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = meta?.color || 'var(--secondary)';
  badge.append(dot, document.createTextNode(meta?.name || 'Video'));
  return badge;
}

function createDescription(video: VideoInfo): HTMLParagraphElement {
  const description = document.createElement('p');
  description.className = 'video-desc';
  description.textContent = video.title || 'No description';
  return description;
}

function createStats(video: VideoInfo): HTMLDivElement {
  const stats = document.createElement('div');
  stats.className = 'stats';
  const items: Array<[string, number | undefined]> = [
    ['Plays', video.stats?.plays],
    ['Likes', video.stats?.likes],
    ['Comments', video.stats?.comments],
    ['Shares', video.stats?.shares],
  ];
  items
    .filter(([, value]) => value !== undefined)
    .forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'stat-item';
      item.title = label;
      item.textContent = `${label}: ${formatNumber(value ?? 0)}`;
      stats.appendChild(item);
    });
  if (stats.children.length > 0) {
    stats.classList.add('has-items');
  }
  return stats;
}

function createDownloadOptions(video: VideoInfo): HTMLDivElement {
  const options = document.createElement('div');
  options.className = 'download-options';
  const platform = video.platform || 'tiktok';
  const baseName = `${platform}_${video.id || 'video'}${DOWNLOAD_FILE_EXTENSION}`;

  if (video.formats && video.formats.length > 0) {
    const best = video.formats[0];
    const bestSize = formatSize(best.filesize);
    addYtdlpDownloadButton(
      options,
      video,
      'best',
      `Download Best Quality (${best.label}${bestSize ? ` · ~${bestSize}` : ''})`,
      'hd'
    );
    const lowerQualities = video.formats.slice(1);
    if (lowerQualities.length > 0) {
      options.appendChild(createQualityList(video, lowerQualities));
    }
    return options;
  }

  addDownloadButton(options, video.hdVideoUrl, `hd_${baseName}`, 'Download Video HD (No Watermark)', 'hd');
  addDownloadButton(options, video.wmVideoUrl, `wm_${baseName}`, 'Download with Watermark', 'watermark');
  return options;
}

function createQualityList(video: VideoInfo, formats: VideoFormat[]): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'quality-section';
  const label = document.createElement('p');
  label.className = 'quality-label';
  label.textContent = 'Other qualities';
  const list = document.createElement('div');
  list.className = 'quality-list';
  formats.forEach((format) => {
    const button = document.createElement('button');
    button.className = 'quality-btn';
    const size = formatSize(format.filesize);
    button.textContent = size ? `${format.label} · ${size}` : format.label;
    button.title = `Download ${format.label}`;
    button.addEventListener('click', () =>
      downloadYtdlpFormat(video, format.formatId, button)
    );
    list.appendChild(button);
  });
  wrapper.append(label, list);
  return wrapper;
}

function addDownloadButton(container: HTMLElement, source: string | null | undefined, filename: string, label: string, className: string): void {
  if (!source) return;
  const button = document.createElement('button');
  button.className = `dl-btn ${className}`;
  button.textContent = label;
  button.addEventListener('click', () => downloadWithPicker(getDownloadUrl(source, filename), filename, button));
  container.appendChild(button);
}

function addYtdlpDownloadButton(
  container: HTMLElement,
  video: VideoInfo,
  formatId: string,
  label: string,
  className: string
): void {
  const button = document.createElement('button');
  button.className = `dl-btn ${className}`;
  button.textContent = label;
  button.addEventListener('click', () => downloadYtdlpFormat(video, formatId, button));
  container.appendChild(button);
}

function downloadYtdlpFormat(video: VideoInfo, formatId: string, button: HTMLButtonElement): void {
  const platform = video.platform || 'video';
  const quality = formatId === 'best' ? video.formats?.[0]?.label || 'best' : formatId;
  const filename = `${platform}_${video.id || 'video'}_${quality}${DOWNLOAD_FILE_EXTENSION}`;
  downloadWithPicker(getYtdlpDownloadUrl(video.sourceUrl || urlInput.value.trim(), formatId, filename), filename, button);
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
}

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function showError(message: string): void {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
}

function hideError(): void {
  errorMessage.textContent = '';
  errorMessage.classList.add('hidden');
}
