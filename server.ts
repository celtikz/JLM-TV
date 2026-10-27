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
  TransitionLog,
  TwitchStatus,
  YouTubeVideoItem,
} from './src/types/broadcast.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const TWITCH_LOGIN = 'jlmelenchon';
const YOUTUBE_CHANNEL_ID = 'UCk-_PEY3iC6DIGJKuoEe9bw';
const TWITCH_PUBLIC_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

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
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const pathMatch = url.pathname.match(/\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
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

const DEFAULT_CUSTOM_VIDEOS: YouTubeVideoItem[] = [
  {
    id: '5qS3PZkpC64',
    title: 'Jean-Luc Mélenchon : discussion sans filtre avec François Lenglet (Présidentielle 2027)',
    publishedAt: '2026-10-25T18:00:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/5qS3PZkpC64/hqdefault.jpg',
    views: 1200000,
    durationSeconds: 8614,
    sourceType: 'custom',
  },
];

function loadSavedCustomVideos(): YouTubeVideoItem[] {
  try {
    if (fs.existsSync(CUSTOM_VIDEOS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CUSTOM_VIDEOS_FILE, 'utf-8')) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as YouTubeVideoItem[];
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
  {
    id: 'vod-2906055180',
    twitchVodId: '2906055180',
    title: 'Conférence de Jean-Luc Mélenchon sur le moment politique !',
    publishedAt: '2026-10-20T17:28:10Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/SJ1BhZdb8sI/hqdefault.jpg',
    views: 90035,
    durationSeconds: 6257,
    sourceType: 'rss',
  },
  {
    id: 'vod-2900414335',
    twitchVodId: '2900414335',
    title: 'Conférence de presse de Jean-Luc Mélenchon et Éric Coquerel',
    publishedAt: '2026-10-14T09:29:00Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/msIb2rNDSTA/hqdefault.jpg',
    views: 40761,
    durationSeconds: 5253,
    sourceType: 'rss',
  },
  {
    id: 'vod-2897888840',
    twitchVodId: '2897888840',
    title: 'Meeting de Jean-Luc Mélenchon à Clermont-Ferrand !',
    publishedAt: '2026-10-11T13:05:43Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/loxwn3DECHw/hqdefault.jpg',
    views: 62322,
    durationSeconds: 6146,
    sourceType: 'rss',
  },
  {
    id: 'vod-2892736786',
    twitchVodId: '2892736786',
    title: "Conférence de Jean-Luc Mélenchon à l'invitation de HEC Débats !",
    publishedAt: '2026-10-05T17:58:26Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/o6fu63AyFjY/hqdefault.jpg',
    views: 67246,
    durationSeconds: 7903,
    sourceType: 'rss',
  },
  {
    id: 'vod-2889055110',
    twitchVodId: '2889055110',
    title: 'Conférence de Jean-Luc Mélenchon sur le moment politique',
    publishedAt: '2026-10-01T17:18:39Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/7hBEv95Q8Ew/hqdefault.jpg',
    views: 11148,
    durationSeconds: 4614,
    sourceType: 'rss',
  },
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

const initialPlaylist: YouTubeVideoItem[] = [
  ...loadSavedCustomVideos(),
  ...FALLBACK_VIDEOS,
];

let state: BroadcastState = {
  mode: 'auto',
  activeSource: 'youtube',
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
    (v) => v.sourceType === 'custom' && !unplayableVideoIds.has(v.id)
  );
  const existingIds = new Set<string>();
  const combined: YouTubeVideoItem[] = [];

  for (const item of [...customVideos, ...cachedArchiveItems, ...cachedYoutubeRssItems]) {
    if (unplayableVideoIds.has(item.id) || existingIds.has(item.id)) continue;
    existingIds.add(item.id);
    combined.push(item);
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

  const pool = state.playlist.map((item, idx) => ({ item, idx }));

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
      fetchedArchives.push({
        id: `vod-${node.id}`,
        twitchVodId: node.id,
        title: node.title,
        publishedAt: node.publishedAt || new Date().toISOString(),
        thumbnailUrl: node.previewThumbnailURL || '',
        views: node.viewCount ?? 0,
        durationSeconds: node.lengthSeconds,
        sourceType: 'rss',
      });
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

async function syncYoutubeFeed(): Promise<void> {
  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
    const res = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JLMTelevisionBot/1.0)',
      },
    });
    if (!res.ok) {
      throw new Error(`YouTube RSS HTTP ${res.status}`);
    }

    const xml = await res.text();
    const rawEntries = xml.split('<entry>').slice(1);
    const parsedItems: YouTubeVideoItem[] = [];

    for (const entry of rawEntries) {
      const idMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
      const pubMatch = entry.match(/<published>([^<]+)<\/published>/);
      const viewsMatch = entry.match(/<media:statistics\s+views="(\d+)"/);

      if (!idMatch || !titleMatch) continue;
      const id = idMatch[1].trim();
      if (unplayableVideoIds.has(id)) continue;

      const views = viewsMatch ? Number(viewsMatch[1]) : 0;
      if (views === 0) continue;

      const title = decodeXmlEntities(titleMatch[1].trim());
      const publishedAt = pubMatch ? pubMatch[1].trim() : new Date().toISOString();
      const cachedDuration = durationCache.get(id) ?? 1200;

      parsedItems.push({
        id,
        title,
        publishedAt,
        thumbnailUrl: `https://i2.ytimg.com/vi/${id}/hqdefault.jpg`,
        views,
        durationSeconds: cachedDuration,
        sourceType: 'rss',
      });
    }

    if (parsedItems.length > 0) {
      cachedYoutubeRssItems = parsedItems;
      rebuildCombinedPlaylist();
      broadcastFullState();
    }
  } catch (err) {
    console.error('[YouTube RSS Sync Error]:', err);
  }
}

