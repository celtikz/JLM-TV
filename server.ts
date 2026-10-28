import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Readable } from 'stream';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import type {
  ActiveSource,
  BroadcastMode,
  BroadcastState,
  ChatMessage,
  KeepAliveStats,
  ProgramTheme,
  TransitionLog,
  TwitchStatus,
  VideoChapter,
  YouTubeVideoItem,
} from './src/types/broadcast.ts';
import {
  CURATED_VIDEO_CHAPTERS,
  classifyProgramTheme,
  ensureVideoChapters,
  formatTimecode,
  getThemeDefinition,
  isSyntheticChapterList,
  parseDescriptionChapters,
} from './src/utils/programMetadata.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const TWITCH_LOGIN = 'jlmelenchon';
const YOUTUBE_CHANNEL_ID = 'UCk-_PEY3iC6DIGJKuoEe9bw';
const YOUTUBE_CONFERENCES_PLAYLIST_ID = 'PLnAm9o_Xn_3CC7Oeg5-6clIrUzJE_qI1o';
const YOUTUBE_VLOGS_PLAYLIST_ID = 'PLnAm9o_Xn_3CGqKhPyl4zYj1h05eLKrdm';
const YOUTUBE_COULISSES_PLAYLIST_ID = 'PLnAm9o_Xn_3BEIRnIFuMZdoHr67HysgGK';
const MIN_TV_PROGRAM_DURATION_SEC = 180; // Strictly exclude YouTube Shorts (< 3 min)
const TWITCH_PUBLIC_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

const SERVER_BOOT_MS = Date.now();
const KEEPALIVE_INTERVAL_SEC = 240; // 4 minutes (Render sleeps after 15 min idle)
let detectedExternalOrigin: string | null =
  (
    process.env.PUBLIC_APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.APP_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '') || null;
let keepAlivePingCount = 0;
let lastKeepAliveAt: string | null = null;
let lastKeepAliveStatus: 'ok' | 'local' | 'error' = detectedExternalOrigin ? 'ok' : 'local';

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)));
}

function extractYoutubePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (/^PL[a-zA-Z0-9_-]{12,48}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtube.com')) {
      const listId = url.searchParams.get('list');
      const v = url.searchParams.get('v');
      if (listId && !v && /^[a-zA-Z0-9_-]{10,60}$/.test(listId)) {
        return listId;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.replace(/^\//, '').split('/')[0].slice(0, 11);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname.startsWith('/shorts/')) {
        return null; // Reject YouTube Shorts links
      }
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const pathMatch = url.pathname.match(/\/(?:embed|live|v)\/([a-zA-Z0-9_-]{11})/);
      if (pathMatch) return pathMatch[1];
    }
  } catch {
    return null;
  }
  return null;
}

