import './style.css';
import {
  fetchVideoInfo,
  getDownloadUrl,
  getImagesZipUrl,
  getPreviewUrl,
  getProgressUrl,
  getYtdlpDownloadUrl,
} from './api';
import {
  DEFAULT_AVATAR,
  DOWNLOAD_FILE_EXTENSION,
  PLATFORM_META,
  detectPlatformId,
  type PlatformId,
} from './config';
import { downloadWithPicker } from './download';
import type { DownloadProgress, HistoryEntry, VideoFormat, VideoInfo } from './types';

const HISTORY_KEY = 'videosave-history';
const HISTORY_LIMIT = 10;

const form = document.querySelector<HTMLFormElement>('#download-form')!;
const urlInput = document.querySelector<HTMLInputElement>('#url-input')!;
const pasteButton = document.querySelector<HTMLButtonElement>('#paste-btn')!;
const loading = document.querySelector<HTMLDivElement>('#loading')!;
const errorMessage = document.querySelector<HTMLDivElement>('#error-message')!;
const resultContainer = document.querySelector<HTMLDivElement>('#result-container')!;
const historyContainer = document.querySelector<HTMLDivElement>('#history-container')!;

pasteButton.addEventListener('click', pasteUrl);
form.addEventListener('submit', handleSubmit);
renderHistory();

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
  const sourceUrl = video.sourceUrl || urlInput.value.trim();

  // TikTok photo slideshow: images only, no video stream.
  if (video.images && video.images.length > 0) {
    addSlideshowZipButton(options, video, sourceUrl);
    options.appendChild(createPhotoGrid(video));
    // tikwm also generates a slideshow video (photos + music) we can offer.
    addDownloadButton(
      options,
      video.hdVideoUrl,
      `hd_${video.platform}_${video.id || 'video'}${DOWNLOAD_FILE_EXTENSION}`,
      'Download as video (photos + music)',
      'watermark',
      video,
      'Video'
    );
    addMusicButton(options, video);
    return options;
  }

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
    addMusicButton(options, video);
    return options;
  }

  addDownloadButton(options, video.hdVideoUrl, `hd_${baseName}`, 'Download Video HD (No Watermark)', 'hd', video, 'HD');
  addDownloadButton(options, video.wmVideoUrl, `wm_${baseName}`, 'Download with Watermark', 'watermark', video, 'Watermark');
  addMusicButton(options, video);
  return options;
}

function addSlideshowZipButton(container: HTMLElement, video: VideoInfo, sourceUrl: string): void {
  const button = document.createElement('button');
  button.className = 'dl-btn hd';
  button.textContent = `Download all photos (${video.images!.length} · .zip)`;
  button.addEventListener('click', () =>
    runDownload(
      getImagesZipUrl(sourceUrl, `photos_${video.id || 'tiktok'}.zip`),
      `photos_${video.id || 'tiktok'}.zip`,
      button,
      video,
      'Photos'
    )
  );
  container.appendChild(button);
}

function createPhotoGrid(video: VideoInfo): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'photo-grid';
  (video.images || []).forEach((image, index) => {
    const link = document.createElement('a');
    link.className = 'photo-item';
    link.href = getDownloadUrl(image, `${video.platform}_${video.id || 'tiktok'}_photo_${index + 1}.jpg`);
    link.download = '';
    link.title = `Download photo ${index + 1}`;
    const thumb = document.createElement('img');
    thumb.src = image;
    thumb.loading = 'lazy';
    thumb.alt = `Photo ${index + 1}`;
    link.appendChild(thumb);
    grid.appendChild(link);
  });
  return grid;
}

function addMusicButton(container: HTMLElement, video: VideoInfo): void {
  const musicUrl = video.music?.url;
  if (!musicUrl) return;
  const button = document.createElement('button');
  button.className = 'dl-btn watermark';
  button.textContent = `Download music — ${video.music?.title || 'audio'}`;
  button.addEventListener('click', () =>
    runDownload(
      getDownloadUrl(musicUrl, `music_${video.id || 'tiktok'}.mp3`),
      `music_${video.id || 'tiktok'}.mp3`,
      button,
      video,
      'Music'
    )
  );
  container.appendChild(button);
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
    button.addEventListener('click', () => downloadYtdlpFormat(video, format, button));
    list.appendChild(button);
  });
  wrapper.append(label, list);
  return wrapper;
}

function addDownloadButton(
  container: HTMLElement,
  source: string | null | undefined,
  filename: string,
  label: string,
  className: string,
  video: VideoInfo,
  quality: string
): void {
  if (!source) return;
  const button = document.createElement('button');
  button.className = `dl-btn ${className}`;
  button.textContent = label;
  button.addEventListener('click', () => runDownload(getDownloadUrl(source, filename), filename, button, video, quality));
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
  const format = formatId === 'best'
    ? video.formats?.[0]
    : video.formats?.find((f) => f.formatId === formatId);
  button.addEventListener('click', () => downloadYtdlpFormat(video, format, button, formatId));
  container.appendChild(button);
}