async function fetchYoutubeVideoDetails(videoId: string): Promise<{
  title: string;
  durationSeconds: number;
  views: number;
}> {
  const browserUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

  // 1. Fast Piped metadata API (~200ms, returns exact durationSeconds + views + title)
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
      };
      if (data.title && data.duration && data.duration > 0) {
        durationCache.set(videoId, Math.round(data.duration));
        return {
          title: data.title.trim(),
          durationSeconds: Math.round(data.duration),
          views: data.views ?? 0,
        };
      }
    }
  } catch {
    // Fallback below
  }

  // 2. Fallback: PokeTube OpenGraph meta + YouTube OEmbed
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
  if (req.url.startsWith('/.proxy/')) {
    req.url = req.url.slice('/.proxy'.length);
  } else if (req.url === '/.proxy') {
    req.url = '/';
  }
  next();
});
app.use(express.json());

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
let activeCompanionOrigin = 'https://invid-api.poketube.fun';
let lastCompanionDiscoveryAt = 0;
const ytStreamTotalBytesCache = new Map<string, number>();

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

app.get('/api/yt/stream/:videoId', async (req, res) => {
  const videoId = String(req.params.videoId || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    res.status(400).send('Invalid YouTube video ID');
    return;
  }

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  const buildUpstreamUrl = (origin: string) =>
    `${origin}/companion/latest_version?id=${encodeURIComponent(
      videoId
    )}&itag=18&local=true`;

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

    const knownTotal = ytStreamTotalBytesCache.get(videoId);
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
      ytStreamTotalBytesCache.set(videoId, Number(totalMatch[1]));
    } else if (contentRange.endsWith('/*')) {
      // Cold stream without cached clen on bounded range: fetch open-ended to learn exact total size
      await upstream.body?.cancel().catch(() => {});
      upstream = await fetchWithRange(activeCompanionOrigin, `bytes=${start}-`);
      contentRange = upstream.headers.get('content-range') || '';
      const openTotalMatch = contentRange.match(/\/(\d+)$/);
      if (openTotalMatch?.[1]) {
        const total = Number(openTotalMatch[1]);
        ytStreamTotalBytesCache.set(videoId, total);
        const cappedEnd = Math.min(total - 1, start + YT_CHUNK_BYTES - 1);
        const expectedBytes = cappedEnd - start + 1;

        res.status(206);
        res.setHeader('Content-Type', 'video/mp4');
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
      upstream.headers.get('content-type') || 'video/mp4'
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
          const idx = state.playlist.findIndex((v) => v.id === videoId);
          if (idx >= 0) {
            state.currentIndex = idx;
            state.currentVideoStartedAt =
              Date.now() - getProgramEntryOffsetSeconds(state.playlist[idx]) * 1000;
            if (state.mode === 'auto' && state.twitch.isLive) {
              state.mode = 'force_youtube';
              state.activeSource = 'youtube';
            }
            appendTransition(
              `Sélection directe : ${state.playlist[idx].title}`,
              state.activeSource
            );
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

    const newItem: YouTubeVideoItem = {
      id: itemId,
      twitchVodId: vodId,
      title,
      publishedAt,
      thumbnailUrl,
      views,
      durationSeconds,
      sourceType: 'custom',
    };

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
        const newItem: YouTubeVideoItem = {
          id: itemId,
          twitchChannelLogin: login,
          title: liveTitle,
          publishedAt: new Date().toISOString(),
          thumbnailUrl: u.profileImageURL || '',
          views: 0,
          durationSeconds: 43200,
          sourceType: 'custom',
        };
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

  // 3. YouTube Video URL or 11-char ID (Direct MP4 Proxy works in both Web & Discord Activity!)
  const videoId = extractYoutubeVideoId(rawUrl);
  if (!videoId) {
    return {
      ok: false,
      discordSupported: false,
      message:
        'Lien non reconnu. Collez un lien YouTube (watch?v=..., youtu.be/...) ou un lien Twitch.',
    };
  }

  unplayableVideoIds.delete(videoId);
  const details = await fetchYoutubeVideoDetails(videoId);

  const existingIdx = state.playlist.findIndex((v) => v.id === videoId);
  const newItem: YouTubeVideoItem = {
    id: videoId,
    title: details.title,
    publishedAt: new Date().toISOString(),
    thumbnailUrl: `https://i2.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    views: details.views,
    durationSeconds: details.durationSeconds,
    sourceType: 'custom',
  };

  if (existingIdx === -1) {
    state.playlist = [newItem, ...state.playlist];
    if (playImmediately) {
      state.currentIndex = 0;
    } else {
      state.currentIndex += 1;
    }
  } else {
    state.playlist[existingIdx] = {
      ...state.playlist[existingIdx],
      title: details.title || state.playlist[existingIdx].title,
      durationSeconds:
        details.durationSeconds || state.playlist[existingIdx].durationSeconds,
    };
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
        uploaderName?: string;
        duration?: number;
        views?: number;
      }>;
    };
    const results = (data.items || [])
      .map((item) => {
        const vid = item.url ? extractYoutubeVideoId(`https://www.youtube.com${item.url}`) : null;
        if (!vid || !item.title || !item.duration || item.duration <= 0) return null;
        return {
          videoId: vid,
          title: item.title,
          channelName: item.uploaderName || 'YouTube',
          durationSeconds: Math.round(item.duration),
          views: item.views ?? 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .slice(0, 8);
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