function parseTwitchInput(
  input: string
): { kind: 'vod'; vodId: string } | { kind: 'channel'; login: string } | null {
  const trimmed = input.trim();
  if (/^\d{8,14}$/.test(trimmed)) {
    return { kind: 'vod', vodId: trimmed };
  }
  try {
    const url = new URL(trimmed);
    if (!url.hostname.toLowerCase().includes('twitch.tv')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'videos' && parts[1] && /^\d+$/.test(parts[1])) {
      return { kind: 'vod', vodId: parts[1] };
    }
    if (parts[1] === 'video' && parts[2] && /^\d+$/.test(parts[2])) {
      return { kind: 'vod', vodId: parts[2] };
    }
    if (parts[0] && /^[a-zA-Z0-9_]{2,30}$/.test(parts[0]) && parts[0] !== 'videos') {
      return { kind: 'channel', login: parts[0].toLowerCase() };
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeWords(title: string): string[] {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !['jean', 'melenchon', 'avec', 'dans', 'pour'].includes(w));
}

function findMatchingTwitchArchive(youtubeTitle: string): YouTubeVideoItem | null {
  const targetWords = normalizeWords(youtubeTitle);
  if (targetWords.length < 2) return null;
  let bestMatch: YouTubeVideoItem | null = null;
  let bestRatio = 0;

  for (const archive of cachedArchiveItems) {
    if (!archive.twitchVodId) continue;
    const archWords = new Set(normalizeWords(archive.title));
    if (archWords.size === 0) continue;
    const overlap = targetWords.filter((w) => archWords.has(w)).length;
    const ratio = overlap / Math.min(targetWords.length, archWords.size);
    if (overlap >= 2 && ratio >= 0.65 && ratio > bestRatio) {
      bestRatio = ratio;
      bestMatch = archive;
    }
  }
  return bestMatch;
}

const CUSTOM_VIDEOS_FILE = path.join(process.cwd(), 'data', 'custom-videos.json');
const CHAPTERS_CACHE_FILE = path.join(process.cwd(), 'data', 'chapters-cache.json');

interface CachedVideoMeta {
  title?: string;
  durationSeconds: number;
  views: number;
  rawChapters: VideoChapter[];
  isShort?: boolean;
  updatedAt: number;
}

const videoMetaCache = new Map<string, CachedVideoMeta>();
const shortVideoIds = new Set<string>();
const removedVideoIds = new Set<string>();

function loadVideoMetaCache(): void {
  try {
    if (fs.existsSync(CHAPTERS_CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CHAPTERS_CACHE_FILE, 'utf-8')) as Record<
        string,
        CachedVideoMeta
      >;
      for (const [id, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.durationSeconds === 'number') {
          videoMetaCache.set(id, entry);
          if (entry.isShort || (entry.durationSeconds > 0 && entry.durationSeconds < MIN_TV_PROGRAM_DURATION_SEC)) {
            shortVideoIds.add(id);
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }
}

function saveVideoMetaCache(): void {
  try {
    const obj: Record<string, CachedVideoMeta> = {};
    for (const [id, val] of videoMetaCache.entries()) {
      obj[id] = val;
    }
    fs.mkdirSync(path.dirname(CHAPTERS_CACHE_FILE), { recursive: true });
    fs.writeFileSync(CHAPTERS_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch {
    // Non-fatal on read-only fs
  }
}

loadVideoMetaCache();

function hydrateVideoMetadata(
  raw: Omit<YouTubeVideoItem, 'theme' | 'chapters'> & {
    theme?: ProgramTheme;
    chapters?: VideoChapter[];
    description?: string;
    chaptersHydrated?: boolean;
  }
): YouTubeVideoItem {
  const cachedMeta = videoMetaCache.get(raw.id);
  const resolvedDuration =
    cachedMeta && cachedMeta.durationSeconds >= MIN_TV_PROGRAM_DURATION_SEC
      ? cachedMeta.durationSeconds
      : raw.durationSeconds;

  const theme = raw.theme || classifyProgramTheme(raw.title, raw.description || '');
  const candidateRawChapters =
    raw.chapters && !isSyntheticChapterList(raw.chapters)
      ? raw.chapters
      : cachedMeta?.rawChapters && cachedMeta.rawChapters.length >= 2
        ? cachedMeta.rawChapters
        : undefined;

  const chapters = ensureVideoChapters({
    id: raw.id,
    title: raw.title,
    durationSeconds: resolvedDuration,
    theme,
    twitchVodId: raw.twitchVodId,
    rawChapters: candidateRawChapters,
    description: raw.description,
  });

  // Ensure duration is always strictly greater than the highest chapter timestamp
  const highestChapSec = chapters.reduce((acc, c) => Math.max(acc, c.startSeconds), 0);
  const safeDuration =
    highestChapSec >= resolvedDuration ? highestChapSec + 600 : resolvedDuration;

  const isHydrated = Boolean(
    raw.chaptersHydrated ||
      CURATED_VIDEO_CHAPTERS[raw.id] ||
      (candidateRawChapters && candidateRawChapters.length >= 2) ||
      cachedMeta
  );

  return {
    id: raw.id,
    title: raw.title,
    publishedAt: raw.publishedAt,
    thumbnailUrl: raw.thumbnailUrl,
    views: Math.max(raw.views || 0, cachedMeta?.views || 0),
    durationSeconds: safeDuration,
    sourceType: raw.sourceType,
    ...(raw.twitchVodId ? { twitchVodId: raw.twitchVodId } : {}),
    ...(raw.twitchChannelLogin ? { twitchChannelLogin: raw.twitchChannelLogin } : {}),
    theme,
    chapters,
    chaptersHydrated: isHydrated,
  };
}

const DEFAULT_CUSTOM_VIDEOS: YouTubeVideoItem[] = [
  hydrateVideoMetadata({
    id: '5qS3PZkpC64',
    title: 'Jean-Luc Mélenchon : discussion sans filtre avec François Lenglet (Présidentielle 2027)',
    publishedAt: '2026-10-25T18:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/5qS3PZkpC64/hqdefault.jpg',
    views: 1373327,
    durationSeconds: 8614,
    sourceType: 'custom',
    theme: 'entretiens',
  }),
  hydrateVideoMetadata({
    id: 'Xq8a165QzvQ',
    title: 'Dans les coulisses de la présidentielle - Le chemin de la victoire (Vlog)',
    publishedAt: '2026-10-22T18:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/Xq8a165QzvQ/hqdefault.jpg',
    views: 277171,
    durationSeconds: 5159,
    sourceType: 'custom',
    theme: 'vlogs',
  }),
];

/**
 * Curated long-form JLM Vlogs, Conferences & Chaptered Interviews
 * ensuring rich thematic coverage and zero YouTube Shorts.
 */
const CURATED_DOCUMENTARY_CATALOG: YouTubeVideoItem[] = [
  hydrateVideoMetadata({
    id: 'Xq8a165QzvQ',
    title: 'Dans les coulisses de la présidentielle - Le chemin de la victoire (Vlog)',
    publishedAt: '2026-10-22T18:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/Xq8a165QzvQ/hqdefault.jpg',
    views: 277171,
    durationSeconds: 5159,
    sourceType: 'rss',
    theme: 'vlogs',
  }),
  hydrateVideoMetadata({
    id: '8xUoG4BRkqU',
    title: 'Robots, IA, Espace - Vlog de Jean-Luc Mélenchon au salon VivaTech',
    publishedAt: '2026-09-18T17:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/8xUoG4BRkqU/hqdefault.jpg',
    views: 103548,
    durationSeconds: 1368,
    sourceType: 'rss',
    theme: 'vlogs',
  }),
  hydrateVideoMetadata({
    id: 'rLDEasxPkic',
    title: 'Vlog au Festival d’Avignon — Culture, théâtre public et intermittents',
    publishedAt: '2026-08-14T16:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/rLDEasxPkic/hqdefault.jpg',
    views: 99945,
    durationSeconds: 2145,
    sourceType: 'rss',
    theme: 'vlogs',
  }),
  hydrateVideoMetadata({
    id: '5sJ6EWMmFf8',
    title: 'Jusqu’à la victoire ! — Documentaire dans les coulisses de la campagne présidentielle',
    publishedAt: '2026-07-20T18:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/5sJ6EWMmFf8/hqdefault.jpg',
    views: 236546,
    durationSeconds: 5859,
    sourceType: 'rss',
    theme: 'vlogs',
  }),
  hydrateVideoMetadata({
    id: 'JJUpHvEunoA',
    title: '3 heures pour penser le XXIe siècle avec Jean-Luc Mélenchon',
    publishedAt: '2026-09-28T18:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/JJUpHvEunoA/hqdefault.jpg',
    views: 441641,
    durationSeconds: 11141,
    sourceType: 'rss',
    theme: 'conferences',
  }),
  hydrateVideoMetadata({
    id: '25lLr3vUlws',
    title: 'Présentation du programme L’Avenir en commun — édition 2025',
    publishedAt: '2026-09-10T18:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/25lLr3vUlws/hqdefault.jpg',
    views: 121910,
    durationSeconds: 4468,
    sourceType: 'rss',
    theme: 'assemblee',
  }),
  hydrateVideoMetadata({
    id: 'FzzQgJntbqQ',
    title: 'Bataille de civilisation dans un monde en ruine ? — Jean-Luc Mélenchon (Thinkerview)',
    publishedAt: '2026-08-29T19:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/FzzQgJntbqQ/hqdefault.jpg',
    views: 859747,
    durationSeconds: 9666,
    sourceType: 'rss',
    theme: 'entretiens',
  }),
  hydrateVideoMetadata({
    id: 'RZTCInRezZU',
    title: 'Discussion internationale : Jean-Luc Mélenchon avec HasanAbi',
    publishedAt: '2026-08-05T19:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/RZTCInRezZU/hqdefault.jpg',
    views: 236741,
    durationSeconds: 5224,
    sourceType: 'rss',
    theme: 'international',
  }),
  hydrateVideoMetadata({
    id: 'xbe3Gnv9YV8',
    title: 'Mélenchon face au MEDEF : comprendre le débat économique (salaires, retraites, fiscalité, UE)',
    publishedAt: '2026-07-12T17:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/xbe3Gnv9YV8/hqdefault.jpg',
    views: 185400,
    durationSeconds: 2120,
    sourceType: 'rss',
    theme: 'entretiens',
  }),
  hydrateVideoMetadata({
    id: 'NrWl84bQRPY',
    title: 'Les médias contre Mélenchon : 15 ans de conflictualité médiatique (Blast)',
    publishedAt: '2026-06-25T17:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/NrWl84bQRPY/hqdefault.jpg',
    views: 949172,
    durationSeconds: 6998,
    sourceType: 'rss',
    theme: 'entretiens',
  }),
  hydrateVideoMetadata({
    id: '4-dfHYMfSjI',
    title: 'Présidentielle, abstention et stratégie de la « Nouvelle France » (Mediapart)',
    publishedAt: '2026-06-10T18:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/4-dfHYMfSjI/hqdefault.jpg',
    views: 720355,
    durationSeconds: 3787,
    sourceType: 'rss',
    theme: 'entretiens',
  }),
];

function isShortOrInvalidTitle(title: string, description = ''): boolean {
  return /(?:^|\s)#shorts?\b/i.test(`${title} ${description}`);
}

function loadSavedCustomVideos(): YouTubeVideoItem[] {
  try {
    if (fs.existsSync(CUSTOM_VIDEOS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CUSTOM_VIDEOS_FILE, 'utf-8')) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const loaded = (parsed as Array<YouTubeVideoItem>)
          .filter(
            (item) =>
              item &&
              !shortVideoIds.has(item.id) &&
              !isShortOrInvalidTitle(item.title || '') &&
              (item.durationSeconds === undefined ||
                item.durationSeconds === 0 ||
                item.durationSeconds >= MIN_TV_PROGRAM_DURATION_SEC)
          )
          .map((item) =>
            hydrateVideoMetadata({
              ...item,
              // Drop stale synthetic chapters so updated curated/real chapters take effect
              chapters: isSyntheticChapterList(item.chapters) ? undefined : item.chapters,
            })
          );

        // Ensure default flagship items (5qS3PZkpC64 & Xq8a165QzvQ) are present
        const loadedIds = new Set(loaded.map((v) => v.id));
        for (const def of DEFAULT_CUSTOM_VIDEOS) {
          if (!loadedIds.has(def.id)) {
            loaded.push(def);
          }
        }
        return loaded;
      }
    }
  } catch {
    // Fallback to default curated custom videos
  }
  return [...DEFAULT_CUSTOM_VIDEOS];
}

function saveCustomVideos(playlist: YouTubeVideoItem[]): void {
  try {
    const customItems = playlist.filter((v) => v.sourceType === 'custom');
    fs.mkdirSync(path.dirname(CUSTOM_VIDEOS_FILE), { recursive: true });
    fs.writeFileSync(CUSTOM_VIDEOS_FILE, JSON.stringify(customItems, null, 2), 'utf-8');
  } catch {
    // Non-fatal on read-only filesystems
  }
}

const FALLBACK_VIDEOS: YouTubeVideoItem[] = [
  hydrateVideoMetadata({
    id: 'vod-2906055180',
    twitchVodId: '2906055180',
    title: 'Conférence de Jean-Luc Mélenchon sur le moment politique !',
    publishedAt: '2026-10-20T17:28:10Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/SJ1BhZdb8sI/hqdefault.jpg',
    views: 90035,
    durationSeconds: 6257,
    sourceType: 'rss',
    theme: 'conferences',
  }),
  hydrateVideoMetadata({
    id: 'vod-2900414335',
    twitchVodId: '2900414335',
    title: 'Conférence de presse de Jean-Luc Mélenchon et Éric Coquerel',
    publishedAt: '2026-10-14T09:29:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/msIb2rNDSTA/hqdefault.jpg',
    views: 40761,
    durationSeconds: 5253,
    sourceType: 'rss',
    theme: 'assemblee',
  }),
  hydrateVideoMetadata({
    id: 'vod-2897888840',
    twitchVodId: '2897888840',
    title: 'Meeting de Jean-Luc Mélenchon à Clermont-Ferrand !',
    publishedAt: '2026-10-11T13:05:43Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/loxwn3DECHw/hqdefault.jpg',
    views: 62322,
    durationSeconds: 6146,
    sourceType: 'rss',
    theme: 'meetings',
  }),
  hydrateVideoMetadata({
    id: 'vod-2892736786',
    twitchVodId: '2892736786',
    title: "Conférence de Jean-Luc Mélenchon à l'invitation de HEC Débats !",
    publishedAt: '2026-10-05T17:58:26Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/o6fu63AyFjY/hqdefault.jpg',
    views: 67246,
    durationSeconds: 7903,
    sourceType: 'rss',
    theme: 'conferences',
  }),
  hydrateVideoMetadata({
    id: 'vod-2889055110',
    twitchVodId: '2889055110',
    title: 'Conférence de Jean-Luc Mélenchon sur le moment politique',
    publishedAt: '2026-10-01T17:18:39Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/7hBEv95Q8Ew/hqdefault.jpg',
    views: 11148,
    durationSeconds: 4614,
    sourceType: 'rss',
    theme: 'conferences',
  }),
];

const durationCache = new Map<string, number>();
const unplayableVideoIds = new Set<string>();
const processedMessageIds = new Set<string>();
let cachedArchiveItems: YouTubeVideoItem[] = [...FALLBACK_VIDEOS];
let cachedYoutubeRssItems: YouTubeVideoItem[] = [];

const vodTokenCache = new Map<
  string,
  { value: string; signature: string; expiresAt: number }
>();

function getProgramEntryOffsetSeconds(video?: YouTubeVideoItem | null): number {
  if (!video || !video.twitchVodId) return 0;
  if (video.durationSeconds >= 2400) return 720; // Skip 12m "On arrive..." static pre-roll banner
  if (video.durationSeconds >= 1200) return 360; // Skip 6m pre-roll
  if (video.durationSeconds >= 480) return 90; // Skip 1m30s pre-roll
  return 0;
}

const initialPlaylist: YouTubeVideoItem[] = (() => {
  const seen = new Set<string>();
  const list: YouTubeVideoItem[] = [];
  for (const v of [
    ...loadSavedCustomVideos(),
    ...FALLBACK_VIDEOS,
    ...CURATED_DOCUMENTARY_CATALOG,
  ]) {
    if (!seen.has(v.id)) {
      seen.add(v.id);
      list.push(v);
    }
  }
  return list;
})();

function buildKeepAliveStats(): KeepAliveStats {
  return {
    enabled: true,
    targetUrl: detectedExternalOrigin ? `${detectedExternalOrigin}/api/health` : null,
    intervalSeconds: KEEPALIVE_INTERVAL_SEC,
    pingCount: keepAlivePingCount,
    lastPingAt: lastKeepAliveAt,
    lastPingStatus: lastKeepAliveStatus,
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - SERVER_BOOT_MS) / 1000)),
  };
}

let state: BroadcastState = {
  mode: 'auto',
  activeSource: 'youtube',
  activeThemeFilter: 'all',
  flashBannerTriggeredAt: 0,
  leftBannerTriggeredAt: 0,
  leftBannerManualIndex: -1,
  keepAlive: buildKeepAliveStats(),
  twitch: {
    isLive: false,
    channelLogin: TWITCH_LOGIN,
    displayName: 'JLMelenchon',
    streamId: null,
    title: 'Vérification du flux Twitch en cours...',
    viewersCount: 0,
    startedAt: null,
    profileImageUrl: '',
    lastCheckedAt: new Date().toISOString(),
  },
  playlist: initialPlaylist,
  currentIndex: 0,
  currentVideoStartedAt:
    Date.now() - getProgramEntryOffsetSeconds(initialPlaylist[0]) * 1000,
  serverTime: Date.now(),
  connectedViewers: 0,
  shuffleYoutube: false,
  transitions: [
    {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message: 'Démarrage de la régie H24 JLM Télévision',
      source: 'youtube',
    },
  ],
  chatMessages: [
    {
      id: 'welcome-msg',
      author: 'Régie Antenne',
      text: 'Synchronisation H24 active : bascule automatique sur twitch.tv/jlmelenchon dès qu’un direct démarre, relais vidéo continu hors antenne.',
      createdAt: new Date().toISOString(),
    },
  ],
};

function appendTransition(message: string, source: ActiveSource) {
  const entry: TransitionLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message,
    source,
  };
  state.transitions = [entry, ...state.transitions].slice(0, 20);
}

function computeDesiredSource(mode: BroadcastMode, isTwitchLive: boolean): ActiveSource {
  if (mode === 'force_twitch') return 'twitch';
  if (mode === 'force_youtube') return 'youtube';
  return isTwitchLive ? 'twitch' : 'youtube';
}

function rebuildCombinedPlaylist() {
  const currentPlayingId = state.playlist[state.currentIndex]?.id;
  const customVideos = state.playlist.filter(
    (v) =>
      v.sourceType === 'custom' &&
      !unplayableVideoIds.has(v.id) &&
      !shortVideoIds.has(v.id) &&
      !removedVideoIds.has(v.id)
  );
  const existingIds = new Set<string>();
  const combined: YouTubeVideoItem[] = [];

  for (const item of [
    ...customVideos,
    ...cachedArchiveItems,
    ...cachedYoutubeRssItems,
    ...CURATED_DOCUMENTARY_CATALOG,
  ]) {
    if (
      unplayableVideoIds.has(item.id) ||
      shortVideoIds.has(item.id) ||
      removedVideoIds.has(item.id) ||
      existingIds.has(item.id)
    ) {
      continue;
    }
    if (
      item.sourceType !== 'custom' &&
      item.durationSeconds > 0 &&
      item.durationSeconds < MIN_TV_PROGRAM_DURATION_SEC
    ) {
      continue;
    }
    existingIds.add(item.id);
    combined.push(item);
  }

  // Cross-match Twitch VODs with corresponding YouTube items so VODs inherit detailed chapters
  for (const vod of combined) {
    if (!vod.twitchVodId || !isSyntheticChapterList(vod.chapters)) continue;
    const vodWords = normalizeWords(vod.title);
    if (vodWords.length < 2) continue;
    for (const yt of combined) {
      if (yt.twitchVodId || isSyntheticChapterList(yt.chapters) || yt.chapters.length < 2) {
        continue;
      }
      const ytWords = new Set(normalizeWords(yt.title));
      const overlap = vodWords.filter((w) => ytWords.has(w)).length;
      const ratio = overlap / Math.max(1, Math.min(vodWords.length, ytWords.size));
      if (overlap >= 2 && ratio >= 0.65) {
        const preRoll = getProgramEntryOffsetSeconds(vod);
        const transferred: VideoChapter[] =
          preRoll > 0 ? [{ startSeconds: 0, title: 'Pré-générique antenne' }] : [];
        for (const ch of yt.chapters) {
          const shifted = ch.startSeconds + preRoll;
          if (shifted < vod.durationSeconds - 15) {
            transferred.push({ startSeconds: shifted, title: ch.title });
          }
        }
        if (transferred.length >= 2) {
          vod.chapters = transferred;
          vod.chaptersHydrated = true;
          break;
        }
      }
    }
  }

  if (combined.length > 0) {
    state.playlist = combined;
    if (currentPlayingId) {
      const idx = state.playlist.findIndex((v) => v.id === currentPlayingId);
      state.currentIndex = idx >= 0 ? idx : 0;
    } else {
      state.currentIndex = 0;
    }
  }
}

function advancePlaylist(reason: string, direction: 1 | -1 = 1, _requireHls = false) {
  if (state.playlist.length === 0) return;

  const allPool = state.playlist.map((item, idx) => ({ item, idx }));
  const themedPool =
    state.activeThemeFilter === 'all'
      ? allPool
      : allPool.filter((p) => p.item.theme === state.activeThemeFilter);
  const pool = themedPool.length > 0 ? themedPool : allPool;

  if (state.shuffleYoutube && pool.length > 1 && direction === 1) {
    const others = pool.filter((p) => p.idx !== state.currentIndex);
    const chosen = others[Math.floor(Math.random() * others.length)] || pool[0];
    state.currentIndex = chosen.idx;
  } else {
    const currentPosInPool = pool.findIndex((p) => p.idx === state.currentIndex);
    const nextPos =
      currentPosInPool >= 0
        ? (currentPosInPool + direction + pool.length) % pool.length
        : 0;
    state.currentIndex = pool[nextPos].idx;
  }

  const current = state.playlist[state.currentIndex];
  const entryOffsetSec = getProgramEntryOffsetSeconds(current);
  state.currentVideoStartedAt = Date.now() - entryOffsetSec * 1000;
  if (current) {
    appendTransition(`${reason} : ${current.title}`, 'youtube');
  }
}

async function probeTwitchChannel(): Promise<TwitchStatus> {
  try {
    const response = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-Id': TWITCH_PUBLIC_CLIENT_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `query {
          user(login: "${TWITCH_LOGIN}") {
            id
            login
            displayName
            profileImageURL(width: 300)
            broadcastSettings { title }
            stream {
              id
              title
              type
              viewersCount
              createdAt
            }
            videos(first: 18, type: ARCHIVE) {
              edges {
                node {
                  id
                  title
                  lengthSeconds
                  publishedAt
                  viewCount
                  previewThumbnailURL(width: 640, height: 360)
                }
              }
            }
          }
        }`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Twitch GQL HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: {
        user?: {
          login?: string;
          displayName?: string;
          profileImageURL?: string;
          broadcastSettings?: { title?: string };
          stream?: {
            id?: string;
            title?: string;
            type?: string;
            viewersCount?: number;
            createdAt?: string;
          } | null;
          videos?: {
            edges?: Array<{
              node?: {
                id?: string;
                title?: string;
                lengthSeconds?: number;
                publishedAt?: string;
                viewCount?: number;
                previewThumbnailURL?: string;
              };
            }>;
          };
        };
      };
    };

    const user = payload?.data?.user;
    const stream = user?.stream ?? null;
    const isLive = Boolean(stream && stream.type === 'live');

    const vodEdges = user?.videos?.edges || [];
    const fetchedArchives: YouTubeVideoItem[] = [];
    for (const edge of vodEdges) {
      const node = edge?.node;
      if (!node?.id || !node?.title || !node?.lengthSeconds || node.lengthSeconds < 480) {
        continue;
      }
      fetchedArchives.push(
        hydrateVideoMetadata({
          id: `vod-${node.id}`,
          twitchVodId: node.id,
          title: node.title,
          publishedAt: node.publishedAt || new Date().toISOString(),
          thumbnailUrl: node.previewThumbnailURL || '',
          views: node.viewCount ?? 0,
          durationSeconds: node.lengthSeconds,
          sourceType: 'rss',
        })
      );
    }
    let archivesChanged = false;
    if (fetchedArchives.length > 0) {
      const prevKey = cachedArchiveItems.map((item) => item.id).join(',');
      const nextKey = fetchedArchives.map((item) => item.id).join(',');
      archivesChanged = prevKey !== nextKey;
      cachedArchiveItems = fetchedArchives;
      if (archivesChanged) {
        rebuildCombinedPlaylist();
      }
    }

    const prevSource = state.activeSource;
    const wasLive = state.twitch.isLive;

    state.twitch = {
      isLive,
      channelLogin: user?.login || TWITCH_LOGIN,
      displayName: user?.displayName || 'JLMelenchon',
      streamId: stream?.id || null,
      title:
        stream?.title ||
        user?.broadcastSettings?.title ||
        'Hors antenne — En attente du prochain direct Twitch',
      viewersCount: stream?.viewersCount ?? 0,
      startedAt: stream?.createdAt || null,
      profileImageUrl: user?.profileImageURL || state.twitch.profileImageUrl,
      lastCheckedAt: new Date().toISOString(),
    };

    const nextSource = computeDesiredSource(state.mode, isLive);
    if (nextSource !== prevSource) {
      state.activeSource = nextSource;
      if (nextSource === 'twitch') {
        appendTransition(
          `Direct Twitch détecté sur ${TWITCH_LOGIN} — Bascule antenne immédiate`,
          'twitch'
        );
      } else {
        const vid = state.playlist[state.currentIndex];
        state.currentVideoStartedAt =
          Date.now() - getProgramEntryOffsetSeconds(vid) * 1000;
        appendTransition(
          `Fin du direct Twitch — Relais automatique (${vid ? vid.title : 'Grille JLM'})`,
          'youtube'
        );
      }
      broadcastFullState();
    } else if (wasLive !== isLive || archivesChanged) {
      broadcastFullState();
    }
  } catch (err) {
    console.error('[Twitch Probe Error]:', err);
    state.twitch.lastCheckedAt = new Date().toISOString();
  }

  return state.twitch;
}

async function fetchYoutubeRssXmlItems(
  rssUrl: string,
  options: { defaultTheme?: ProgramTheme; maxItems?: number } = {}
): Promise<YouTubeVideoItem[]> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5500);
    const res = await fetch(rssUrl, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JLMTelevisionBot/1.0)',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return [];

    const xml = await res.text();
    const rawEntries = xml.split('<entry>').slice(1);
    const items: YouTubeVideoItem[] = [];

    for (const entry of rawEntries) {
      if (options.maxItems && items.length >= options.maxItems) break;

      const idMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
      const linkMatch = entry.match(/<link\s+rel="alternate"\s+href="([^"]+)"/);
      const pubMatch = entry.match(/<published>([^<]+)<\/published>/);
      const viewsMatch = entry.match(/<media:statistics\s+views="(\d+)"/);
      const descMatch = entry.match(/<media:description>([\s\S]*?)<\/media:description>/);

      if (!idMatch || !titleMatch) continue;
      const id = idMatch[1].trim();
      const linkHref = linkMatch?.[1] || '';

      // Strictly reject YouTube Shorts (/shorts/<id> in RSS alternate link)
      if (linkHref.includes('/shorts/')) {
        shortVideoIds.add(id);
        continue;
      }
      if (unplayableVideoIds.has(id) || shortVideoIds.has(id) || removedVideoIds.has(id)) {
        continue;
      }

      const views = viewsMatch ? Number(viewsMatch[1]) : 0;
      if (views === 0) continue;

      const title = decodeXmlEntities(titleMatch[1].trim());
      const description = descMatch ? decodeXmlEntities(descMatch[1].trim()) : '';
      if (isShortOrInvalidTitle(title, description)) {
        shortVideoIds.add(id);
        continue;
      }

      const cachedMeta = videoMetaCache.get(id);
      if (
        cachedMeta &&
        (cachedMeta.isShort ||
          (cachedMeta.durationSeconds > 0 &&
            cachedMeta.durationSeconds < MIN_TV_PROGRAM_DURATION_SEC))
      ) {
        shortVideoIds.add(id);
        continue;
      }

      const publishedAt = pubMatch ? pubMatch[1].trim() : new Date().toISOString();
      const cachedDuration =
        cachedMeta?.durationSeconds || durationCache.get(id) || 2700;

      items.push(
        hydrateVideoMetadata({
          id,
          title,
          publishedAt,
          thumbnailUrl: `https://i2.ytimg.com/vi/${id}/hqdefault.jpg`,
          views,
          durationSeconds: cachedDuration,
          sourceType: 'rss',
          theme: options.defaultTheme,
          description,
        })
      );
    }

    return items;
  } catch {
    return [];
  }
}

