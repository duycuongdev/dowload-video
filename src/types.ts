export type VideoStats = {
  plays?: number;
  likes?: number;
  comments?: number;
  shares?: number;
};

export type VideoAuthor = {
  name?: string;
  username?: string;
  avatar?: string | null;
};

export type VideoFormat = {
  formatId: string;
  height: number;
  fps: number | null;
  label: string;
  filesize: number | null;
  hasAudio: boolean;
};

export type VideoInfo = {
  id?: string | number;
  title?: string;
  cover?: string | null;
  videoUrl?: string | null;
  hdVideoUrl?: string | null;
  wmVideoUrl?: string | null;
  // Pre-merged stream usable for in-browser preview (yt-dlp platforms).
  previewUrl?: string | null;
  // 'tiktok' | 'youtube' | 'facebook' | 'instagram'
  platform?: string;
  // Canonical URL the server successfully extracted with (share links get
  // rewritten); downloads should reuse it.
  sourceUrl?: string | null;
  // Available qualities, best first (yt-dlp platforms only).
  formats?: VideoFormat[];
  author?: VideoAuthor;
  stats?: VideoStats;
};
