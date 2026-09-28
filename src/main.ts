import './style.css';

const form = document.getElementById('download-form') as HTMLFormElement;
const urlInput = document.getElementById('url-input') as HTMLInputElement;
const pasteBtn = document.getElementById('paste-btn') as HTMLButtonElement;
const loading = document.getElementById('loading') as HTMLDivElement;
const errorMsg = document.getElementById('error-message') as HTMLDivElement;
const resultContainer = document.getElementById('result-container') as HTMLDivElement;

const API_BASE = 'http://localhost:3001/api';

// Format numbers (e.g. 1500000 -> 1.5M)
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// Paste from clipboard
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text;
      // Focus input to show it's active
      urlInput.focus();
    }
  } catch (err) {
    console.error('Failed to read clipboard contents: ', err);
    showError('Could not paste from clipboard. Please paste manually.');
  }
});

// Handle form submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const url = urlInput.value.trim();
  if (!url) {
    showError('Please enter a TikTok URL');
    return;
  }

  // Basic validation for TikTok URL
  if (!url.includes('tiktok.com')) {
    showError('Please enter a valid TikTok URL');
    return;
  }

  // Reset UI state
  hideError();
  resultContainer.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    const response = await fetch(`${API_BASE}/video-info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch video information');
    }

    renderResult(data.data);
  } catch (err: any) {
    showError(err.message || 'An unexpected error occurred. Please try again.');
  } finally {
    loading.classList.add('hidden');
  }
});

function showError(msg: string) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
  errorMsg.textContent = '';
}

function renderResult(video: any) {
  // We use the proxy endpoints to bypass CORS when downloading/previewing
  const previewUrl = video.hdVideoUrl 
    ? `${API_BASE}/preview?url=${encodeURIComponent(video.hdVideoUrl)}`
    : video.videoUrl 
      ? `${API_BASE}/preview?url=${encodeURIComponent(video.videoUrl)}` 
      : '';

  const safeFilename = `tiktok_${video.id || 'video'}.mp4`;
  
  const hdDownloadUrl = video.hdVideoUrl 
    ? `${API_BASE}/download?url=${encodeURIComponent(video.hdVideoUrl)}&filename=hd_${safeFilename}`
    : '';
    
  const wmDownloadUrl = video.wmVideoUrl 
    ? `${API_BASE}/download?url=${encodeURIComponent(video.wmVideoUrl)}&filename=wm_${safeFilename}`
    : '';

  resultContainer.innerHTML = `
    <div class="video-preview">
      ${previewUrl 
        ? `<video src="${previewUrl}" poster="${video.cover || ''}" controls preload="metadata"></video>`
        : `<img src="${video.cover || ''}" alt="Video cover" style="width:100%;height:100%;object-fit:cover;">`
      }
    </div>
    
    <div class="video-info">
      <div class="author-info">
        <img src="${video.author?.avatar || '/vite.svg'}" alt="${video.author?.name}" class="author-avatar" onerror="this.src='/vite.svg'">
        <div class="author-details">
          <h3>${video.author?.name || 'Unknown'}</h3>
          <p>@${video.author?.username || 'unknown'}</p>
        </div>
      </div>
      
      <p class="video-desc">${video.title || 'No description'}</p>
      
      <div class="stats">
        <div class="stat-item" title="Plays">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          ${formatNumber(video.stats?.plays || 0)}
        </div>
        <div class="stat-item" title="Likes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
          ${formatNumber(video.stats?.likes || 0)}
        </div>
        <div class="stat-item" title="Comments">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
          ${formatNumber(video.stats?.comments || 0)}
        </div>
        <div class="stat-item" title="Shares">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
          ${formatNumber(video.stats?.shares || 0)}
        </div>
      </div>
      
      <div class="download-options">
        ${hdDownloadUrl 
          ? `<button data-url="${hdDownloadUrl}" data-filename="hd_${safeFilename}" class="dl-btn hd save-as-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              Download Video HD (No Watermark)
            </button>`
          : ''
        }
        
        ${wmDownloadUrl 
          ? `<button data-url="${wmDownloadUrl}" data-filename="wm_${safeFilename}" class="dl-btn watermark save-as-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              Download with Watermark
            </button>`
          : ''
        }
      </div>
    </div>
  `;
  
  resultContainer.classList.remove('hidden');

  const saveBtns = resultContainer.querySelectorAll('.save-as-btn');
  saveBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-url');
      const filename = btn.getAttribute('data-filename') || 'video.mp4';
      if (!url) return;
      await downloadWithPicker(url, filename, btn as HTMLButtonElement);
    });
  });
}

async function downloadWithPicker(url: string, defaultFilename: string, btn: HTMLButtonElement) {
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<div class="spinner" style="width:20px;height:20px;border-width:2px;display:inline-block;margin-right:8px;vertical-align:middle;"></div> Downloading...`;
  btn.style.pointerEvents = 'none';

  try {
    if ('showSaveFilePicker' in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [{
          description: 'MP4 Video',
          accept: { 'video/mp4': ['.mp4'] },
        }],
      });
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Download failed');
      
      const writable = await handle.createWritable();
      await response.body?.pipeTo(writable);
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      alert('Error downloading file: ' + err.message);
    }
  } finally {
    btn.innerHTML = originalHtml;
    btn.style.pointerEvents = 'auto';
  }
}