let isHydratingChapters = false;

async function hydratePlaylistChaptersInBackground(forceRescan = false): Promise<void> {
  if (isHydratingChapters) return;
  isHydratingChapters = true;

  try {
    const candidates = state.playlist.filter((item) => {
      if (item.twitchVodId || item.twitchChannelLogin) return false;
      if (!/^[a-zA-Z0-9_-]{11}$/.test(item.id)) return false;
      if (CURATED_VIDEO_CHAPTERS[item.id] && !forceRescan) return false;
      const cached = videoMetaCache.get(item.id);
      if (cached && !forceRescan && Date.now() - cached.updatedAt < 12 * 3600_000) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) return;

    let anyUpdated = false;
    const batchSize = 3;

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (item) => {
          const details = await fetchYoutubeVideoDetails(item.id, forceRescan);
          if (
            details.isShort ||
            (details.durationSeconds > 0 &&
              details.durationSeconds < MIN_TV_PROGRAM_DURATION_SEC)
          ) {
            shortVideoIds.add(item.id);
            cachedYoutubeRssItems = cachedYoutubeRssItems.filter((x) => x.id !== item.id);
            anyUpdated = true;
            return;
          }

          if (details.durationSeconds >= MIN_TV_PROGRAM_DURATION_SEC) {
            durationCache.set(item.id, details.durationSeconds);
          }

          const updateTarget = (list: YouTubeVideoItem[]) => {
            const idx = list.findIndex((x) => x.id === item.id);
            if (idx >= 0) {
              list[idx] = hydrateVideoMetadata({
                ...list[idx],
                durationSeconds:
                  details.durationSeconds >= MIN_TV_PROGRAM_DURATION_SEC
                    ? details.durationSeconds
                    : list[idx].durationSeconds,
                views: Math.max(list[idx].views, details.views),
                chapters:
                  details.rawChapters.length >= 2
                    ? details.rawChapters
                    : isSyntheticChapterList(list[idx].chapters)
                      ? undefined
                      : list[idx].chapters,
                description: details.description,
                chaptersHydrated: true,
              });
              anyUpdated = true;
            }
          };

          updateTarget(cachedYoutubeRssItems);
          updateTarget(state.playlist);
        })
      );
    }

    if (anyUpdated) {
      saveVideoMetaCache();
      rebuildCombinedPlaylist();
      broadcastFullState();
    }
  } catch (err) {
    console.warn('[Chapter Hydration Warning]:', err);
  } finally {
    isHydratingChapters = false;
  }
}