// yt-dlp downloads merge on the server first, so we track progress via SSE.
function downloadYtdlpFormat(video: VideoInfo, format: VideoFormat | undefined, button: HTMLButtonElement, formatId?: string): void {
  const platform = video.platform || 'video';
  const quality = format?.label || formatId || 'best';
  const filename = `${platform}_${video.id || 'video'}_${quality}${DOWNLOAD_FILE_EXTENSION}`;
  const sourceUrl = video.sourceUrl || urlInput.value.trim();
  const selector = format?.formatId || formatId || 'best';
  const expectedSize = format?.filesize ? Math.round(format.filesize * 1.1) : 0;

  const jobId = crypto.randomUUID();
  const eventSource = new EventSource(getProgressUrl(jobId));
  eventSource.onmessage = (event) => {
    const progress = JSON.parse(event.data) as DownloadProgress;
    renderProgress(button, progress);
    if (progress.phase === 'done' || progress.phase === 'error') eventSource.close();
  };

  void runDownload(
    getYtdlpDownloadUrl(sourceUrl, selector, filename, jobId, expectedSize),
    filename,
    button,
    video,
    quality,
    (progress) => renderProgress(button, progress)
  ).finally(() => eventSource.close());
}

async function runDownload(
  url: string,
  filename: string,
  button: HTMLButtonElement,
  video: VideoInfo,
  quality: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  try {
    await downloadWithPicker(url, filename, button, onProgress);
    pushHistory({
      url: video.sourceUrl || urlInput.value.trim(),
      title: video.title || 'Untitled',
      platform: video.platform || 'video',
      quality,
      ts: Date.now(),
    });
  } catch {
    // downloadWithPicker already showed the error; nothing to record.
  }
}

function renderProgress(button: HTMLButtonElement, progress: DownloadProgress): void {
  const status = button.querySelector('.dl-status');
  const bar = button.querySelector<HTMLElement>('.dl-bar');
  const fill = button.querySelector<HTMLElement>('.dl-bar-fill');
  if (!status || !bar || !fill) return;

  let text = 'Downloading...';
  switch (progress.phase) {
    case 'starting':
      text = 'Starting...';
      break;
    case 'queued':
      text = `Waiting in queue (#${progress.position || '?'})...`;
      break;
    case 'downloading': {
      const parts = [
        progress.percent != null ? `${progress.percent}%` : '',
        progress.downloaded != null && progress.expected
          ? `${formatSize(progress.downloaded)} / ~${formatSize(progress.expected)}`
          : progress.downloaded != null ? formatSize(progress.downloaded) : '',
        progress.speed ? `${formatSize(progress.speed)}/s` : '',
      ].filter(Boolean);
      if (parts.length > 0) text = parts.join(' · ');
      break;
    }
    case 'merging':
      text = 'Merging video + audio...';
      break;
    case 'saving':
      text = 'Saving to your computer...';
      break;
    case 'error':
      text = 'Download failed';
      break;
  }

  status.textContent = text;
  if (progress.percent != null) {
    bar.classList.add('active');
    fill.style.width = `${progress.percent}%`;
  }
}

// ---- Download history (localStorage, metadata only — files are never stored) ----

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as HistoryEntry[];
  } catch {
    return [];
  }
}

function pushHistory(entry: HistoryEntry): void {
  const items = [entry, ...loadHistory().filter((item) => item.url !== entry.url)].slice(0, HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  renderHistory();
}

function renderHistory(): void {
  const items = loadHistory();
  historyContainer.replaceChildren();
  if (items.length === 0) {
    historyContainer.classList.add('hidden');
    return;
  }
  historyContainer.classList.remove('hidden');

  const head = document.createElement('div');
  head.className = 'history-head';
  const heading = document.createElement('h3');
  heading.textContent = 'Recent downloads';
  const clear = document.createElement('button');
  clear.className = 'history-clear';
  clear.textContent = 'Clear';
  clear.addEventListener('click', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });
  head.append(heading, clear);

  const list = document.createElement('div');
  list.className = 'history-list';
  for (const item of items) {
    const row = document.createElement('button');
    row.className = 'history-item';
    row.title = 'Load this video again';
    row.addEventListener('click', () => {
      urlInput.value = item.url;
      form.requestSubmit();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    const main = document.createElement('span');
    main.className = 'history-main';
    main.textContent = item.title;

    const meta = document.createElement('span');
    meta.className = 'history-meta';
    const platformMeta = PLATFORM_META[item.platform as PlatformId];
    meta.textContent = [
      platformMeta?.name || item.platform,
      item.quality,
      formatWhen(item.ts),
    ].filter(Boolean).join(' · ');

    row.append(main, meta);
    list.appendChild(row);
  }
  historyContainer.append(head, list);
}

function formatWhen(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
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
