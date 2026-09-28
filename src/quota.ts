const QUOTA_KEY = 'tiksave_fhd_quota';
const PREMIUM_KEY = 'tiksave_premium';

export const FREE_DAILY_LIMIT = 3;

export type QuotaState = {
  date: string;
  remaining: number;
};

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function persist(state: QuotaState) {
  localStorage.setItem(QUOTA_KEY, JSON.stringify(state));
}

export function isPremium(): boolean {
  return localStorage.getItem(PREMIUM_KEY) === '1';
}

export function setPremium(enabled: boolean) {
  if (enabled) {
    localStorage.setItem(PREMIUM_KEY, '1');
  } else {
    localStorage.removeItem(PREMIUM_KEY);
  }
}

export function getQuota(): QuotaState {
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QuotaState;
      if (parsed?.date === todayKey() && typeof parsed.remaining === 'number') {
        return {
          date: parsed.date,
          remaining: Math.max(0, Math.min(FREE_DAILY_LIMIT, parsed.remaining)),
        };
      }
    }
  } catch {
    // ignore corrupted storage
  }

  const fresh: QuotaState = { date: todayKey(), remaining: FREE_DAILY_LIMIT };
  persist(fresh);
  return fresh;
}

export function getRemaining(): number {
  if (isPremium()) return Infinity;
  return getQuota().remaining;
}

export function consumeFreeSlot(): boolean {
  if (isPremium()) return true;

  const quota = getQuota();
  if (quota.remaining <= 0) return false;

  quota.remaining -= 1;
  persist(quota);
  return true;
}

export function formatRemainingLabel(): string {
  if (isPremium()) return 'Unlimited Full HD';
  const left = getRemaining();
  return `${left}/${FREE_DAILY_LIMIT} Free Full HD today`;
}