async function syncYoutubeFeed(): Promise<void> {
  try {
    // Replace Shorts-heavy channel feed with:
    // 1) Official Conferences Playlist (PLnAm9o_Xn_3CC7Oeg5-6clIrUzJE_qI1o)
    // 2) Official Vlogs & Coulisses Playlists
    // 3) Official Channel Feed strictly filtered to exclude all /shorts/
    const [conferencesItems, vlogsItems, coulissesItems, channelLongItems] = await Promise.all([
      fetchYoutubeRssXmlItems(
        `https://www.youtube.com/feeds/videos.xml?playlist_id=${YOUTUBE_CONFERENCES_PLAYLIST_ID}`,
        { defaultTheme: 'conferences', maxItems: 15 }
      ),
      fetchYoutubeRssXmlItems(
        `https://www.youtube.com/feeds/videos.xml?playlist_id=${YOUTUBE_VLOGS_PLAYLIST_ID}`,
        { defaultTheme: 'vlogs', maxItems: 8 }
      ),
      fetchYoutubeRssXmlItems(
        `https://www.youtube.com/feeds/videos.xml?playlist_id=${YOUTUBE_COULISSES_PLAYLIST_ID}`,
        { defaultTheme: 'vlogs', maxItems: 6 }
      ),
      fetchYoutubeRssXmlItems(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`,
        { maxItems: 15 }
      ),
    ]);

    const seen = new Set<string>();
    const merged: YouTubeVideoItem[] = [];
    for (const item of [
      ...conferencesItems,
      ...channelLongItems,
      ...vlogsItems,
      ...coulissesItems,
    ]) {
      if (seen.has(item.id) || shortVideoIds.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }

    if (merged.length > 0) {
      cachedYoutubeRssItems = merged;
      rebuildCombinedPlaylist();
      broadcastFullState();
      void hydratePlaylistChaptersInBackground(false);
    }
  } catch (err) {
    console.error('[YouTube RSS Sync Error]:', err);
  }
}

async function scrapeYoutubeWatchPageDetails(videoId: string): Promise<{
  title: string;
  durationSeconds: number;
  views: number;
  rawChapters: VideoChapter[];
  description: string;
  isShort: boolean;
}> {
  const browserUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4500);
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=fr`, {
      signal: ac.signal,
      headers: {
        'User-Agent': browserUa,
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+478',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        title: '',
        durationSeconds: 0,
        views: 0,
        rawChapters: [],
        description: '',
        isShort: false,
      };
    }

    const html = await res.text();
    const isShort =
      html.includes(`"canonicalBaseUrl":"/shorts/${videoId}"`) ||
      html.includes(`<link rel="canonical" href="https://www.youtube.com/shorts/${videoId}">`);

    let title = '';
    const titleMeta = html.match(/<meta\s+name="title"\s+content="([^"]+)"/i);
    if (titleMeta?.[1]) {
      title = decodeXmlEntities(titleMeta[1].trim());
    }

    let durationSeconds = 0;
    const lenSecMatch = html.match(/"lengthSeconds":"(\d+)"/);
    const approxMsMatch = html.match(/"approxDurationMs":"(\d+)"/);
    if (lenSecMatch?.[1]) {
      durationSeconds = Number(lenSecMatch[1]);
    } else if (approxMsMatch?.[1]) {
      durationSeconds = Math.round(Number(approxMsMatch[1]) / 1000);
    }

    let views = 0;
    const viewCountMatch =
      html.match(/itemprop="interactionCount"\s+content="(\d+)"/) ||
      html.match(/"viewCount":"(\d+)"/);
    if (viewCountMatch?.[1]) {
      views = Number(viewCountMatch[1]);
    }

    let description = '';
    const shortDescMatch = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
    if (shortDescMatch?.[1]) {
      try {
        description = JSON.parse(`"${shortDescMatch[1]}"`) as string;
      } catch {
        description = '';
      }
    }

    const chapterMap = new Map<number, string>();
    const chMatches = html.matchAll(
      /"chapterRenderer":\{"title":\{"simpleText":"((?:\\.|[^"\\])*)"\},"timeRangeStartMillis":(\d+)/g
    );
    for (const m of chMatches) {
      const startSeconds = Math.round(Number(m[2]) / 1000);
      if (startSeconds >= 0 && !chapterMap.has(startSeconds)) {
        try {
          const parsedTitle = (JSON.parse(`"${m[1]}"`) as string).trim();
          if (parsedTitle) chapterMap.set(startSeconds, parsedTitle);
        } catch {
          // Ignore malformed escape
        }
      }
    }

    let rawChapters: VideoChapter[] = [...chapterMap.entries()]
      .map(([startSeconds, chapTitle]) => ({ startSeconds, title: chapTitle }))
      .sort((a, b) => a.startSeconds - b.startSeconds);

    if (rawChapters.length < 2 && description) {
      rawChapters = parseDescriptionChapters(description, durationSeconds);
    }

    return { title, durationSeconds, views, rawChapters, description, isShort };
  } catch {
    return {
      title: '',
      durationSeconds: 0,
      views: 0,
      rawChapters: [],
      description: '',
      isShort: false,
    };
  }
}

async function fetchYoutubeVideoDetails(
  videoId: string,
  bypassCache = false
): Promise<{
  title: string;
  durationSeconds: number;
  views: number;
  rawChapters: VideoChapter[];
  description: string;
  isShort?: boolean;
}> {
  if (!bypassCache) {
    const cached = videoMetaCache.get(videoId);
    if (cached && cached.durationSeconds > 0 && cached.rawChapters.length >= 2) {
      return {
        title: cached.title || '',
        durationSeconds: cached.durationSeconds,
        views: cached.views,
        rawChapters: cached.rawChapters,
        description: '',
        isShort: cached.isShort,
      };
    }
  }

  const browserUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

  let pipedResult: {
    title: string;
    durationSeconds: number;
    views: number;
    rawChapters: VideoChapter[];
    description: string;
    isShort: boolean;
  } | null = null;

  // 1. Fast Piped metadata API (~200ms, returns exact durationSeconds + views + title + chapters)
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3800);
    const res = await fetch(`https://api.piped.private.coffee/streams/${videoId}`, {
      signal: ac.signal,
      headers: { 'User-Agent': browserUa },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as {
        title?: string;
        duration?: number;
        views?: number;
        description?: string;
        isShort?: boolean;
        chapters?: Array<{ title?: string; start?: number }>;
      };
      if (data.title && data.duration && data.duration > 0) {
        const dur = Math.round(data.duration);
        durationCache.set(videoId, dur);
        let rawChapters: VideoChapter[] = Array.isArray(data.chapters)
          ? data.chapters
              .filter(
                (c): c is { title: string; start: number } =>
                  typeof c?.title === 'string' &&
                  c.title.trim().length > 0 &&
                  typeof c?.start === 'number' &&
                  c.start >= 0
              )
              .map((c) => ({
                title: c.title.trim(),
                startSeconds: Math.round(c.start),
              }))
          : [];
        const description = typeof data.description === 'string' ? data.description : '';
        if (rawChapters.length < 2 && description) {
          rawChapters = parseDescriptionChapters(description, dur);
        }
        pipedResult = {
          title: data.title.trim(),
          durationSeconds: dur,
          views: data.views ?? 0,
          rawChapters,
          description,
          isShort: Boolean(data.isShort),
        };
      }
    }
  } catch {
    // Fallback below
  }

  // 2. Direct YouTube Watch HTML scraper (retrieves official chapterRenderer markers even when Piped returns 0 chapters!)
  if (!pipedResult || pipedResult.rawChapters.length < 2) {
    const watchData = await scrapeYoutubeWatchPageDetails(videoId);
    if (pipedResult) {
      if (watchData.rawChapters.length >= 2) {
        pipedResult.rawChapters = watchData.rawChapters;
      }
      if (!pipedResult.description && watchData.description) {
        pipedResult.description = watchData.description;
      }
      if (watchData.isShort) {
        pipedResult.isShort = true;
      }
    } else if (watchData.title || watchData.durationSeconds > 0 || watchData.rawChapters.length > 0) {
      pipedResult = {
        title: watchData.title,
        durationSeconds: watchData.durationSeconds,
        views: watchData.views,
        rawChapters: watchData.rawChapters,
        description: watchData.description,
        isShort: watchData.isShort,
      };
    }
  }

  if (pipedResult && (pipedResult.title || pipedResult.durationSeconds > 0)) {
    const finalDur = pipedResult.durationSeconds || durationCache.get(videoId) || 3600;
    let finalTitle = pipedResult.title;
    if (!finalTitle) {
      try {
        const oe = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(
            `https://www.youtube.com/watch?v=${videoId}`
          )}&format=json`
        );
        if (oe.ok) {
          const d = (await oe.json()) as { title?: string };
          if (d.title) finalTitle = d.title.trim();
        }
      } catch {
        // Ignore
      }
    }
    videoMetaCache.set(videoId, {
      title: finalTitle || undefined,
      durationSeconds: finalDur,
      views: pipedResult.views,
      rawChapters: pipedResult.rawChapters,
      isShort: pipedResult.isShort,
      updatedAt: Date.now(),
    });
    return {
      title: finalTitle || `Vidéo YouTube (${videoId})`,
      durationSeconds: finalDur,
      views: pipedResult.views,
      rawChapters: pipedResult.rawChapters,
      description: pipedResult.description,
      isShort: pipedResult.isShort,
    };
  }

  // 3. Fallback: PokeTube OpenGraph meta + YouTube OEmbed
  let fallbackDuration = durationCache.get(videoId) ?? 3600;
  let fallbackTitle = '';
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3500);
    const pokeRes = await fetch(`https://poketube.fun/watch?v=${videoId}`, {
      signal: ac.signal,
      headers: { 'User-Agent': browserUa },
    });
    clearTimeout(timer);
    if (pokeRes.ok) {
      const html = await pokeRes.text();
      const titleMeta = html.match(/property="og:title"\s+content="([^"]+)"/i);
      if (titleMeta?.[1]) {
        fallbackTitle = decodeXmlEntities(titleMeta[1].replace(/\s*\|\s*Poke$/i, '').trim());
      }
      const descMeta = html.match(/Watch this (\d{1,2}):(\d{2})(?::(\d{2}))? long video/i);
      if (descMeta) {
        const sec = descMeta[3]
          ? Number(descMeta[1]) * 3600 + Number(descMeta[2]) * 60 + Number(descMeta[3])
          : Number(descMeta[1]) * 60 + Number(descMeta[2]);
        if (sec > 0) {
          fallbackDuration = sec;
          durationCache.set(videoId, sec);
        }
      }
    }
  } catch {
    // Continue to OEmbed
  }

  if (!fallbackTitle) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`
      )}&format=json`;
      const res = await fetch(oembedUrl);
      if (res.ok) {
        const data = (await res.json()) as { title?: string };
        if (data.title) fallbackTitle = data.title.trim();
      }
    } catch {
      // Ignore
    }
  }

  return {
    title: fallbackTitle || `Vidéo YouTube (${videoId})`,
    durationSeconds: fallbackDuration,
    views: 0,
    rawChapters: [],
    description: '',
  };
}

// ============================================================================
// HLS Stream Proxy for CSP-Compliant Native <video> Playback in Discord Activity
// ============================================================================

function isAllowedHlsHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return (
      h === 'usher.ttvnw.net' ||
      h.endsWith('.ttvnw.net') ||
      h.endsWith('.twitch.tv') ||
      h.endsWith('.twitchcdn.net') ||
      h.endsWith('.cloudfront.net') ||
      h.endsWith('.akamaized.net')
    );
  } catch {
    return false;
  }
}

function rewriteM3u8Manifest(m3u8Text: string, baseUrl: string): string {
  const lines = m3u8Text.split(/\r?\n/);
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_match, uriVal: string) => {
          try {
            const abs = new URL(uriVal, baseUrl).href;
            const cleanPath = abs.split('?')[0].toLowerCase();
            const route = cleanPath.endsWith('.m3u8') ? 'playlist.m3u8' : 'segment.ts';
            return `URI="${route}?u=${encodeURIComponent(abs)}"`;
          } catch {
            return _match;
          }
        });
      }

      try {
        const abs = new URL(trimmed, baseUrl).href;
        const cleanPath = abs.split('?')[0].toLowerCase();
        const route = cleanPath.endsWith('.m3u8') ? 'playlist.m3u8' : 'segment.ts';
        return `${route}?u=${encodeURIComponent(abs)}`;
      } catch {
        return line;
      }
    })
    .join('\n');
}

