import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
  Send,
  Users,
  Tv,
  Radio,
  ListPlus,
  ChevronDown,
  ChevronUp,
  X,
  BookOpen,
} from 'lucide-react';
import type {
  BotConfigOptions,
  BroadcastMode,
  BroadcastState,
  ChatMessage,
  ProgramTheme,
} from './types/broadcast';
import { TvPlayer } from './components/TvPlayer';
import { DiscordTvFullScreen } from './components/DiscordTvFullScreen';
import { BotBuilderView } from './components/BotBuilderView';
import { DeploymentGuideView } from './components/DeploymentGuideView';
import { ProgramThumbnail } from './components/ProgramThumbnail';
import { TopicExplorerView } from './components/TopicExplorerView';
import { generateDiscordBotFiles } from './utils/botGenerator';
import { isRunningInDiscordProxy, useDiscordActivity } from './hooks/useDiscordActivity';
import {
  PROGRAM_THEMES,
  formatTimecode,
  getThemeDefinition,
} from './utils/programMetadata';
import {
  DOCUMENTARY_TOPICS,
  buildTopicSegments,
  getTopicSegmentCounts,
  type DocumentaryTopicId,
} from './utils/topicExplorer';

type NavTab = 'regie' | 'sujets' | 'grille' | 'bot' | 'deploy';

interface CatalogYoutubeSearchItem {
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  channelName: string;
  durationSeconds: number;
  views: number;
}

