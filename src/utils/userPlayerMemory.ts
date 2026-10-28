export type VideoQualitySetting = 'auto' | 1080 | 720 | 480 | 360;

export interface YoutubeQualityVariant {
  height: 1080 | 720 | 480 | 360;
  label: string;
  videoItag: number;
  audioItag: number | null;
  fps: number;
}

export interface UserPlayerSettings {
  volumePercent: number;
  isMuted: boolean;
  preferredQuality: VideoQualitySetting;
  chaptersExpanded: boolean;
}

export interface SavedVideoProgress {
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  twitchVodId?: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number;
}

export interface LastWatchedSession extends SavedVideoProgress {
  wasPersonalMode: boolean;
}

const KEY_VOLUME_PCT = 'jlmtv_user_volume_pct';
const KEY_MUTED = 'jlmtv_user_muted';
const KEY_VIDEO_QUALITY = 'jlmtv_user_video_quality';
const KEY_CHAPTERS_EXPANDED = 'jlmtv_user_chapters_expanded';
const KEY_WATCH_HISTORY = 'jlmtv_watch_history_v1';
const KEY_LAST_SESSION = 'jlmtv_last_session_v1';

const memoryFallbackStore = new Map<string, string>();

function readStorageItem(key: string): string | null {
  try {
    const val = window.localStorage.getItem(key);
    if (val !== null) return val;
  } catch {
    // Fallback to in-memory store if third-party iframe storage is restricted
  }
  return memoryFallbackStore.get(key) ?? null;
}

function writeStorageItem(key: string, value: string): void {
  memoryFallbackStore.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Non-fatal in restricted storage environments
  }
}

function removeStorageItem(key: string): void {
  memoryFallbackStore.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Non-fatal
  }
}

export function parseQualitySetting(raw: string | null): VideoQualitySetting {
  if (raw === '1080') return 1080;
  if (raw === '720') return 720;
  if (raw === '480') return 480;
  if (raw === '360') return 360;
  return 'auto';
}

export function loadUserPlayerSettings(): UserPlayerSettings {
  const rawVol = readStorageItem(KEY_VOLUME_PCT);
  let volumePercent = 100;
  if (rawVol !== null) {
    const parsed = Number(rawVol);
    if (Number.isFinite(parsed)) {
      volumePercent = Math.max(0, Math.min(100, Math.round(parsed)));
    }
  }

  const rawMuted = readStorageItem(KEY_MUTED);
  const isMuted = rawMuted === 'true' || volumePercent === 0;

  const preferredQuality = parseQualitySetting(readStorageItem(KEY_VIDEO_QUALITY));

  const rawChap = readStorageItem(KEY_CHAPTERS_EXPANDED);
  const chaptersExpanded = rawChap === null ? true : rawChap !== 'false';

  return {
    volumePercent,
    isMuted,
    preferredQuality,
    chaptersExpanded,
  };
}

export function saveUserPlayerSettings(partial: Partial<UserPlayerSettings>): void {
  if (typeof partial.volumePercent === 'number' && Number.isFinite(partial.volumePercent)) {
    const clamped = Math.max(0, Math.min(100, Math.round(partial.volumePercent)));
    writeStorageItem(KEY_VOLUME_PCT, String(clamped));
  }
  if (typeof partial.isMuted === 'boolean') {
    writeStorageItem(KEY_MUTED, String(partial.isMuted));
  }
  if (partial.preferredQuality !== undefined) {
    writeStorageItem(KEY_VIDEO_QUALITY, String(partial.preferredQuality));
  }
  if (typeof partial.chaptersExpanded === 'boolean') {
    writeStorageItem(KEY_CHAPTERS_EXPANDED, String(partial.chaptersExpanded));
  }
}

export function loadWatchProgressMap(): Record<string, SavedVideoProgress> {
  const raw = readStorageItem(KEY_WATCH_HISTORY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, SavedVideoProgress>;
    }
  } catch {
    // Ignore corrupted JSON
  }
  return {};
}

export function getSavedVideoProgress(videoId: string): SavedVideoProgress | null {
  if (!videoId) return null;
  const map = loadWatchProgressMap();
  return map[videoId] || null;
}

export function loadLastWatchedSession(): LastWatchedSession | null {
  const raw = readStorageItem(KEY_LAST_SESSION);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LastWatchedSession | null;
    if (
      parsed &&
      typeof parsed.videoId === 'string' &&
      typeof parsed.positionSeconds === 'number' &&
      parsed.positionSeconds >= 5
    ) {
      return parsed;
    }
  } catch {
    // Ignore
  }
  return null;
}

export function saveVideoProgress(
  entry: SavedVideoProgress,
  isPersonalMode: boolean
): Record<string, SavedVideoProgress> {
  const map = loadWatchProgressMap();
  const pos = Math.floor(entry.positionSeconds);
  const dur = Math.round(entry.durationSeconds);

  // If viewer reached the very end of the programme (last 20 seconds), clear saved resume point
  if (dur > 60 && pos >= dur - 20) {
    if (map[entry.videoId]) {
      delete map[entry.videoId];
      writeStorageItem(KEY_WATCH_HISTORY, JSON.stringify(map));
    }
    const last = loadLastWatchedSession();
    if (last && last.videoId === entry.videoId) {
      removeStorageItem(KEY_LAST_SESSION);
    }
    return map;
  }

  if (pos < 5) {
    return map;
  }

  const normalized: SavedVideoProgress = {
    videoId: entry.videoId,
    title: entry.title,
    ...(entry.thumbnailUrl ? { thumbnailUrl: entry.thumbnailUrl } : {}),
    ...(entry.twitchVodId ? { twitchVodId: entry.twitchVodId } : {}),
    positionSeconds: pos,
    durationSeconds: dur,
    updatedAt: entry.updatedAt || Date.now(),
  };

  map[entry.videoId] = normalized;

  // Keep most recent 60 watched programmes
  const sortedEntries = Object.entries(map).sort(
    (a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)
  );
  const trimmedMap: Record<string, SavedVideoProgress> = {};
  for (const [k, v] of sortedEntries.slice(0, 60)) {
    trimmedMap[k] = v;
  }

  writeStorageItem(KEY_WATCH_HISTORY, JSON.stringify(trimmedMap));

  const lastSession: LastWatchedSession = {
    ...normalized,
    wasPersonalMode: isPersonalMode,
  };
  writeStorageItem(KEY_LAST_SESSION, JSON.stringify(lastSession));

  return trimmedMap;
}

export function clearLastWatchedPersonalFlag(): void {
  const last = loadLastWatchedSession();
  if (!last) return;
  writeStorageItem(
    KEY_LAST_SESSION,
    JSON.stringify({
      ...last,
      wasPersonalMode: false,
    })
  );
}