async function fetchTwitchPlaybackToken(
  opts: { isLive: true; login: string } | { isLive: false; vodId: string }
): Promise<{ value: string; signature: string } | null> {
  if (!opts.isLive) {
    const cached = vodTokenCache.get(opts.vodId);
    if (cached && cached.expiresAt > Date.now()) {
      return { value: cached.value, signature: cached.signature };
    }
  }

  const gqlRes = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'Client-Id': TWITCH_PUBLIC_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operationName: 'PlaybackAccessToken_Template',
      query:
        'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature } videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature } }',
      variables: {
        isLive: opts.isLive,
        login: opts.isLive ? opts.login : '',
        isVod: !opts.isLive,
        vodID: !opts.isLive ? opts.vodId : '',
        playerType: 'embed',
      },
    }),
  });

  if (!gqlRes.ok) return null;
  const json = (await gqlRes.json()) as {
    data?: {
      streamPlaybackAccessToken?: { value?: string; signature?: string } | null;
      videoPlaybackAccessToken?: { value?: string; signature?: string } | null;
    };
  };

  const tok = opts.isLive
    ? json?.data?.streamPlaybackAccessToken
    : json?.data?.videoPlaybackAccessToken;

  if (!tok?.value || !tok?.signature) return null;

  if (!opts.isLive) {
    vodTokenCache.set(opts.vodId, {
      value: tok.value,
      signature: tok.signature,
      expiresAt: Date.now() + 10 * 60_000,
    });
  }

  return { value: tok.value, signature: tok.signature };
}

const app = express();
app.use((req, _res, next) => {
  if (!detectedExternalOrigin) {
    const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim();
    if (
      rawHost &&
      !rawHost.startsWith('localhost') &&
      !rawHost.startsWith('127.0.0.1') &&
      !rawHost.startsWith('0.0.0.0')
    ) {
      detectedExternalOrigin = `https://${rawHost}`;
    }
  }

  if (req.url.startsWith('/.proxy/')) {
    req.url = req.url.slice('/.proxy'.length);
  } else if (req.url === '/.proxy') {
    req.url = '/';
  }
  next();
});
app.use(express.json());

// Anti-Sleep Health & Keep-Alive Endpoint (Render Free Tier H24 Watchdog + GitHub Actions)
app.get(['/api/health', '/api/keepalive'], (req, res) => {
  const source = String(req.query.source || '').trim();
  if (source) {
    keepAlivePingCount += 1;
    lastKeepAliveAt = new Date().toISOString();
    lastKeepAliveStatus = 'ok';
  }
  const currentVideo = state.playlist[state.currentIndex] || null;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    status: 'awake',
    serverTime: Date.now(),
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - SERVER_BOOT_MS) / 1000)),
    activeSource: state.activeSource,
    currentProgram: currentVideo?.title || null,
    keepAlive: buildKeepAliveStats(),
  });
});

// HLS Live Stream Endpoint (Default JLM Channel)
app.get('/api/hls/live.m3u8', async (_req, res) => {
  try {
    const tok = await fetchTwitchPlaybackToken({ isLive: true, login: TWITCH_LOGIN });
    if (!tok) {
      res.status(404).send('Channel offline or token unavailable');
      return;
    }
    const usherUrl = `https://usher.ttvnw.net/api/channel/hls/${TWITCH_LOGIN}.m3u8?sig=${encodeURIComponent(
      tok.signature
    )}&token=${encodeURIComponent(tok.value)}&allow_source=true&allow_audio_only=true&fast_bread=true`;

    const upstream = await fetch(usherUrl);
    if (!upstream.ok) {
      res.status(upstream.status).send('Live stream currently offline');
      return;
    }
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(rewriteM3u8Manifest(text, usherUrl));
  } catch (err) {
    console.error('[HLS Live Error]:', err);
    res.status(502).send('HLS live proxy error');
  }
});

