import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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
      const id = url.pathname.replace('/', '').slice(0, 11);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const shortsMatch = url.pathname.match(/\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    return null;
  }
  return null;
}

const FALLBACK_VIDEOS: YouTubeVideoItem[] = [
  {
    id: 'SJ1BhZdb8sI',
    title: 'Conférence de Jean-Luc Mélenchon sur le moment politique',
    publishedAt: '2026-10-20T19:17:46Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/SJ1BhZdb8sI/hqdefault.jpg',
    views: 673315,
    durationSeconds: 6250,
    sourceType: 'rss',
  },
  {
    id: 'msIb2rNDSTA',
    title: "Conférence de Jean-Luc Mélenchon à l'ESSEC",
    publishedAt: '2026-10-26T09:19:33Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/msIb2rNDSTA/hqdefault.jpg',
    views: 27647,
    durationSeconds: 5400,
    sourceType: 'rss',
  },
  {
    id: 'loxwn3DECHw',
    title: 'Avec la jeunesse et contre la vie chère, déferlante populaire à Paris !',
    publishedAt: '2026-10-24T14:15:12Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/loxwn3DECHw/hqdefault.jpg',
    views: 77875,
    durationSeconds: 2400,
    sourceType: 'rss',
  },
  {
    id: 'o6fu63AyFjY',
    title: 'Le pouvoir doit céder ou il ne restera plus que la porte de sortie',
    publishedAt: '2026-10-24T14:51:15Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/o6fu63AyFjY/hqdefault.jpg',
    views: 557605,
    durationSeconds: 900,
    sourceType: 'rss',
  },
  {
    id: '7hBEv95Q8Ew',
    title: 'La victoire de Lula sera la victoire du peuple',
    publishedAt: '2026-10-23T16:21:17Z',
    thumbnailUrl: 'https://i2.ytimg.com/vi/7hBEv95Q8Ew/hqdefault.jpg',
    views: 211867,
    durationSeconds: 900,
    sourceType: 'rss',
  },
];

const durationCache = new Map<string, number>();
const unplayableVideoIds = new Set<string>();
const processedMessageIds = new Set<string>();

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
  playlist: [...FALLBACK_VIDEOS],
  currentIndex: 0,
  currentVideoStartedAt: Date.now(),
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
      text: 'Synchronisation H24 active : bascule automatique sur twitch.tv/jlmelenchon dès qu’un direct démarre, relais YouTube continu hors antenne.',
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

function advancePlaylist(reason: string, direction: 1 | -1 = 1) {
  if (state.playlist.length === 0) return;

  if (state.shuffleYoutube && state.playlist.length > 1 && direction === 1) {
    let nextIdx = state.currentIndex;
    while (nextIdx === state.currentIndex) {
      nextIdx = Math.floor(Math.random() * state.playlist.length);
    }
    state.currentIndex = nextIdx;
  } else {
    state.currentIndex =
      (state.currentIndex + direction + state.playlist.length) % state.playlist.length;
  }

  state.currentVideoStartedAt = Date.now();
  const current = state.playlist[state.currentIndex];
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
        };
      };
    };

    const user = payload?.data?.user;
    const stream = user?.stream ?? null;
    const isLive = Boolean(stream && stream.type === 'live');

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
        state.currentVideoStartedAt = Date.now();
        const vid = state.playlist[state.currentIndex];
        appendTransition(
          `Fin du direct Twitch — Relais YouTube automatique (${vid ? vid.title : 'Grille JLM'})`,
          'youtube'
        );
      }
      broadcastFullState();
    } else if (wasLive !== isLive) {
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
      // Skip scheduled upcoming premieres that have 0 views and are not yet playable
      if (views === 0) continue;

      const title = decodeXmlEntities(titleMatch[1].trim());
      const publishedAt = pubMatch ? pubMatch[1].trim() : new Date().toISOString();
      const cachedDuration = durationCache.get(id) ?? 1800;

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
      const currentPlayingId = state.playlist[state.currentIndex]?.id;
      const customVideos = state.playlist.filter(
        (v) => v.sourceType === 'custom' && !unplayableVideoIds.has(v.id)
      );
      const rssIds = new Set(parsedItems.map((i) => i.id));
      const uniqueCustom = customVideos.filter((c) => !rssIds.has(c.id));

      state.playlist = [...uniqueCustom, ...parsedItems];

      if (currentPlayingId) {
        const preservedIdx = state.playlist.findIndex((v) => v.id === currentPlayingId);
        state.currentIndex = preservedIdx >= 0 ? preservedIdx : 0;
      } else {
        state.currentIndex = 0;
      }

      broadcastFullState();
    }
  } catch (err) {
    console.error('[YouTube RSS Sync Error]:', err);
  }
}

