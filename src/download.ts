import type { DownloadProgress } from './types';

export async function downloadWithPicker(
  url: string,
  filename: string,
  button: HTMLButtonElement,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const originalHtml = button.innerHTML;
  button.innerHTML =
    '<div class="spinner inline-spinner"></div> <span class="dl-status">Downloading...</span>' +
    '<div class="dl-bar"><div class="dl-bar-fill"></div></div>';
  button.disabled = true;
  onProgress?.({ phase: 'starting' });

  try {
    if ('showSaveFilePicker' in window) {
      const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<any> }).showSaveFilePicker;
      const handle = await picker?.({
        suggestedName: filename,
        types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }],
      });
      if (!handle) return;
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || 'Download failed');
      }
      onProgress?.({ phase: 'saving' });
      await response.body.pipeTo(await handle.createWritable());
      return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      alert(`Error downloading file: ${(error as Error).message}`);
      throw error; // let callers skip history recording on failure
    }
  } finally {
    button.innerHTML = originalHtml;
    button.disabled = false;
  }
}