// HLS Live Stream Endpoint (Any Custom Twitch Channel)
app.get('/api/hls/channel-:login.m3u8', async (req, res) => {
  try {
    const login = String(req.params.login || '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '');
    if (!login) {
      res.status(400).send('Invalid channel login');
      return;
    }
    const tok = await fetchTwitchPlaybackToken({ isLive: true, login });
    if (!tok) {
      res.status(404).send('Channel offline or token unavailable');
      return;
    }
    const usherUrl = `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?sig=${encodeURIComponent(
      tok.signature
    )}&token=${encodeURIComponent(tok.value)}&allow_source=true&allow_audio_only=true&fast_bread=true`;

    const upstream = await fetch(usherUrl);
    if (!upstream.ok) {
      res.status(upstream.status).send('Live stream currently offline');
      return;
    }
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(rewriteM3u8Manifest(text, usherUrl));
  } catch (err) {
    console.error('[HLS Custom Channel Error]:', err);
    res.status(502).send('HLS custom channel proxy error');
  }
});

// HLS Archive VOD Endpoint
app.get('/api/hls/vod-:vodId.m3u8', async (req, res) => {
  try {
    const vodId = String(req.params.vodId || '').replace(/[^0-9]/g, '');
    if (!vodId) {
      res.status(400).send('Invalid VOD ID');
      return;
    }
    const tok = await fetchTwitchPlaybackToken({ isLive: false, vodId });
    if (!tok) {
      res.status(404).send('VOD token unavailable');
      return;
    }
    const usherUrl = `https://usher.ttvnw.net/vod/${vodId}.m3u8?sig=${encodeURIComponent(
      tok.signature
    )}&token=${encodeURIComponent(tok.value)}&allow_source=true`;

    const upstream = await fetch(usherUrl);
    if (!upstream.ok) {
      res.status(upstream.status).send('VOD manifest unavailable');
      return;
    }
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(rewriteM3u8Manifest(text, usherUrl));
  } catch (err) {
    console.error('[HLS VOD Error]:', err);
    res.status(502).send('HLS VOD proxy error');
  }
});

// HLS Variant Playlist Proxy
app.get('/api/hls/playlist.m3u8', async (req, res) => {
  try {
    const targetUrl = String(req.query.u || '');
    if (!isAllowedHlsHost(targetUrl)) {
      res.status(403).send('Forbidden upstream host');
      return;
    }
    const upstream = await fetch(targetUrl);
    if (!upstream.ok) {
      res.status(upstream.status).send('Variant playlist fetch failed');
      return;
    }
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(rewriteM3u8Manifest(text, targetUrl));
  } catch (err) {
    console.error('[HLS Variant Error]:', err);
    res.status(502).send('Variant proxy error');
  }
});

// HLS Binary Media Segment Streaming Pipe (.ts / .aac / .mp4)
app.get('/api/hls/segment.ts', async (req, res) => {
  const targetUrl = String(req.query.u || '');
  if (!isAllowedHlsHost(targetUrl)) {
    res.status(403).send('Forbidden segment host');
    return;
  }

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const headers: Record<string, string> = {};
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const upstream = await fetch(targetUrl, {
      headers,
      signal: abortController.signal,
    });

    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'video/mp2t'
    );
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    res.setHeader('Cache-Control', 'public, max-age=300');

    if (!upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(
      upstream.body as unknown as NodeWebReadableStream
    );
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    nodeStream.pipe(res);
  } catch {
    if (!res.headersSent) {
      res.status(502).end();
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// ============================================================================
// CSP-Compliant Direct YouTube MP4 Proxy (/api/yt/stream/:videoId)
// Enables ANY YouTube video (e.g. TF1, Blast, Mediapart, JLM) inside Discord Activity
// ============================================================================

const YT_STREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
const YT_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB chunks keep Discord Cloudflare proxy fast & timeout-free
const ALLOWED_YT_ITAGS = new Set<number>([299, 137, 298, 136, 135, 134, 22, 18, 140]);

interface YoutubeResolvedQuality {
  height: 1080 | 720 | 480 | 360;
  label: string;
  videoItag: number;
  audioItag: number | null;
  fps: number;
}

let activeCompanionOrigin = 'https://invid-api.poketube.fun';
let lastCompanionDiscoveryAt = 0;
const ytStreamTotalBytesCache = new Map<string, number>();
const ytQualitiesCache = new Map<
  string,
  { qualities: YoutubeResolvedQuality[]; expiresAt: number }
>();

async function discoverCompanionOrigin(sampleVideoId: string): Promise<string> {
  if (Date.now() - lastCompanionDiscoveryAt < 60_000) {
    return activeCompanionOrigin;
  }
  lastCompanionDiscoveryAt = Date.now();

  try {
    const jar = new Map<string, string>();
    const saveCookies = (res: Response) => {
      const setCookies =
        (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || [];
      for (const c of setCookies) {
        const kv = c.split(';')[0];
        const eq = kv.indexOf('=');
        if (eq > 0) {
          const k = kv.slice(0, eq).trim();
          const v = kv.slice(eq + 1).trim();
          if (v) jar.set(k, v);
        }
      }
    };
    const cookieHeader = () =>
      [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

    const target = `https://poketube.fun/watch?v=${sampleVideoId}`;
    const r1 = await fetch(target, { headers: { 'User-Agent': YT_STREAM_UA } });
    saveCookies(r1);
    let html = await r1.text();

    const chMatch = html.match(
      /<script id="anubis_challenge" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (chMatch?.[1]) {
      const parsed = JSON.parse(chMatch[1]) as {
        rules?: { difficulty?: number };
        challenge?: { id?: string; randomData?: string; difficulty?: number };
      };
      const id = parsed.challenge?.id;
      const randomData = parsed.challenge?.randomData;
      const difficulty =
        parsed.rules?.difficulty ?? parsed.challenge?.difficulty ?? 4;
      if (id && randomData) {
        const prefix = '0'.repeat(Math.min(6, Math.max(1, difficulty)));
        const t0 = Date.now();
        let nonce = 0;
        let hash = '';
        while (nonce < 2_000_000) {
          hash = crypto
            .createHash('sha256')
            .update(randomData + String(nonce))
            .digest('hex');
          if (hash.startsWith(prefix)) break;
          nonce += 1;
        }
        const elapsed = Math.max(15, Date.now() - t0);
        const passUrl = `https://poketube.fun/.within.website/x/cmd/anubis/api/pass-challenge?id=${encodeURIComponent(
          id
        )}&response=${hash}&nonce=${nonce}&redir=${encodeURIComponent(
          `/watch?v=${sampleVideoId}`
        )}&elapsedTime=${elapsed}`;

        const r2 = await fetch(passUrl, {
          redirect: 'manual',
          headers: {
            'User-Agent': YT_STREAM_UA,
            Cookie: cookieHeader(),
            Referer: target,
          },
        });
        saveCookies(r2);

        const r3 = await fetch(target, {
          headers: { 'User-Agent': YT_STREAM_UA, Cookie: cookieHeader() },
        });
        html = await r3.text();
      }
    }

    const companionMatch = html.match(
      /(https:\/\/[a-z0-9.-]+)\/companion\/latest_version\?/i
    );
    if (companionMatch?.[1]) {
      activeCompanionOrigin = companionMatch[1];
    }
  } catch (err) {
    console.warn('[YouTube Companion Discovery]:', err);
  }

  return activeCompanionOrigin;
}

async function resolveYoutubeQualities(videoId: string): Promise<YoutubeResolvedQuality[]> {
  const cached = ytQualitiesCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.qualities;
  }

  const probeItagsOnOrigin = async (origin: string): Promise<Set<number>> => {
    const candidates = [299, 137, 298, 136, 135, 18, 140];
    const available = new Set<number>();

    await Promise.all(
      candidates.map(async (itag) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 3400);
        try {
          const url = `${origin}/companion/latest_version?id=${encodeURIComponent(
            videoId
          )}&itag=${itag}&local=true`;
          const res = await fetch(url, {
            signal: ac.signal,
            headers: {
              'User-Agent': YT_STREAM_UA,
              Range: 'bytes=0-255',
            },
          });
          if (res.status === 206 || res.status === 200) {
            available.add(itag);
            const cr = res.headers.get('content-range') || '';
            const m = cr.match(/\/(\d+)$/);
            if (m?.[1]) {
              ytStreamTotalBytesCache.set(`${videoId}:${itag}`, Number(m[1]));
            }
          }
          await res.body?.cancel().catch(() => {});
        } catch {
          // Ignore individual itag probe timeout/error
        } finally {
          clearTimeout(timer);
        }
      })
    );

    return available;
  };

  let found = await probeItagsOnOrigin(activeCompanionOrigin);
  if (found.size === 0) {
    const refreshed = await discoverCompanionOrigin(videoId);
    found = await probeItagsOnOrigin(refreshed);
  }

  const qualities: YoutubeResolvedQuality[] = [];
  const hasAudio = found.has(140);

  if (hasAudio && (found.has(299) || found.has(137))) {
    const is60 = found.has(299);
    qualities.push({
      height: 1080,
      label: is60 ? '1080p60 HD' : '1080p HD',
      videoItag: is60 ? 299 : 137,
      audioItag: 140,
      fps: is60 ? 60 : 30,
    });
  }

  if (hasAudio && (found.has(298) || found.has(136))) {
    const is60 = found.has(298);
    qualities.push({
      height: 720,
      label: is60 ? '720p60 HD' : '720p HD',
      videoItag: is60 ? 298 : 136,
      audioItag: 140,
      fps: is60 ? 60 : 30,
    });
  }

  if (hasAudio && found.has(135)) {
    qualities.push({
      height: 480,
      label: '480p',
      videoItag: 135,
      audioItag: 140,
      fps: 30,
    });
  }

  qualities.push({
    height: 360,
    label: '360p',
    videoItag: 18,
    audioItag: null,
    fps: 30,
  });

  if (found.size > 0) {
    ytQualitiesCache.set(videoId, {
      qualities,
      expiresAt: Date.now() + 30 * 60_000,
    });
  }

  return qualities;
}

// Per-viewer stateless quality discovery endpoint (never mutates shared broadcast state)
app.get('/api/yt/qualities/:videoId', async (req, res) => {
  const videoId = String(req.params.videoId || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    res.status(400).json({ qualities: [] });
    return;
  }
  try {
    const qualities = await resolveYoutubeQualities(videoId);
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.json({ videoId, qualities });
  } catch {
    res.json({
      videoId,
      qualities: [
        { height: 360, label: '360p', videoItag: 18, audioItag: null, fps: 30 },
      ],
    });
  }
});

app.get('/api/yt/stream/:videoId', async (req, res) => {
  const videoId = String(req.params.videoId || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    res.status(400).send('Invalid YouTube video ID');
    return;
  }

  const rawItag = Number(req.query.itag || 18);
  const itag = ALLOWED_YT_ITAGS.has(rawItag) ? rawItag : 18;
  const bytesCacheKey = `${videoId}:${itag}`;
  const fallbackMime = itag === 140 ? 'audio/mp4' : 'video/mp4';

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  const buildUpstreamUrl = (origin: string) =>
    `${origin}/companion/latest_version?id=${encodeURIComponent(
      videoId
    )}&itag=${itag}&local=true`;

  try {
    const rawRange = req.headers.range;
    let start = 0;
    let requestedEnd: number | undefined;
    if (rawRange) {
      const m = rawRange.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        start = Number(m[1]);
        if (m[2]) requestedEnd = Number(m[2]);
      }
    }

    const knownTotal = ytStreamTotalBytesCache.get(bytesCacheKey);
    const initialMaxEnd =
      knownTotal !== undefined
        ? Math.min(
            knownTotal - 1,
            requestedEnd !== undefined
              ? Math.min(requestedEnd, start + YT_CHUNK_BYTES - 1)
              : start + YT_CHUNK_BYTES - 1
          )
        : requestedEnd !== undefined
          ? Math.min(requestedEnd, start + YT_CHUNK_BYTES - 1)
          : start + YT_CHUNK_BYTES - 1;

    const fetchWithRange = async (origin: string, rangeHeader: string) =>
      fetch(buildUpstreamUrl(origin), {
        signal: abortController.signal,
        headers: {
          'User-Agent': YT_STREAM_UA,
          Range: rangeHeader,
        },
      });

    let upstream = await fetchWithRange(
      activeCompanionOrigin,
      `bytes=${start}-${initialMaxEnd}`
    );

    if (upstream.status >= 500 || upstream.status === 404) {
      await upstream.body?.cancel().catch(() => {});
      const refreshedOrigin = await discoverCompanionOrigin(videoId);
      upstream = await fetchWithRange(
        refreshedOrigin,
        `bytes=${start}-${initialMaxEnd}`
      );
    }

    let contentRange = upstream.headers.get('content-range') || '';
    const totalMatch = contentRange.match(/\/(\d+)$/);

    if (totalMatch?.[1]) {
      ytStreamTotalBytesCache.set(bytesCacheKey, Number(totalMatch[1]));
    } else if (contentRange.endsWith('/*')) {
      // Cold stream without cached clen on bounded range: fetch open-ended to learn exact total size
      await upstream.body?.cancel().catch(() => {});
      upstream = await fetchWithRange(activeCompanionOrigin, `bytes=${start}-`);
      contentRange = upstream.headers.get('content-range') || '';
      const openTotalMatch = contentRange.match(/\/(\d+)$/);
      if (openTotalMatch?.[1]) {
        const total = Number(openTotalMatch[1]);
        ytStreamTotalBytesCache.set(bytesCacheKey, total);
        const cappedEnd = Math.min(total - 1, start + YT_CHUNK_BYTES - 1);
        const expectedBytes = cappedEnd - start + 1;

        res.status(206);
        res.setHeader('Content-Type', fallbackMime);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Range', `bytes ${start}-${cappedEnd}/${total}`);
        res.setHeader('Content-Length', String(expectedBytes));
        res.setHeader('Cache-Control', 'public, max-age=600');

        if (!upstream.body) {
          res.end();
          return;
        }

        let bytesSent = 0;
        const reader = upstream.body.getReader();
        while (bytesSent < expectedBytes) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          const remaining = expectedBytes - bytesSent;
          const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
          bytesSent += slice.byteLength;
          if (!res.write(slice)) {
            await new Promise<void>((resolve) => res.once('drain', resolve));
          }
          if (bytesSent >= expectedBytes) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
        res.end();
        return;
      }
    }

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).send('YouTube stream unavailable');
      return;
    }

    res.status(rawRange && contentRange ? 206 : upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || fallbackMime
    );
    res.setHeader('Accept-Ranges', 'bytes');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    res.setHeader('Cache-Control', 'public, max-age=600');

    if (!upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(
      upstream.body as unknown as NodeWebReadableStream
    );
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    nodeStream.pipe(res);
  } catch {
    if (!res.headersSent) {
      res.status(502).end();
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// ============================================================================
// CSP-Compliant Thumbnail Proxy (/api/tv/thumb) for Web & Discord Activity
// ============================================================================

const thumbMemoryCache = new Map<
  string,
  { buffer: Buffer; contentType: string; expiresAt: number }
>();

function isAllowedThumbHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return (
      h === 'i.ytimg.com' ||
      h === 'i1.ytimg.com' ||
      h === 'i2.ytimg.com' ||
      h === 'i3.ytimg.com' ||
      h === 'i4.ytimg.com' ||
      h === 'img.youtube.com' ||
      h === 'yt3.ggpht.com' ||
      h === 'static-cdn.jtvnw.net' ||
      h.endsWith('.jtvnw.net') ||
      h.endsWith('.twitch.tv') ||
      h.endsWith('.ytimg.com')
    );
  } catch {
    return false;
  }
}

app.get('/api/tv/thumb', async (req, res) => {
  const ytId = String(req.query.yt || '').trim();
  const rawUrl = String(req.query.u || '').trim();

  const candidateUrls: string[] = [];
  if (/^[a-zA-Z0-9_-]{11}$/.test(ytId)) {
    candidateUrls.push(
      `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`
    );
  } else if (rawUrl && isAllowedThumbHost(rawUrl)) {
    candidateUrls.push(rawUrl);
    const ytMatch = rawUrl.match(/\/vi\/([a-zA-Z0-9_-]{11})\//);
    if (ytMatch?.[1]) {
      candidateUrls.push(`https://i.ytimg.com/vi/${ytMatch[1]}/mqdefault.jpg`);
    }
  } else {
    res.status(400).send('Invalid thumbnail query');
    return;
  }

  const cacheKey = candidateUrls[0];
  const cached = thumbMemoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(cached.buffer);
    return;
  }

  for (const target of candidateUrls) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const upstream = await fetch(target, {
        signal: ac.signal,
        headers: { 'User-Agent': YT_STREAM_UA },
      });
      clearTimeout(timer);
      if (!upstream.ok) continue;

      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      const arrBuf = await upstream.arrayBuffer();
      const buffer = Buffer.from(arrBuf);
      if (buffer.byteLength < 200) continue;

      if (thumbMemoryCache.size >= 120) {
        const oldestKey = thumbMemoryCache.keys().next().value;
        if (oldestKey) thumbMemoryCache.delete(oldestKey);
      }
      thumbMemoryCache.set(cacheKey, {
        buffer,
        contentType,
        expiresAt: Date.now() + 30 * 60_000,
      });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buffer);
      return;
    } catch {
      // Try next fallback candidate
    }
  }

  res.status(404).end();
});


const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  const pathname = (request.url || '').split('?')[0];
  if (pathname === '/ws' || pathname === '/.proxy/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

function getPublicState(): BroadcastState {
  return {
    ...state,
    keepAlive: buildKeepAliveStats(),
    serverTime: Date.now(),
    connectedViewers: wss.clients.size,
  };
}

function broadcastFullState() {
  const payload = JSON.stringify({
    type: 'state:sync',
    payload: getPublicState(),
  });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function broadcastViewerCount() {
  const payload = JSON.stringify({
    type: 'viewers:count',
    payload: { connectedViewers: wss.clients.size, serverTime: Date.now() },
  });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on('connection', (socket) => {
  state.connectedViewers = wss.clients.size;
  socket.send(
    JSON.stringify({
      type: 'state:sync',
      payload: getPublicState(),
    })
  );
  broadcastViewerCount();

  socket.on('message', async (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type: string;
        payload?: Record<string, unknown>;
      };

      switch (msg.type) {
        case 'mode:set': {
          const nextMode = msg.payload?.mode as BroadcastMode | undefined;
          if (
            nextMode === 'auto' ||
            nextMode === 'force_twitch' ||
            nextMode === 'force_youtube'
          ) {
            const prevSource = state.activeSource;
            state.mode = nextMode;
            state.activeSource = computeDesiredSource(nextMode, state.twitch.isLive);

            const modeLabel =
              nextMode === 'auto'
                ? 'Mode Automatique (Priorité Direct Twitch)'
                : nextMode === 'force_twitch'
                  ? 'Forçage manuel sur Twitch Direct'
                  : 'Forçage manuel sur Grille Vidéos';

            if (prevSource !== state.activeSource && state.activeSource === 'youtube') {
              const vid = state.playlist[state.currentIndex];
              state.currentVideoStartedAt =
                Date.now() - getProgramEntryOffsetSeconds(vid) * 1000;
            }
            appendTransition(modeLabel, state.activeSource);
            broadcastFullState();
          }
          break;
        }

        case 'playlist:next': {
          const requireHls = Boolean(msg.payload?.requireHls);
          advancePlaylist('Passage manuel au programme suivant', 1, requireHls);
          broadcastFullState();
          break;
        }

        case 'playlist:prev': {
          const requireHls = Boolean(msg.payload?.requireHls);
          advancePlaylist('Retour au programme précédent', -1, requireHls);
          broadcastFullState();
          break;
        }

        case 'playlist:select': {
          const videoId = String(msg.payload?.videoId || '');
          const requestedStart =
            typeof msg.payload?.startSeconds === 'number' &&
            Number.isFinite(msg.payload.startSeconds)
              ? Math.max(0, Math.round(msg.payload.startSeconds))
              : null;
          const idx = state.playlist.findIndex((v) => v.id === videoId);
          if (idx >= 0) {
            state.currentIndex = idx;
            const offsetSec =
              requestedStart !== null
                ? requestedStart
                : getProgramEntryOffsetSeconds(state.playlist[idx]);
            state.currentVideoStartedAt = Date.now() - offsetSec * 1000;
            if (state.activeSource === 'twitch') {
              state.mode = 'force_youtube';
              state.activeSource = 'youtube';
            }
            appendTransition(
              requestedStart !== null
                ? `Sélection directe à ${formatTimecode(offsetSec)} : ${state.playlist[idx].title}`
                : `Sélection directe : ${state.playlist[idx].title}`,
              state.activeSource
            );
            broadcastFullState();
          }
          break;
        }

        case 'playlist:play_next': {
          const videoId = String(msg.payload?.videoId || '');
          const fromIdx = state.playlist.findIndex((v) => v.id === videoId);
          if (fromIdx >= 0 && fromIdx !== state.currentIndex && state.playlist.length > 1) {
            const currentId = state.playlist[state.currentIndex]?.id;
            const [movedItem] = state.playlist.splice(fromIdx, 1);
            const updatedCurrentIdx = currentId
              ? Math.max(
                  0,
                  state.playlist.findIndex((v) => v.id === currentId)
                )
              : 0;
            const insertIdx = Math.min(state.playlist.length, updatedCurrentIdx + 1);
            state.playlist.splice(insertIdx, 0, movedItem);
            state.currentIndex = updatedCurrentIdx;
            appendTransition(`Programmé à suivre : ${movedItem.title}`, state.activeSource);
            broadcastFullState();
          }
          break;
        }

        case 'video:seek': {
          const targetSeconds = Math.max(0, Math.round(Number(msg.payload?.seconds || 0)));
          const current = state.playlist[state.currentIndex];
          if (current && state.activeSource === 'youtube') {
            const clamped = Math.min(
              Math.max(0, current.durationSeconds - 10),
              targetSeconds
            );
            state.currentVideoStartedAt = Date.now() - clamped * 1000;
            broadcastFullState();
          }
          break;
        }

        case 'playlist:shuffle': {
          state.shuffleYoutube = Boolean(msg.payload?.shuffle);
          broadcastFullState();
          break;
        }

        case 'theme:set': {
          const rawTheme = String(msg.payload?.theme || 'all');
          const allowedThemes: Array<ProgramTheme | 'all'> = [
            'all',
            'entretiens',
            'conferences',
            'vlogs',
            'meetings',
            'assemblee',
            'international',
          ];
          if (allowedThemes.includes(rawTheme as ProgramTheme | 'all')) {
            const nextTheme = rawTheme as ProgramTheme | 'all';
            state.activeThemeFilter = nextTheme;
            if (nextTheme !== 'all') {
              const current = state.playlist[state.currentIndex];
              if (!current || current.theme !== nextTheme) {
                const matchIdx = state.playlist.findIndex((v) => v.theme === nextTheme);
                if (matchIdx >= 0) {
                  state.currentIndex = matchIdx;
                  state.currentVideoStartedAt =
                    Date.now() - getProgramEntryOffsetSeconds(state.playlist[matchIdx]) * 1000;
                }
              }
              appendTransition(
                `Programmation thématique activée : ${getThemeDefinition(nextTheme).label}`,
                state.activeSource
              );
            } else {
              appendTransition(
                'Programmation H24 ouverte à toutes les thématiques',
                state.activeSource
              );
            }
            broadcastFullState();
          }
          break;
        }

        case 'banner:flash': {
          state.flashBannerTriggeredAt = Date.now();
          broadcastFullState();
          break;
        }

        case 'banner:left': {
          const requestedIdx = msg.payload?.bannerIndex;
          if (typeof requestedIdx === 'number' && requestedIdx >= 0 && requestedIdx <= 8) {
            state.leftBannerManualIndex = Math.floor(requestedIdx);
          } else {
            state.leftBannerManualIndex = ((state.leftBannerManualIndex ?? -1) + 1) % 9;
          }
          state.leftBannerTriggeredAt = Date.now();
          broadcastFullState();
          break;
        }

        case 'playlist:add': {
          const rawUrl = String(msg.payload?.url || '');
          const playImmediately = Boolean(msg.payload?.playNow);
          await addMediaItemToPlaylist(rawUrl, playImmediately);
          break;
        }

        case 'playlist:remove': {
          const videoId = String(msg.payload?.videoId || '');
          if (state.playlist.length <= 1) break;
          const idx = state.playlist.findIndex((v) => v.id === videoId);
          if (idx >= 0) {
            removedVideoIds.add(videoId);
            const wasCurrent = idx === state.currentIndex;
            state.playlist = state.playlist.filter((v) => v.id !== videoId);
            if (state.currentIndex >= state.playlist.length) {
              state.currentIndex = 0;
            }
            if (wasCurrent) {
              const nextCurrent = state.playlist[state.currentIndex];
              state.currentVideoStartedAt =
                Date.now() - getProgramEntryOffsetSeconds(nextCurrent) * 1000;
            }
            saveCustomVideos(state.playlist);
            broadcastFullState();
          }
          break;
        }

        case 'video:duration': {
          const videoId = String(msg.payload?.videoId || '');
          const durationSeconds = Math.round(Number(msg.payload?.durationSeconds || 0));
          if (videoId && durationSeconds >= 10 && durationSeconds <= 86400) {
            durationCache.set(videoId, durationSeconds);
            const item = state.playlist.find((v) => v.id === videoId);
            if (item && Math.abs(item.durationSeconds - durationSeconds) > 2) {
              item.durationSeconds = durationSeconds;
              item.chapters = ensureVideoChapters({
                id: item.id,
                title: item.title,
                durationSeconds,
                theme: item.theme,
                twitchVodId: item.twitchVodId,
                rawChapters: item.chapters,
              });
              broadcastFullState();
            }
          }
          break;
        }

        case 'video:ended': {
          const videoId = String(msg.payload?.videoId || '');
          const current = state.playlist[state.currentIndex];
          if (
            state.activeSource === 'youtube' &&
            current &&
            current.id === videoId &&
            Date.now() - state.currentVideoStartedAt > 5000
          ) {
            advancePlaylist('Fin du programme — Enchaînement grille H24', 1);
            broadcastFullState();
          }
          break;
        }

        case 'video:error': {
          const videoId = String(msg.payload?.videoId || '');
          const current = state.playlist[state.currentIndex];
          if (videoId && current && current.id === videoId && state.playlist.length > 1) {
            unplayableVideoIds.add(videoId);
            state.playlist = state.playlist.filter((v) => v.id !== videoId);
            if (state.currentIndex >= state.playlist.length) {
              state.currentIndex = 0;
            }
            const nextCurrent = state.playlist[state.currentIndex];
            state.currentVideoStartedAt =
              Date.now() - getProgramEntryOffsetSeconds(nextCurrent) * 1000;
            appendTransition(
              `Vidéo indisponible ignorée — Passage automatique au programme suivant`,
              'youtube'
            );
            broadcastFullState();
          }
          break;
        }

        case 'chat:send': {
          const id = String(msg.payload?.id || crypto.randomUUID());
          if (processedMessageIds.has(id)) break;
          processedMessageIds.add(id);
          if (processedMessageIds.size > 500) {
            const first = processedMessageIds.values().next().value;
            if (first) processedMessageIds.delete(first);
          }

          const author = String(msg.payload?.author || 'Spectateur').slice(0, 32).trim();
          const text = String(msg.payload?.text || '').slice(0, 280).trim();
          if (!text) break;

          const chatEntry: ChatMessage = {
            id,
            author: author || 'Spectateur',
            text,
            createdAt: new Date().toISOString(),
          };
          state.chatMessages = [...state.chatMessages, chatEntry].slice(-50);

          const eventPayload = JSON.stringify({
            type: 'chat:created',
            payload: chatEntry,
          });
          for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(eventPayload);
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error('[WS Message Error]:', err);
    }
  });

  socket.on('close', () => {
    state.connectedViewers = wss.clients.size;
    broadcastViewerCount();
  });
});

async function addMediaItemToPlaylist(
  rawUrl: string,
  playImmediately: boolean
): Promise<{
  ok: boolean;
  discordSupported: boolean;
  message: string;
  item?: YouTubeVideoItem;
}> {
  const twitchParsed = parseTwitchInput(rawUrl);

  // 1. Twitch VOD URL or numeric VOD ID
  if (twitchParsed?.kind === 'vod') {
    const vodId = twitchParsed.vodId;
    const itemId = `vod-${vodId}`;
    unplayableVideoIds.delete(itemId);

    let title = `Rediffusion Twitch #${vodId}`;
    let durationSeconds = 3600;
    let thumbnailUrl = '';
    let views = 0;
    let publishedAt = new Date().toISOString();

    try {
      const gqlRes = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-Id': TWITCH_PUBLIC_CLIENT_ID,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `query {
            video(id: "${vodId}") {
              id
              title
              lengthSeconds
              publishedAt
              viewCount
              previewThumbnailURL(width: 640, height: 360)
            }
          }`,
        }),
      });
      if (gqlRes.ok) {
        const json = (await gqlRes.json()) as {
          data?: {
            video?: {
              title?: string;
              lengthSeconds?: number;
              publishedAt?: string;
              viewCount?: number;
              previewThumbnailURL?: string;
            } | null;
          };
        };
        const v = json?.data?.video;
        if (!v?.lengthSeconds) {
          return {
            ok: false,
            discordSupported: false,
            message: 'Cette vidéo Twitch est introuvable ou privée.',
          };
        }
        title = v.title || title;
        durationSeconds = v.lengthSeconds;
        thumbnailUrl = v.previewThumbnailURL || '';
        views = v.viewCount ?? 0;
        publishedAt = v.publishedAt || publishedAt;
      }
    } catch {
      // Fallback defaults
    }

    const newItem: YouTubeVideoItem = hydrateVideoMetadata({
      id: itemId,
      twitchVodId: vodId,
      title,
      publishedAt,
      thumbnailUrl,
      views,
      durationSeconds,
      sourceType: 'custom',
    });

    const existingIdx = state.playlist.findIndex((v) => v.id === itemId);
    if (existingIdx === -1) {
      state.playlist = [newItem, ...state.playlist];
      if (playImmediately) {
        state.currentIndex = 0;
      } else {
        state.currentIndex += 1;
      }
    } else if (playImmediately) {
      state.currentIndex = existingIdx;
    }

    if (playImmediately) {
      state.currentVideoStartedAt =
        Date.now() - getProgramEntryOffsetSeconds(newItem) * 1000;
      if (state.activeSource === 'twitch') {
        state.mode = 'force_youtube';
        state.activeSource = 'youtube';
      }
      appendTransition(`Diffusion immédiate Twitch VOD : ${title}`, 'youtube');
    } else {
      appendTransition(`Vidéo Twitch ajoutée à la grille : ${title}`, state.activeSource);
    }

    saveCustomVideos(state.playlist);
    broadcastFullState();
    return {
      ok: true,
      discordSupported: true,
      message: playImmediately
        ? `À l’antenne sur le site et sur Discord : ${title}`
        : `Ajouté à la grille (compatible Discord) : ${title}`,
      item: newItem,
    };
  }

  // 2. Twitch Channel URL (Live stream or fallback to latest archive)
  if (twitchParsed?.kind === 'channel') {
    const login = twitchParsed.login;
    try {
      const gqlRes = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-Id': TWITCH_PUBLIC_CLIENT_ID,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `query {
            user(login: "${login}") {
              login
              displayName
              profileImageURL(width: 300)
              stream { id title type }
              videos(first: 1, type: ARCHIVE) {
                edges {
                  node {
                    id
                    title
                    lengthSeconds
                    publishedAt
                    viewCount
                    previewThumbnailURL(width: 640, height: 360)
                  }
                }
              }
            }
          }`,
        }),
      });
      const json = (await gqlRes.json()) as {
        data?: {
          user?: {
            login?: string;
            displayName?: string;
            profileImageURL?: string;
            stream?: { id?: string; title?: string; type?: string } | null;
            videos?: {
              edges?: Array<{
                node?: {
                  id?: string;
                  title?: string;
                  lengthSeconds?: number;
                  publishedAt?: string;
                  viewCount?: number;
                  previewThumbnailURL?: string;
                };
              }>;
            };
          } | null;
        };
      };
      const u = json?.data?.user;
      if (!u) {
        return {
          ok: false,
          discordSupported: false,
          message: `La chaîne Twitch "${login}" est introuvable.`,
        };
      }

      if (u.stream && u.stream.type === 'live') {
        const itemId = `channel-${login}`;
        const liveTitle = `DIRECT · ${u.displayName || login} — ${u.stream.title || 'En direct'}`;
        const newItem: YouTubeVideoItem = hydrateVideoMetadata({
          id: itemId,
          twitchChannelLogin: login,
          title: liveTitle,
          publishedAt: new Date().toISOString(),
          thumbnailUrl: u.profileImageURL || '',
          views: 0,
          durationSeconds: 43200,
          sourceType: 'custom',
        });
        const existingIdx = state.playlist.findIndex((v) => v.id === itemId);
        if (existingIdx === -1) {
          state.playlist = [newItem, ...state.playlist];
          state.currentIndex = playImmediately ? 0 : state.currentIndex + 1;
        } else if (playImmediately) {
          state.currentIndex = existingIdx;
        }
        if (playImmediately) {
          state.currentVideoStartedAt = Date.now();
          state.mode = 'force_youtube';
          state.activeSource = 'youtube';
          appendTransition(`Direct Twitch lancé : ${liveTitle}`, 'youtube');
        }
        broadcastFullState();
        return {
          ok: true,
          discordSupported: true,
          message: `Direct Twitch "${u.displayName || login}" diffusé sur le site et sur Discord !`,
          item: newItem,
        };
      }

      const latestVod = u.videos?.edges?.[0]?.node;
      if (latestVod?.id && latestVod.lengthSeconds) {
        return addMediaItemToPlaylist(
          `https://www.twitch.tv/videos/${latestVod.id}`,
          playImmediately
        );
      }

      return {
        ok: false,
        discordSupported: false,
        message: `La chaîne Twitch "${login}" n’est pas en direct et n’a aucune rediffusion publique.`,
      };
    } catch {
      return {
        ok: false,
        discordSupported: false,
        message: 'Impossible de contacter Twitch pour cette chaîne.',
      };
    }
  }

  // 3. YouTube Playlist URL (e.g. https://www.youtube.com/playlist?list=PL...)
  const playlistId = extractYoutubePlaylistId(rawUrl);
  if (playlistId) {
    const playlistItems = await fetchYoutubeRssXmlItems(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`,
      { maxItems: 15 }
    );
    if (playlistItems.length === 0) {
      return {
        ok: false,
        discordSupported: false,
        message: 'Playlist YouTube introuvable ou ne contenant que des Shorts.',
      };
    }

    const existingIds = new Set(state.playlist.map((v) => v.id));
    const addedItems: YouTubeVideoItem[] = [];
    for (const item of playlistItems) {
      removedVideoIds.delete(item.id);
      if (!existingIds.has(item.id)) {
        addedItems.push({ ...item, sourceType: 'custom' });
        existingIds.add(item.id);
      }
    }

    if (addedItems.length > 0) {
      state.playlist = [...addedItems, ...state.playlist];
      if (playImmediately) {
        state.currentIndex = 0;
        state.currentVideoStartedAt = Date.now();
        if (state.activeSource === 'twitch') {
          state.mode = 'force_youtube';
          state.activeSource = 'youtube';
        }
      } else {
        state.currentIndex += addedItems.length;
      }
      saveCustomVideos(state.playlist);
      broadcastFullState();
      void hydratePlaylistChaptersInBackground(false);
    }

    return {
      ok: true,
      discordSupported: true,
      message: `${addedItems.length || playlistItems.length} vidéos longues importées depuis la playlist (Shorts exclus).`,
      item: addedItems[0] || playlistItems[0],
    };
  }

  // 4. Reject explicit YouTube Shorts links
  if (/youtube\.com\/shorts\//i.test(rawUrl)) {
    return {
      ok: false,
      discordSupported: false,
      message:
        'Les YouTube Shorts sont désactivés dans la programmation TV H24. Ajoutez une vidéo longue ou une playlist.',
    };
  }

  // 5. YouTube Video URL or 11-char ID (Direct MP4 Proxy works in both Web & Discord Activity!)
  const videoId = extractYoutubeVideoId(rawUrl);
  if (!videoId) {
    return {
      ok: false,
      discordSupported: false,
      message:
        'Lien non reconnu. Collez un lien YouTube (watch?v=..., playlist?list=...) ou un lien Twitch.',
    };
  }

  unplayableVideoIds.delete(videoId);
  removedVideoIds.delete(videoId);
  const details = await fetchYoutubeVideoDetails(videoId, true);

  if (details.isShort) {
    return {
      ok: false,
      discordSupported: false,
      message: 'Cette vidéo est un YouTube Short : seuls les formats longs sont diffusés sur l’antenne.',
    };
  }

  const existingIdx = state.playlist.findIndex((v) => v.id === videoId);
  const newItem: YouTubeVideoItem = hydrateVideoMetadata({
    id: videoId,
    title: details.title,
    publishedAt: new Date().toISOString(),
    thumbnailUrl: `https://i2.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    views: details.views,
    durationSeconds: details.durationSeconds,
    sourceType: 'custom',
    chapters: details.rawChapters,
    description: details.description,
    chaptersHydrated: true,
  });

  if (existingIdx === -1) {
    state.playlist = [newItem, ...state.playlist];
    if (playImmediately) {
      state.currentIndex = 0;
    } else {
      state.currentIndex += 1;
    }
  } else {
    state.playlist[existingIdx] = hydrateVideoMetadata({
      ...state.playlist[existingIdx],
      title: details.title || state.playlist[existingIdx].title,
      durationSeconds:
        details.durationSeconds || state.playlist[existingIdx].durationSeconds,
      chapters:
        details.rawChapters.length > 0
          ? details.rawChapters
          : state.playlist[existingIdx].chapters,
      description: details.description,
      chaptersHydrated: true,
    });
    if (playImmediately) {
      state.currentIndex = existingIdx;
    }
  }

  if (playImmediately) {
    state.currentVideoStartedAt = Date.now();
    if (state.activeSource === 'twitch') {
      state.mode = 'force_youtube';
      state.activeSource = 'youtube';
    }
    appendTransition(`Diffusion immédiate YouTube : ${details.title}`, 'youtube');
  } else {
    appendTransition(`Vidéo YouTube ajoutée à la grille : ${details.title}`, state.activeSource);
  }

  saveCustomVideos(state.playlist);
  saveVideoMetaCache();
  broadcastFullState();

  return {
    ok: true,
    discordSupported: true,
    message: playImmediately
      ? `À l’antenne sur Discord et sur le site : ${details.title}`
      : `Ajouté à la grille H24 (Discord & Web) : ${details.title}`,
    item: newItem,
  };
}

app.get('/api/tv/state', (_req, res) => {
  res.json(getPublicState());
});

app.get('/api/tv/youtube-search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ results: [] });
    return;
  }
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const upstream = await fetch(
      `https://api.piped.private.coffee/search?q=${encodeURIComponent(q)}&filter=videos`,
      {
        signal: ac.signal,
        headers: { 'User-Agent': YT_STREAM_UA },
      }
    );
    clearTimeout(timer);
    if (!upstream.ok) {
      res.json({ results: [] });
      return;
    }
    const data = (await upstream.json()) as {
      items?: Array<{
        url?: string;
        title?: string;
        thumbnail?: string;
        uploaderName?: string;
        duration?: number;
        views?: number;
        isShort?: boolean;
      }>;
    };
    const results = (data.items || [])
      .map((item) => {
        if (item.isShort || item.url?.includes('/shorts/')) return null;
        const vid = item.url ? extractYoutubeVideoId(`https://www.youtube.com${item.url}`) : null;
        if (!vid || !item.title || !item.duration || item.duration < MIN_TV_PROGRAM_DURATION_SEC) {
          return null;
        }
        return {
          videoId: vid,
          title: item.title,
          thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
          channelName: item.uploaderName || 'YouTube',
          durationSeconds: Math.round(item.duration),
          views: item.views ?? 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .slice(0, 12);
    res.json({ results });
  } catch {
    res.json({ results: [] });
  }
});

app.post('/api/tv/playlist/add', async (req, res) => {
  const rawUrl = String(req.body?.url || '');
  const playNow = Boolean(req.body?.playNow);
  const result = await addMediaItemToPlaylist(rawUrl, playNow);
  res.status(result.ok ? 200 : 400).json({
    ...result,
    state: getPublicState(),
  });
});

app.post('/api/tv/probe', async (_req, res) => {
  await Promise.all([probeTwitchChannel(), syncYoutubeFeed()]);
  res.json(getPublicState());
});

app.post('/api/tv/chapters/refresh', async (_req, res) => {
  await syncYoutubeFeed();
  await hydratePlaylistChaptersInBackground(true);
  res.json(getPublicState());
});

async function runKeepAliveWatchdog(): Promise<void> {
  const targetOrigin = detectedExternalOrigin || `http://127.0.0.1:${PORT}`;
  const isExternal = Boolean(detectedExternalOrigin);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12_000);
    const res = await fetch(`${targetOrigin}/api/health?source=render-watchdog`, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'JLMTelevision-RenderKeepAlive/1.0',
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);
    if (res.ok) {
      lastKeepAliveAt = new Date().toISOString();
      lastKeepAliveStatus = isExternal ? 'ok' : 'local';
      if (!isExternal) {
        keepAlivePingCount += 1;
      }
    } else {
      lastKeepAliveStatus = 'error';
    }
  } catch {
    lastKeepAliveStatus = 'error';
  }
}