async function fetchYoutubeOEmbedTitle(videoId: string): Promise<string> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;
    const res = await fetch(oembedUrl);
    if (!res.ok) return `Vidéo YouTube (${videoId})`;
    const data = (await res.json()) as { title?: string };
    return data.title ? data.title.trim() : `Vidéo YouTube (${videoId})`;
  } catch {
    return `Vidéo YouTube (${videoId})`;
  }
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
                  : 'Forçage manuel sur Grille YouTube';

            if (prevSource !== state.activeSource && state.activeSource === 'youtube') {
              state.currentVideoStartedAt = Date.now();
            }
            appendTransition(modeLabel, state.activeSource);
            broadcastFullState();
          }
          break;
        }

        case 'playlist:next': {
          advancePlaylist('Passage manuel au programme suivant', 1);
          broadcastFullState();
          break;
        }

        case 'playlist:prev': {
          advancePlaylist('Retour au programme précédent', -1);
          broadcastFullState();
          break;
        }

        case 'playlist:select': {
          const videoId = String(msg.payload?.videoId || '');
          const idx = state.playlist.findIndex((v) => v.id === videoId);
          if (idx >= 0) {
            state.currentIndex = idx;
            state.currentVideoStartedAt = Date.now();
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

        case 'playlist:shuffle': {
          state.shuffleYoutube = Boolean(msg.payload?.shuffle);
          broadcastFullState();
          break;
        }

        case 'playlist:add': {
          const rawUrl = String(msg.payload?.url || '');
          const playImmediately = Boolean(msg.payload?.playNow);
          const videoId = extractYoutubeVideoId(rawUrl);
          if (!videoId) break;

          unplayableVideoIds.delete(videoId);
          const existingIdx = state.playlist.findIndex((v) => v.id === videoId);
          if (existingIdx === -1) {
            const title = await fetchYoutubeOEmbedTitle(videoId);
            const newItem: YouTubeVideoItem = {
              id: videoId,
              title,
              publishedAt: new Date().toISOString(),
              thumbnailUrl: `https://i2.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              views: 0,
              durationSeconds: durationCache.get(videoId) ?? 1800,
              sourceType: 'custom',
            };
            state.playlist = [newItem, ...state.playlist];
            if (playImmediately) {
              state.currentIndex = 0;
              state.currentVideoStartedAt = Date.now();
              if (state.activeSource === 'twitch') {
                state.mode = 'force_youtube';
                state.activeSource = 'youtube';
              }
              appendTransition(`Diffusion immédiate ajoutée : ${title}`, 'youtube');
            } else {
              state.currentIndex += 1;
              appendTransition(`Vidéo ajoutée à la grille : ${title}`, state.activeSource);
            }
          } else if (playImmediately) {
            state.currentIndex = existingIdx;
            state.currentVideoStartedAt = Date.now();
            if (state.activeSource === 'twitch') {
              state.mode = 'force_youtube';
              state.activeSource = 'youtube';
            }
          }
          broadcastFullState();
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
              state.currentVideoStartedAt = Date.now();
            }
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
          // Idempotent check: ignore duplicate ended signals if server already switched
          if (
            state.activeSource === 'youtube' &&
            current &&
            current.id === videoId &&
            Date.now() - state.currentVideoStartedAt > 5000
          ) {
            advancePlaylist('Fin du programme — Enchaînement grille YouTube', 1);
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
            state.currentVideoStartedAt = Date.now();
            appendTransition(
              `Vidéo non intégrable ignorée — Passage automatique au programme suivant`,
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

// REST API routes for initial state, forced probing, and external Discord Voice Bot synchronization
app.get('/api/tv/state', (_req, res) => {
  res.json(getPublicState());
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
    youtubeUrl: currentVideo ? `https://www.youtube.com/watch?v=${currentVideo.id}` : null,
    youtubeTitle: currentVideo?.title || null,
    seekSeconds: state.activeSource === 'youtube' ? elapsedSeconds : 0,
    serverTime: Date.now(),
  });
});

// Background 24/7 broadcast automation loops
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
    if (elapsedSec >= current.durationSeconds + 3) {
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