function formatViews(views: number): string {
  if (!views) return 'Catalogue H24';
  if (views >= 1_000_000) {
    return `${(views / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M vues`;
  }
  return `${views.toLocaleString('fr-FR')} vues`;
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function App() {
  const discordActivity = useDiscordActivity();

  const [activeTab, setActiveTab] = useState<NavTab>('regie');
  const [tvOnlyMode, setTvOnlyMode] = useState<boolean>(() => {
    if (isRunningInDiscordProxy()) return true;
    const params = new URLSearchParams(window.location.search);
    return params.get('tv') === '1' || params.has('frame_id');
  });
  const [broadcast, setBroadcast] = useState<BroadcastState | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [clockOffsetMs, setClockOffsetMs] = useState<number>(0);
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [isPingingKeepAlive, setIsPingingKeepAlive] = useState<boolean>(false);
  const [leftBannersEnabled, setLeftBannersEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('jlmtv_left_banners_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  // Non-interrupting local browsing & search states for Programmes
  const [sidebarThemeFilter, setSidebarThemeFilter] = useState<ProgramTheme | 'all'>('all');
  const [sidebarSearch, setSidebarSearch] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'rss' | 'custom'>('all');
  const [catalogThemeFilter, setCatalogThemeFilter] = useState<ProgramTheme | 'all'>('all');
  const [selectedTopicId, setSelectedTopicId] = useState<DocumentaryTopicId | 'all'>('all');
  const [isRefreshingChapters, setIsRefreshingChapters] = useState<boolean>(false);
  const [expandedCatalogVideoId, setExpandedCatalogVideoId] = useState<string | null>(null);
  const [queuedFeedbackId, setQueuedFeedbackId] = useState<string | null>(null);

  // YouTube search & custom URL inputs
  const [ytCatalogResults, setYtCatalogResults] = useState<CatalogYoutubeSearchItem[]>([]);
  const [isSearchingYtCatalog, setIsSearchingYtCatalog] = useState<boolean>(false);
  const [customYoutubeUrl, setCustomYoutubeUrl] = useState<string>('');
  const [addStatusMsg, setAddStatusMsg] = useState<string | null>(null);
  const [addStatusTone, setAddStatusTone] = useState<'ok' | 'warn' | 'err'>('ok');
  const [isAddingMedia, setIsAddingMedia] = useState<boolean>(false);

  // Live Salon Chat
  const [authorName, setAuthorName] = useState<string>(() => {
    return `Spectateur-${Math.floor(100 + Math.random() * 899)}`;
  });
  const [chatInput, setChatInput] = useState<string>('');

  // Discord Bot Configurator State
  const [botConfig, setBotConfig] = useState<BotConfigOptions>(() => ({
    guildId: discordActivity.guildId || '',
    voiceChannelId: discordActivity.channelId || '',
    textChannelId: '',
    twitchChannel: 'jlmelenchon',
    youtubeChannelId: 'UCk-_PEY3iC6DIGJKuoEe9bw',
    resolutionPreset: '720p30',
    videoCodec: 'H264',
    bitrateKbps: 3000,
    probeIntervalSec: 30,
    shuffleFallback: false,
    syncWithWebRegie: true,
    webRegieUrl: window.location.origin,
  }));

  useEffect(() => {
    if (discordActivity.guildId || discordActivity.channelId) {
      setBotConfig((prev) => ({
        ...prev,
        guildId: discordActivity.guildId || prev.guildId,
        voiceChannelId: discordActivity.channelId || prev.voiceChannelId,
      }));
    }
  }, [discordActivity.guildId, discordActivity.channelId]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const sendWsAction = useCallback((type: string, payload?: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  useEffect(() => {
    let unmounted = false;

    const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';

    fetch(`${apiBase}/api/tv/state`)
      .then((r) => (r.ok ? r.json() : null))
      .then((initial: BroadcastState | null) => {
        if (!unmounted && initial) {
          setBroadcast(initial);
          setClockOffsetMs(initial.serverTime - Date.now());
        }
      })
      .catch(() => {
        // Handled by WebSocket reconnect
      });

    function connectWs() {
      if (unmounted) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${window.location.host}${apiBase}/ws`);
      wsRef.current = socket;

      socket.onopen = () => {
        if (!unmounted) setWsConnected(true);
      };

      socket.onmessage = (event) => {
        if (unmounted) return;
        try {
          const msg = JSON.parse(String(event.data)) as {
            type: string;
            payload?: unknown;
          };

          if (msg.type === 'state:sync' && msg.payload) {
            const nextState = msg.payload as BroadcastState;
            setBroadcast(nextState);
            setClockOffsetMs(nextState.serverTime - Date.now());
          } else if (msg.type === 'viewers:count' && msg.payload) {
            const { connectedViewers, serverTime } = msg.payload as {
              connectedViewers: number;
              serverTime: number;
            };
            setClockOffsetMs(serverTime - Date.now());
            setBroadcast((prev) => (prev ? { ...prev, connectedViewers } : prev));
          } else if (msg.type === 'chat:created' && msg.payload) {
            const chatEntry = msg.payload as ChatMessage;
            setBroadcast((prev) => {
              if (!prev) return prev;
              if (prev.chatMessages.some((m) => m.id === chatEntry.id)) return prev;
              return {
                ...prev,
                chatMessages: [...prev.chatMessages, chatEntry].slice(-50),
              };
            });
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      socket.onclose = () => {
        if (unmounted) return;
        setWsConnected(false);
        reconnectTimerRef.current = window.setTimeout(connectWs, 2500);
      };
    }

    connectWs();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const handleSetMode = useCallback(
    (mode: BroadcastMode) => {
      sendWsAction('mode:set', { mode });
    },
    [sendWsAction]
  );

  const handleSetThemeFilter = useCallback(
    (theme: ProgramTheme | 'all') => {
      sendWsAction('theme:set', { theme });
    },
    [sendWsAction]
  );

  const handleSelectVideo = useCallback(
    (videoId: string, startSeconds?: number) => {
      sendWsAction('playlist:select', {
        videoId,
        ...(typeof startSeconds === 'number' ? { startSeconds } : {}),
      });
    },
    [sendWsAction]
  );

  const handleQueueNext = useCallback(
    (videoId: string) => {
      sendWsAction('playlist:play_next', { videoId });
      setQueuedFeedbackId(videoId);
      window.setTimeout(() => {
        setQueuedFeedbackId((prev) => (prev === videoId ? null : prev));
      }, 2400);
    },
    [sendWsAction]
  );

  const handleToggleLeftBanners = useCallback((nextValue?: boolean) => {
    setLeftBannersEnabled((prev) => {
      const resolved = typeof nextValue === 'boolean' ? nextValue : !prev;
      try {
        window.localStorage.setItem('jlmtv_left_banners_enabled', String(resolved));
      } catch {
        // Ignore storage errors in restricted iframe contexts
      }
      return resolved;
    });
  }, []);

  const handleManualProbe = async () => {
    setIsProbing(true);
    const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';
    try {
      const res = await fetch(`${apiBase}/api/tv/probe`, { method: 'POST' });
      if (res.ok) {
        const updated = (await res.json()) as BroadcastState;
        setBroadcast(updated);
        setClockOffsetMs(updated.serverTime - Date.now());
      }
    } finally {
      setIsProbing(false);
    }
  };

  const handleManualKeepAlivePing = async () => {
    setIsPingingKeepAlive(true);
    const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';
    try {
      const res = await fetch(`${apiBase}/api/tv/keepalive/ping`, { method: 'POST' });
      if (res.ok) {
        const updated = (await res.json()) as BroadcastState;
        setBroadcast(updated);
        setClockOffsetMs(updated.serverTime - Date.now());
      }
    } finally {
      setIsPingingKeepAlive(false);
    }
  };

  const handleRefreshChapters = async () => {
    setIsRefreshingChapters(true);
    const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';
    try {
      const res = await fetch(`${apiBase}/api/tv/chapters/refresh`, { method: 'POST' });
      if (res.ok) {
        const updated = (await res.json()) as BroadcastState;
        setBroadcast(updated);
        setClockOffsetMs(updated.serverTime - Date.now());
      }
    } finally {
      setIsRefreshingChapters(false);
    }
  };

  const handleReportDuration = useCallback(
    (videoId: string, durationSeconds: number) => {
      sendWsAction('video:duration', { videoId, durationSeconds });
    },
    [sendWsAction]
  );

  const handleVideoEnded = useCallback(
    (videoId: string) => {
      sendWsAction('video:ended', { videoId });
    },
    [sendWsAction]
  );

  const handleVideoError = useCallback(
    (videoId: string) => {
      sendWsAction('video:error', { videoId });
    },
    [sendWsAction]
  );

  const submitMediaUrl = useCallback(
    async (rawUrl: string, playNow: boolean): Promise<{ ok: boolean; message: string }> => {
      const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';
      try {
        const res = await fetch(`${apiBase}/api/tv/playlist/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawUrl, playNow }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          discordSupported?: boolean;
          message: string;
          state?: BroadcastState;
        };
        if (data.state) {
          setBroadcast(data.state);
          setClockOffsetMs(data.state.serverTime - Date.now());
        }
        setAddStatusTone(!data.ok ? 'err' : data.discordSupported === false ? 'warn' : 'ok');
        setAddStatusMsg(data.message);
        window.setTimeout(() => setAddStatusMsg(null), 6500);
        return { ok: data.ok, message: data.message };
      } catch {
        const fallbackMsg = 'Erreur réseau lors de l’envoi du lien à la régie.';
        setAddStatusTone('err');
        setAddStatusMsg(fallbackMsg);
        window.setTimeout(() => setAddStatusMsg(null), 5000);
        return { ok: false, message: fallbackMsg };
      }
    },
    []
  );

  const handleAddYoutubeVideo = async (playNow: boolean) => {
    const trimmed = customYoutubeUrl.trim();
    if (!trimmed || isAddingMedia) return;
    setIsAddingMedia(true);
    try {
      const res = await submitMediaUrl(trimmed, playNow);
      if (res.ok) {
        setCustomYoutubeUrl('');
      }
    } finally {
      setIsAddingMedia(false);
    }
  };

  const handleSearchYoutubeCatalog = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || isSearchingYtCatalog) return;
    setIsSearchingYtCatalog(true);
    const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';
    try {
      const res = await fetch(
        `${apiBase}/api/tv/youtube-search?q=${encodeURIComponent(trimmed)}`
      );
      if (res.ok) {
        const data = (await res.json()) as { results?: CatalogYoutubeSearchItem[] };
        setYtCatalogResults(data.results || []);
      }
    } finally {
      setIsSearchingYtCatalog(false);
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sendWsAction('chat:send', { id, author: authorName, text });
    setChatInput('');
  };

  const handleDownloadBotInstaller = () => {
    const generated = generateDiscordBotFiles(botConfig);
    const blob = new Blob([generated.installScript], {
      type: 'text/x-shellscript;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'install-jlm-tv-bot.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const currentVideo = useMemo(() => {
    if (!broadcast || broadcast.playlist.length === 0) return null;
    return broadcast.playlist[broadcast.currentIndex] || broadcast.playlist[0];
  }, [broadcast]);

  const nextQueuedVideoId = useMemo(() => {
    if (!broadcast || broadcast.playlist.length <= 1) return null;
    const nextIdx = (broadcast.currentIndex + 1) % broadcast.playlist.length;
    return broadcast.playlist[nextIdx]?.id || null;
  }, [broadcast]);

  const handlePlaySegment = useCallback(
    (videoId: string, startSeconds: number) => {
      if (currentVideo?.id === videoId && broadcast?.activeSource === 'youtube') {
        sendWsAction('video:seek', { seconds: startSeconds });
      } else {
        handleSelectVideo(videoId, startSeconds);
      }
    },
    [currentVideo?.id, broadcast?.activeSource, sendWsAction, handleSelectVideo]
  );

  const topicSegments = useMemo(
    () => (broadcast ? buildTopicSegments(broadcast.playlist) : []),
    [broadcast]
  );

  const topicCounts = useMemo(
    () => getTopicSegmentCounts(topicSegments),
    [topicSegments]
  );

  // Non-interrupting local sidebar browse list
  const sidebarPreviewList = useMemo(() => {
    if (!broadcast) return [];
    const q = sidebarSearch.trim().toLowerCase();
    return broadcast.playlist.filter((v) => {
      if (sidebarThemeFilter !== 'all' && v.theme !== sidebarThemeFilter) return false;
      if (q && !v.title.toLowerCase().includes(q) && !v.id.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [broadcast, sidebarThemeFilter, sidebarSearch]);

  const filteredPlaylist = useMemo(() => {
    if (!broadcast) return [];
    const q = searchQuery.trim().toLowerCase();
    return broadcast.playlist.filter((item) => {
      if (sourceFilter !== 'all' && item.sourceType !== sourceFilter) return false;
      if (catalogThemeFilter !== 'all' && item.theme !== catalogThemeFilter) return false;
      if (q && !item.title.toLowerCase().includes(q) && !item.id.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [broadcast, searchQuery, sourceFilter, catalogThemeFilter]);

  if (tvOnlyMode) {
    if (!broadcast) {
      return (
        <div className="fixed inset-0 w-screen h-screen bg-black flex items-center justify-center text-xs text-neutral-400">
          Connexion au signal JLM Télévision H24...
        </div>
      );
    }
    return (
      <DiscordTvFullScreen
        broadcast={broadcast}
        clockOffsetMs={clockOffsetMs}
        canExitFullScreen={!isRunningInDiscordProxy()}
        onExitFullScreen={() => setTvOnlyMode(false)}
        onSetMode={handleSetMode}
        onSetThemeFilter={handleSetThemeFilter}
        onTriggerFlashBanner={() => sendWsAction('banner:flash')}
        leftBannersEnabled={leftBannersEnabled}
        onToggleLeftBanners={handleToggleLeftBanners}
        onPrev={() => sendWsAction('playlist:prev', { requireHls: false })}
        onNext={() => sendWsAction('playlist:next', { requireHls: false })}
        onSeekSeconds={(seconds) => sendWsAction('video:seek', { seconds })}
        onSelectVideo={handleSelectVideo}
        onQueueNext={handleQueueNext}
        onAddMedia={(url, playNow) => submitMediaUrl(url, playNow)}
        onRemoveVideo={(videoId) => sendWsAction('playlist:remove', { videoId })}
        onReportDuration={handleReportDuration}
        onVideoEnded={handleVideoEnded}
        onVideoError={handleVideoError}
      />
    );
  }

  const navItems = [
    { id: 'regie', label: 'Régie & Direct' },
    { id: 'sujets', label: 'Sujets & Timecodes' },
    { id: 'grille', label: 'Programmes' },
    { id: 'bot', label: 'Bot Discord' },
    { id: 'deploy', label: 'Déploiement' },
  ] as const;

  return (
    <div className="min-h-screen flex flex-col bg-[#050505] text-neutral-100">
      {/* Strict 3-Zone Monochrome Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-neutral-800/90 bg-[#050505]/95 sticky top-0 z-30 backdrop-blur-sm">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => setActiveTab('regie')}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer font-[family-name:var(--font-display)]"
        >
          JLM Télévision H24
        </button>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-neutral-400">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                activeTab === item.id
                  ? 'text-white border-white'
                  : 'border-transparent hover:text-white hover:border-neutral-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleDownloadBotInstaller}
            className="px-4 py-2 text-xs font-semibold text-black bg-white rounded-xl hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Télécharger le Bot H24
          </button>
        </div>
      </header>

      {/* Mobile Navigation Bar */}
      <div className="md:hidden flex items-center gap-5 px-4 py-2.5 border-b border-neutral-800 overflow-x-auto bg-black">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={`text-xs font-medium py-1 whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === item.id
                ? 'text-white border-white'
                : 'text-neutral-400 border-transparent'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Main Content Container */}
      <main
        className={`flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 ${
          activeTab !== 'regie' ? 'pb-56' : ''
        }`}
      >
        {!broadcast ? (
          <div className="space-y-6 animate-pulse">
            <div className="h-14 bg-neutral-950 rounded-2xl border border-neutral-800" />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8 aspect-video bg-neutral-950 rounded-2xl border border-neutral-800" />
              <div className="lg:col-span-4 h-[480px] bg-neutral-950 rounded-2xl border border-neutral-800" />
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Regie Top Workspace Controls */}
            {activeTab === 'regie' && (
              <>
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5 pb-6 border-b border-neutral-800">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                      <span className={wsConnected ? 'text-white font-medium' : 'text-neutral-400'}>
                        {wsConnected ? 'Régie synchronisée en direct' : 'Reconnexion régie...'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums text-neutral-200">
                        <Users className="w-3.5 h-3.5 shrink-0" />
                        {broadcast.connectedViewers}{' '}
                        {broadcast.connectedViewers > 1 ? 'spectateurs' : 'spectateur'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Twitch jlmelenchon :{' '}
                        <strong className="text-white font-medium">
                          {broadcast.twitch.isLive ? 'EN DIRECT' : 'Hors ligne'}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('deploy')}
                        className="text-neutral-300 hover:text-white underline-offset-4 hover:underline transition-colors cursor-pointer"
                      >
                        Anti-veille Render actif ({broadcast.keepAlive.pingCount} pings)
                      </button>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-semibold text-white">
                      Moniteur d’antenne H24 — Régie Télévision
                    </h1>
                  </div>

                  {/* Interactive Mode Segmented Selector + Probe Action */}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1 p-1 bg-neutral-950 border border-neutral-800 rounded-xl">
                      {(
                        [
                          { id: 'auto', label: 'Auto (Priorité Twitch)' },
                          { id: 'force_twitch', label: 'Twitch Direct' },
                          { id: 'force_youtube', label: 'Grille Vidéos' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleSetMode(m.id)}
                          className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            broadcast.mode === m.id
                              ? 'bg-white text-black font-semibold'
                              : 'text-neutral-400 hover:text-white'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleManualProbe}
                      disabled={isProbing}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-neutral-200 bg-neutral-950 hover:bg-neutral-900 border border-neutral-800 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 shrink-0 ${isProbing ? 'animate-spin' : ''}`}
                      />
                      <span>Actualiser les flux</span>
                    </button>
                  </div>
                </div>

                {/* Thematic H24 Channel Rotation Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    <span className="text-xs text-neutral-400 mr-2 whitespace-nowrap">
                      Rotation d’antenne :
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSetThemeFilter('all')}
                      className={`px-3.5 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        broadcast.activeThemeFilter === 'all'
                          ? 'bg-white text-black border-white font-semibold'
                          : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:bg-neutral-900 hover:text-white'
                      }`}
                    >
                      Toute la grille ({broadcast.playlist.length})
                    </button>
                    {PROGRAM_THEMES.map((th) => {
                      const count = broadcast.playlist.filter((v) => v.theme === th.id).length;
                      return (
                        <button
                          key={th.id}
                          type="button"
                          onClick={() => handleSetThemeFilter(th.id)}
                          className={`px-3.5 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            broadcast.activeThemeFilter === th.id
                              ? 'bg-white text-black border-white font-semibold'
                              : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:bg-neutral-900 hover:text-white'
                          }`}
                        >
                          {th.label} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Persistent Live Broadcast Node: Full Studio Split in 'regie', Docked YouTube Mini-Player in other tabs! */}
            <div
              className={
                activeTab === 'regie'
                  ? 'grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start'
                  : 'contents'
              }
            >
              <div
                className={
                  activeTab === 'regie'
                    ? 'lg:col-span-8 space-y-6'
                    : 'fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 w-[290px] sm:w-[356px] shadow-2xl'
                }
              >
                <TvPlayer
                  activeSource={broadcast.activeSource}
                  twitch={broadcast.twitch}
                  playlist={broadcast.playlist}
                  currentIndex={broadcast.currentIndex}
                  activeThemeFilter={broadcast.activeThemeFilter}
                  flashBannerTriggeredAt={broadcast.flashBannerTriggeredAt}
                  leftBannerTriggeredAt={broadcast.leftBannerTriggeredAt}
                  leftBannerManualIndex={broadcast.leftBannerManualIndex}
                  leftBannersEnabled={leftBannersEnabled}
                  onToggleLeftBanners={handleToggleLeftBanners}
                  currentVideo={currentVideo}
                  currentVideoStartedAt={broadcast.currentVideoStartedAt}
                  clockOffsetMs={clockOffsetMs}
                  miniMode={activeTab !== 'regie'}
                  onReturnToRegie={() => setActiveTab('regie')}
                  onPrevVideo={() => sendWsAction('playlist:prev')}
                  onNextVideo={() => sendWsAction('playlist:next')}
                  onSeekSeconds={(seconds) => sendWsAction('video:seek', { seconds })}
                  onTriggerFlashBanner={() => sendWsAction('banner:flash')}
                  onTriggerLeftBanner={() => sendWsAction('banner:left')}
                  onSwitchToYoutube={() => handleSetMode('force_youtube')}
                  onEnterFullScreenTv={() => setTvOnlyMode(true)}
                  onReportDuration={handleReportDuration}
                  onVideoEnded={handleVideoEnded}
                  onVideoError={handleVideoError}
                />

                {activeTab === 'regie' && (
                  <>
                    {/* Quick Documentary Subject Shortcuts (Opens Sujets & Timecodes without interrupting live TV) */}
                    <div className="border border-white/15 bg-neutral-950 rounded-2xl p-6 space-y-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <h3 className="text-sm font-semibold text-white inline-flex items-center gap-2">
                            <BookOpen className="w-4 h-4 shrink-0" />
                            <span>S’informer sur un sujet précis (accès direct au bon timecode)</span>
                          </h3>
                          <p className="text-xs text-neutral-400">
                            Cliquez sur un sujet pour voir toutes les conférences, entretiens et vlogs correspondants sans couper le direct.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTopicId('all');
                            setActiveTab('sujets');
                          }}
                          className="text-xs font-semibold text-white hover:underline cursor-pointer whitespace-nowrap"
                        >
                          Voir les {topicSegments.length} séquences chapitrées
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {DOCUMENTARY_TOPICS.map((topic) => (
                          <button
                            key={topic.id}
                            type="button"
                            onClick={() => {
                              setSelectedTopicId(topic.id);
                              setActiveTab('sujets');
                            }}
                            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-neutral-200 hover:text-black bg-black hover:bg-white border border-neutral-800 hover:border-white rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <span>{topic.shortLabel}</span>
                            <span className="font-mono tabular-nums text-[11px] opacity-70">
                              {topicCounts[topic.id] || 0}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="border border-white/15 bg-neutral-950 rounded-2xl p-6 space-y-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-white">
                          Lancer ou programmer une vidéo / playlist (YouTube ou Twitch)
                        </h3>
                        <span className="text-xs text-neutral-400">
                          Shorts automatiquement exclus · Compatible Web & Discord
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input
                          type="text"
                          value={customYoutubeUrl}
                          onChange={(e) => setCustomYoutubeUrl(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleAddYoutubeVideo(true);
                            }
                          }}
                          placeholder="Coller un lien vidéo ou playlist YouTube (watch?v=..., playlist?list=...) ou Twitch..."
                          className="flex-1 px-4 py-2.5 text-sm bg-black border border-neutral-800 rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:border-white"
                        />
                        <div className="flex items-center gap-2.5 shrink-0">
                          <button
                            type="button"
                            disabled={isAddingMedia}
                            onClick={() => void handleAddYoutubeVideo(true)}
                            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                            <span>{isAddingMedia ? 'Envoi...' : 'Diffuser maintenant'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isAddingMedia}
                            onClick={() => void handleAddYoutubeVideo(false)}
                            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            <Plus className="w-3.5 h-3.5 shrink-0" />
                            <span>Ajouter à la file</span>
                          </button>
                        </div>
                      </div>
                      {addStatusMsg && (
                        <p
                          className={`text-xs leading-relaxed ${
                            addStatusTone === 'err' ? 'text-neutral-300' : 'text-white font-medium'
                          }`}
                        >
                          {addStatusMsg}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Right 4 Cols in Regie: YouTube Watch-Next Thumbnail Sidebar + Live Salon Chat */}
              {activeTab === 'regie' && (
                <div className="lg:col-span-4 space-y-6">
                  {/* YouTube-Style Up Next Programme Browser (with Thumbnails & Non-Interrupting Navigation) */}
                  <div className="border border-white/15 bg-neutral-950 rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-neutral-800 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-white">Programmes</h3>
                          <p className="text-xs text-neutral-400">
                            Naviguez librement sans couper le direct
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            sendWsAction('playlist:shuffle', { shuffle: !broadcast.shuffleYoutube })
                          }
                          title="Activer ou désactiver la rotation aléatoire"
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            broadcast.shuffleYoutube
                              ? 'bg-white text-black border-white font-semibold'
                              : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:text-white'
                          }`}
                        >
                          <Shuffle className="w-3.5 h-3.5 shrink-0" />
                          <span>{broadcast.shuffleYoutube ? 'Aléatoire' : 'Séquentiel'}</span>
                        </button>
                      </div>

                      {/* Local Non-Interrupting Search & Category Chips */}
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={sidebarSearch}
                          onChange={(e) => setSidebarSearch(e.target.value)}
                          placeholder="Filtrer les vidéos..."
                          className="w-full pl-8 pr-7 py-1.5 text-xs bg-black border border-neutral-800 rounded-lg text-white placeholder:text-neutral-500 focus:outline-none focus:border-white"
                        />
                        {sidebarSearch && (
                          <button
                            type="button"
                            onClick={() => setSidebarSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                        <button
                          type="button"
                          onClick={() => setSidebarThemeFilter('all')}
                          className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            sidebarThemeFilter === 'all'
                              ? 'bg-white text-black font-semibold'
                              : 'bg-neutral-900 text-neutral-400 hover:text-white'
                          }`}
                        >
                          Tout
                        </button>
                        {PROGRAM_THEMES.map((th) => (
                          <button
                            key={th.id}
                            type="button"
                            onClick={() => setSidebarThemeFilter(th.id)}
                            className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              sidebarThemeFilter === th.id
                                ? 'bg-white text-black font-semibold'
                                : 'bg-neutral-900 text-neutral-400 hover:text-white'
                            }`}
                          >
                            {th.shortLabel}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* YouTube Watch-Next Horizontal Thumbnail Cards */}
                    <div className="divide-y divide-neutral-800/70 max-h-[430px] overflow-y-auto">
                      {sidebarPreviewList.length === 0 ? (
                        <div className="px-5 py-8 text-center text-xs text-neutral-400">
                          Aucun programme trouvé pour ce filtre.
                        </div>
                      ) : (
                        sidebarPreviewList.map((video) => {
                          const isCurrent =
                            currentVideo?.id === video.id && broadcast.activeSource === 'youtube';
                          const isQueuedNext = !isCurrent && nextQueuedVideoId === video.id;
                          const justQueued = queuedFeedbackId === video.id;
                          const themeInfo = getThemeDefinition(video.theme);

                          return (
                            <div
                              key={video.id}
                              className={`group p-3.5 flex items-start gap-3 transition-colors ${
                                isCurrent ? 'bg-neutral-900/90' : 'hover:bg-neutral-900/45'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => handleSelectVideo(video.id)}
                                className="w-32 sm:w-36 shrink-0 rounded-lg overflow-hidden border border-neutral-800 cursor-pointer"
                                title="Regarder ce programme"
                              >
                                <ProgramThumbnail
                                  videoId={
                                    !video.twitchVodId && !video.twitchChannelLogin
                                      ? video.id
                                      : undefined
                                  }
                                  thumbnailUrl={video.thumbnailUrl}
                                  title={video.title}
                                  durationSeconds={video.durationSeconds}
                                  isCurrent={isCurrent}
                                  isQueuedNext={isQueuedNext}
                                />
                              </button>

                              <div className="min-w-0 flex-1 space-y-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleSelectVideo(video.id)}
                                  className="text-left w-full cursor-pointer"
                                >
                                  <p
                                    className={`text-xs font-medium line-clamp-2 leading-snug group-hover:underline ${
                                      isCurrent ? 'text-white font-semibold' : 'text-neutral-100'
                                    }`}
                                  >
                                    {video.title}
                                  </p>
                                </button>

                                <div className="flex flex-wrap items-center gap-1 text-[11px] text-neutral-400 font-mono tabular-nums">
                                  <span className="font-sans text-neutral-300">
                                    {themeInfo.shortLabel}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-sans">{formatViews(video.views)}</span>
                                </div>

                                {!isCurrent && (
                                  <div className="pt-0.5 flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleQueueNext(video.id)}
                                      title="Programmer juste après la vidéo en cours sans la couper"
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer whitespace-nowrap ${
                                        justQueued || isQueuedNext
                                          ? 'bg-white text-black font-semibold'
                                          : 'text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800'
                                      }`}
                                    >
                                      <ListPlus className="w-3 h-3 shrink-0" />
                                      <span>{justQueued ? 'Programmé !' : 'Lire ensuite'}</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="px-5 py-3 border-t border-neutral-800 bg-black flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-400">
                        {broadcast.playlist.length} programmes disponibles
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('grille')}
                        className="text-xs font-semibold text-white hover:text-neutral-300 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Explorer en grand format (Direct maintenu)
                      </button>
                    </div>
                  </div>

                  {/* Real-Time WebSocket Salon Chat */}
                  <div className="border border-white/15 bg-neutral-950 rounded-2xl flex flex-col h-[340px]">
                    <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white">Discussion du salon</h3>
                      <input
                        type="text"
                        value={authorName}
                        onChange={(e) => setAuthorName(e.target.value)}
                        aria-label="Votre pseudonyme"
                        className="w-32 px-2.5 py-1 text-xs bg-black border border-neutral-800 rounded-lg text-neutral-200 focus:outline-none focus:border-white"
                      />
                    </div>

                    <div className="flex-1 p-5 overflow-y-auto space-y-3.5 text-xs">
                      {broadcast.chatMessages.map((m) => (
                        <div key={m.id} className="space-y-0.5">
                          <div className="flex items-baseline gap-2">
                            <span className="font-semibold text-white">{m.author}</span>
                            <span className="text-[11px] font-mono tabular-nums text-neutral-500">
                              {new Date(m.createdAt).toLocaleTimeString('fr-FR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-neutral-300 leading-relaxed break-words">{m.text}</p>
                        </div>
                      ))}
                    </div>

                    <form
                      onSubmit={handleSendChat}
                      className="p-3.5 border-t border-neutral-800 flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Envoyer un message au salon..."
                        className="flex-1 px-3.5 py-2 text-xs bg-black border border-neutral-800 rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:border-white"
                      />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5 shrink-0" />
                        <span>Envoyer</span>
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>

            {/* Regie Broadcast Transition History */}
            {activeTab === 'regie' && (
              <section className="border border-white/15 bg-neutral-950 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">
                    Journal des bascules d’antenne H24
                  </h3>
                  <span className="text-xs text-neutral-500 font-mono tabular-nums">
                    Dernière vérification Twitch :{' '}
                    {new Date(broadcast.twitch.lastCheckedAt).toLocaleTimeString('fr-FR')}
                  </span>
                </div>
                <div className="divide-y divide-neutral-800/80">
                  {broadcast.transitions.slice(0, 5).map((tr) => (
                    <div
                      key={tr.id}
                      className="px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-3 text-neutral-200">
                        {tr.source === 'twitch' ? (
                          <Radio className="w-3.5 h-3.5 text-white shrink-0" />
                        ) : (
                          <Tv className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        )}
                        <span>{tr.message}</span>
                      </div>
                      <span className="font-mono tabular-nums text-neutral-500 shrink-0">
                        {new Date(tr.timestamp).toLocaleTimeString('fr-FR')}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Documentary Subject & Timecode Explorer ("Sujets & Timecodes") — Live Broadcast Continues in Mini-Player! */}
            {activeTab === 'sujets' && (
              <TopicExplorerView
                playlist={broadcast.playlist}
                currentVideoId={currentVideo?.id || null}
                isPlayingYoutube={broadcast.activeSource === 'youtube'}
                nextQueuedVideoId={nextQueuedVideoId}
                queuedFeedbackId={queuedFeedbackId}
                selectedTopic={selectedTopicId}
                onSelectTopic={setSelectedTopicId}
                isRefreshingChapters={isRefreshingChapters}
                onRefreshChapters={() => void handleRefreshChapters()}
                onPlaySegment={handlePlaySegment}
                onQueueNext={handleQueueNext}
              />
            )}

            {/* Full YouTube-Style Video Feed ("Programmes & Grille") — Live Broadcast Continues in Mini-Player! */}
            {activeTab === 'grille' && (
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-neutral-800">
                  <div className="space-y-1.5">
                    <h1 className="text-2xl sm:text-3xl font-semibold text-white">
                      Programmes & Catalogue Vidéo H24
                    </h1>
                    <p className="text-sm text-neutral-400">
                      Parcourez les miniatures, explorez les chapitres ou cherchez sur YouTube pendant
                      que le direct continue dans le mini-lecteur en bas à droite.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 p-1 bg-neutral-950 border border-neutral-800 rounded-xl">
                      {(
                        [
                          { id: 'all', label: 'Toutes sources' },
                          { id: 'rss', label: 'Flux officiel JLM' },
                          { id: 'custom', label: 'Ajouts manuels' },
                        ] as const
                      ).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setSourceFilter(f.id)}
                          className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            sourceFilter === f.id
                              ? 'bg-white text-black font-semibold'
                              : 'text-neutral-400 hover:text-white'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Category Filter Buttons (Local Browsing — Does NOT Interrupt Live Stream!) */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCatalogThemeFilter('all')}
                    className={`px-4 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap cursor-pointer ${
                      catalogThemeFilter === 'all'
                        ? 'bg-white text-black border-white font-semibold'
                        : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:bg-neutral-900 hover:text-white'
                    }`}
                  >
                    Tous les programmes ({broadcast.playlist.length})
                  </button>
                  {PROGRAM_THEMES.map((th) => {
                    const count = broadcast.playlist.filter((v) => v.theme === th.id).length;
                    return (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => setCatalogThemeFilter(th.id)}
                        className={`px-4 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap cursor-pointer ${
                          catalogThemeFilter === th.id
                            ? 'bg-white text-black border-white font-semibold'
                            : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:bg-neutral-900 hover:text-white'
                        }`}
                      >
                        {th.label} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Unified Search (Catalogue + YouTube) & Direct URL Add */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (searchQuery.trim()) {
                        void handleSearchYoutubeCatalog(searchQuery);
                      }
                    }}
                    className="lg:col-span-6 flex items-center gap-2"
                  >
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-neutral-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filtrer les programmes ou rechercher sur YouTube..."
                        className="w-full pl-11 pr-9 py-2.5 text-sm bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:border-white"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setYtCatalogResults([]);
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={isSearchingYtCatalog || !searchQuery.trim()}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-black bg-white hover:bg-neutral-200 disabled:opacity-40 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Search className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {isSearchingYtCatalog ? 'Recherche...' : 'Chercher sur YouTube'}
                      </span>
                    </button>
                  </form>

                  <div className="lg:col-span-6 flex flex-col gap-2">
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        type="text"
                        value={customYoutubeUrl}
                        onChange={(e) => setCustomYoutubeUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleAddYoutubeVideo(false);
                          }
                        }}
                        placeholder="Coller un lien YouTube ou Twitch..."
                        className="flex-1 px-4 py-2.5 text-sm bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:border-white"
                      />
                      <button
                        type="button"
                        disabled={isAddingMedia}
                        onClick={() => void handleAddYoutubeVideo(false)}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-black bg-white hover:bg-neutral-200 disabled:opacity-50 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Plus className="w-4 h-4 shrink-0" />
                        <span>Ajouter sans couper le direct</span>
                      </button>
                      <button
                        type="button"
                        disabled={isAddingMedia}
                        onClick={() => void handleAddYoutubeVideo(true)}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-50 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                        <span>Diffuser</span>
                      </button>
                    </div>
                    {addStatusMsg && <p className="text-xs text-white font-medium">{addStatusMsg}</p>}
                  </div>
                </div>

                {/* Live YouTube Search Results Grid (With 16:9 Thumbnails) */}
                {ytCatalogResults.length > 0 && (
                  <section className="space-y-4 pb-8 border-b border-neutral-800">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold text-white">
                        Résultats YouTube pour « {searchQuery.trim()} »
                      </h2>
                      <button
                        type="button"
                        onClick={() => setYtCatalogResults([])}
                        className="text-xs text-neutral-400 hover:text-white cursor-pointer"
                      >
                        Masquer les résultats YouTube
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                      {ytCatalogResults.map((ytItem) => (
                        <div
                          key={ytItem.videoId}
                          className="group rounded-2xl bg-neutral-950 border border-neutral-800 hover:border-white/30 overflow-hidden flex flex-col transition-colors"
                        >
                          <button
                            type="button"
                            disabled={isAddingMedia}
                            onClick={() =>
                              void submitMediaUrl(
                                `https://www.youtube.com/watch?v=${ytItem.videoId}`,
                                true
                              )
                            }
                            className="w-full text-left cursor-pointer"
                          >
                            <ProgramThumbnail
                              videoId={ytItem.videoId}
                              thumbnailUrl={ytItem.thumbnailUrl}
                              title={ytItem.title}
                              durationSeconds={ytItem.durationSeconds}
                            />
                          </button>

                          <div className="p-4 flex-1 flex flex-col justify-between gap-3.5">
                            <div className="space-y-1.5">
                              <button
                                type="button"
                                disabled={isAddingMedia}
                                onClick={() =>
                                  void submitMediaUrl(
                                    `https://www.youtube.com/watch?v=${ytItem.videoId}`,
                                    true
                                  )
                                }
                                className="text-left w-full cursor-pointer"
                              >
                                <h3 className="text-sm font-semibold text-white line-clamp-2 leading-snug group-hover:underline">
                                  {ytItem.title}
                                </h3>
                              </button>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400 font-mono tabular-nums">
                                <span className="font-sans text-neutral-300 truncate max-w-[140px]">
                                  {ytItem.channelName}
                                </span>
                                {ytItem.views > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-sans">{formatViews(ytItem.views)}</span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={isAddingMedia}
                                onClick={() =>
                                  void submitMediaUrl(
                                    `https://www.youtube.com/watch?v=${ytItem.videoId}`,
                                    false
                                  )
                                }
                                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              >
                                <Plus className="w-3.5 h-3.5 shrink-0" />
                                <span>Ajouter à la file</span>
                              </button>
                              <button
                                type="button"
                                disabled={isAddingMedia}
                                onClick={() =>
                                  void submitMediaUrl(
                                    `https://www.youtube.com/watch?v=${ytItem.videoId}`,
                                    true
                                  )
                                }
                                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              >
                                <Play className="w-3 h-3 fill-current shrink-0" />
                                <span>Diffuser</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Main YouTube-Style 4-Column Thumbnail Grid */}
                {filteredPlaylist.length === 0 ? (
                  <div className="border border-white/15 bg-neutral-950 rounded-2xl p-12 text-center space-y-4">
                    <p className="text-sm text-neutral-300">
                      Aucune vidéo de la grille actuelle ne correspond à ce filtre.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      {searchQuery.trim() && (
                        <button
                          type="button"
                          onClick={() => void handleSearchYoutubeCatalog(searchQuery)}
                          className="px-4 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors cursor-pointer"
                        >
                          Chercher « {searchQuery.trim()} » sur YouTube
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setSourceFilter('all');
                          setCatalogThemeFilter('all');
                        }}
                        className="px-4 py-2 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors cursor-pointer"
                      >
                        Réinitialiser les filtres
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredPlaylist.map((video) => {
                      const realIndex = broadcast.playlist.findIndex((v) => v.id === video.id);
                      const isPlaying =
                        realIndex === broadcast.currentIndex &&
                        broadcast.activeSource === 'youtube';
                      const isQueuedNext = !isPlaying && nextQueuedVideoId === video.id;
                      const justQueued = queuedFeedbackId === video.id;
                      const chaptersOpen = expandedCatalogVideoId === video.id;
                      const themeDef = getThemeDefinition(video.theme);

                      return (
                        <article
                          key={video.id}
                          className={`group rounded-2xl border overflow-hidden flex flex-col transition-colors ${
                            isPlaying
                              ? 'bg-neutral-900/90 border-white/45'
                              : 'bg-neutral-950 border-neutral-800/90 hover:border-white/30'
                          }`}
                        >
                          {/* 16:9 Thumbnail Card Top */}
                          <button
                            type="button"
                            onClick={() => handleSelectVideo(video.id)}
                            className="w-full text-left cursor-pointer"
                            title="Lancer ce programme à l’antenne"
                          >
                            <ProgramThumbnail
                              videoId={
                                !video.twitchVodId && !video.twitchChannelLogin
                                  ? video.id
                                  : undefined
                              }
                              thumbnailUrl={video.thumbnailUrl}
                              title={video.title}
                              durationSeconds={video.durationSeconds}
                              isCurrent={isPlaying}
                              isQueuedNext={isQueuedNext}
                            />
                          </button>

                          {/* Card Body & Non-Interrupting Controls */}
                          <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                            <div className="space-y-1.5">
                              <button
                                type="button"
                                onClick={() => handleSelectVideo(video.id)}
                                className="text-left w-full cursor-pointer"
                              >
                                <h3 className="text-sm font-semibold text-white line-clamp-2 leading-snug group-hover:underline">
                                  {video.title}
                                </h3>
                              </button>

                              {/* Clean Unboxed Metadata (Zero Static Pills) */}
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400 font-mono tabular-nums">
                                <span className="font-sans text-neutral-300">
                                  {themeDef.shortLabel}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-sans">{formatViews(video.views)}</span>
                                {video.publishedAt && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-sans">
                                      {formatDateShort(video.publishedAt)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="space-y-2.5">
                              <div className="flex items-center gap-2">
                                {!isPlaying ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleSelectVideo(video.id)}
                                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                                    >
                                      <Play className="w-3 h-3 fill-current shrink-0" />
                                      <span>Regarder</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleQueueNext(video.id)}
                                      title="Programmer juste après la vidéo en cours sans couper le direct"
                                      className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border transition-colors cursor-pointer whitespace-nowrap ${
                                        justQueued || isQueuedNext
                                          ? 'bg-neutral-200 text-black border-white font-semibold'
                                          : 'bg-neutral-900 text-neutral-200 border-neutral-800 hover:bg-neutral-800 hover:text-white'
                                      }`}
                                    >
                                      <ListPlus className="w-3.5 h-3.5 shrink-0" />
                                      <span>{justQueued ? 'À suivre !' : 'À suivre'}</span>
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setActiveTab('regie')}
                                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                                  >
                                    <span>En direct — Ouvrir la régie</span>
                                  </button>
                                )}

                                {video.chapters && video.chapters.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedCatalogVideoId((prev) =>
                                        prev === video.id ? null : video.id
                                      )
                                    }
                                    title={`Voir les ${video.chapters.length} chapitres sans couper le direct`}
                                    className="p-2 text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors cursor-pointer shrink-0"
                                  >
                                    {chaptersOpen ? (
                                      <ChevronUp className="w-4 h-4" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4" />
                                    )}
                                  </button>
                                )}

                                {broadcast.playlist.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      sendWsAction('playlist:remove', { videoId: video.id })
                                    }
                                    title="Retirer de la grille"
                                    className="p-2 text-neutral-500 hover:text-white transition-colors cursor-pointer shrink-0"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>

                              {/* Inline Expandable Chapters Preview */}
                              {chaptersOpen && video.chapters && video.chapters.length > 1 && (
                                <div className="pt-2.5 border-t border-neutral-800 space-y-1 max-h-44 overflow-y-auto">
                                  <p className="text-[11px] text-neutral-400 px-1 pb-0.5">
                                    Chapitres ({video.chapters.length}) — cliquer pour lancer à ce
                                    moment :
                                  </p>
                                  {video.chapters.map((ch, cIdx) => (
                                    <button
                                      key={`${ch.startSeconds}-${cIdx}`}
                                      type="button"
                                      onClick={() => {
                                        if (isPlaying) {
                                          sendWsAction('video:seek', { seconds: ch.startSeconds });
                                        } else {
                                          handleSelectVideo(video.id, ch.startSeconds);
                                        }
                                      }}
                                      className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-neutral-900 flex items-start gap-2 text-xs transition-colors cursor-pointer"
                                    >
                                      <span className="font-mono tabular-nums text-neutral-400 shrink-0">
                                        {formatTimecode(ch.startSeconds)}
                                      </span>
                                      <span className="text-neutral-200 line-clamp-1">
                                        {ch.title}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'bot' && (
              <BotBuilderView
                config={botConfig}
                onChangeConfig={setBotConfig}
                onDownloadInstaller={handleDownloadBotInstaller}
              />
            )}

            {activeTab === 'deploy' && (
              <DeploymentGuideView
                appOrigin={window.location.origin}
                keepAlive={broadcast.keepAlive}
                isPingingKeepAlive={isPingingKeepAlive}
                onPingKeepAlive={() => void handleManualKeepAlivePing()}
                onDownloadInstaller={handleDownloadBotInstaller}
                onSwitchTab={(t) => setActiveTab(t)}
              />
            )}
          </div>
        )}
      </main>

      {/* Clean Quiet Footer */}
      <footer className="border-t border-neutral-800/80 py-6 px-6 text-xs text-neutral-500">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>
            JLM Télévision H24 · Régie de diffusion continue Twitch & YouTube
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('deploy')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Anti-Veille Render H24
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setActiveTab('bot')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Code source du Bot Discord
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleDownloadBotInstaller}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Télécharger l’archive (.sh)
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