app.post('/api/tv/keepalive/ping', async (_req, res) => {
  await runKeepAliveWatchdog();
  res.json(getPublicState());
});

app.get('/api/tv/bot-directive', (_req, res) => {
  const currentVideo = state.playlist[state.currentIndex] || null;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - state.currentVideoStartedAt) / 1000)
  );
  res.json({
    activeSource: state.activeSource,
    mode: state.mode,
    twitchUrl: `https://www.twitch.tv/${TWITCH_LOGIN}`,
    twitchLive: state.twitch.isLive,
    twitchTitle: state.twitch.title,
    youtubeVideoId: currentVideo?.id || null,
    youtubeUrl: currentVideo
      ? currentVideo.twitchVodId
        ? `https://www.twitch.tv/videos/${currentVideo.twitchVodId}`
        : `https://www.youtube.com/watch?v=${currentVideo.id}`
      : null,
    youtubeTitle: currentVideo?.title || null,
    seekSeconds: state.activeSource === 'youtube' ? elapsedSeconds : 0,
    serverTime: Date.now(),
  });
});

setInterval(() => {
  void probeTwitchChannel();
}, 30_000);

setInterval(() => {
  void syncYoutubeFeed();
}, 600_000);

// Render H24 Anti-Sleep Watchdog (pings external URL every 4 minutes < 15m idle sleep threshold)
setInterval(() => {
  void runKeepAliveWatchdog();
}, KEEPALIVE_INTERVAL_SEC * 1000);

setInterval(() => {
  if (state.activeSource === 'youtube' && state.playlist.length > 0) {
    const current = state.playlist[state.currentIndex];
    if (!current) return;
    const elapsedSec = (Date.now() - state.currentVideoStartedAt) / 1000;
    const outroTrimSec =
      current.twitchVodId && current.durationSeconds >= 1200 ? 90 : 0;
    if (elapsedSec >= Math.max(30, current.durationSeconds - outroTrimSec) + 2) {
      advancePlaylist('Rotation H24 automatique', 1);
      broadcastFullState();
    }
  }
}, 2_000);

async function bootstrap() {
  void Promise.all([probeTwitchChannel(), syncYoutubeFeed()]);
  setTimeout(() => {
    void runKeepAliveWatchdog();
  }, 8_000);

  const isProd =
    process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'start';
  const distPath = path.join(process.cwd(), 'dist');

  if (isProd && fs.existsSync(path.join(distPath, 'index.html'))) {
    app.use('/src/assets', express.static(path.join(process.cwd(), 'src', 'assets')));
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[JLM Télévision H24] Régie active sur http://0.0.0.0:${PORT}`);
  });
}

void bootstrap();
