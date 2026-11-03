export async function downloadWithPicker(url: string, filename: string, button: HTMLButtonElement): Promise<void> {
  const originalHtml = button.innerHTML;
  button.innerHTML = '<div class="spinner inline-spinner"></div> Downloading...';
  button.disabled = true;

  try {
    if ('showSaveFilePicker' in window) {
      const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<any> }).showSaveFilePicker;
      const handle = await picker?.({
        suggestedName: filename,
        types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }],
      });
      if (!handle) return;
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error('Download failed');
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
    }
  } finally {
    button.innerHTML = originalHtml;
    button.disabled = false;
  }
}
