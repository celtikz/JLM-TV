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
} from 'lucide-react';
import type {
  BotConfigOptions,
  BroadcastMode,
  BroadcastState,
  ChatMessage,
} from './types/broadcast';
import { TvPlayer } from './components/TvPlayer';
import { BotBuilderView } from './components/BotBuilderView';
import { DeploymentGuideView } from './components/DeploymentGuideView';
import { generateDiscordBotFiles } from './utils/botGenerator';
import { isRunningInDiscordProxy, useDiscordActivity } from './hooks/useDiscordActivity';

type NavTab = 'regie' | 'grille' | 'bot' | 'deploy';

function formatViews(views: number): string {
  if (!views) return 'Ajout manuel';
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

function formatDurationHuman(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export default function App() {
  const discordActivity = useDiscordActivity();

  const [activeTab, setActiveTab] = useState<NavTab>('regie');
  const [broadcast, setBroadcast] = useState<BroadcastState | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [clockOffsetMs, setClockOffsetMs] = useState<number>(0);
  const [isProbing, setIsProbing] = useState<boolean>(false);

  // Playlist search & add inputs
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'rss' | 'custom'>('all');
  const [customYoutubeUrl, setCustomYoutubeUrl] = useState<string>('');
  const [addStatusMsg, setAddStatusMsg] = useState<string | null>(null);

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

  // Initial HTTP fetch + Real-time WebSocket connection with auto-reconnect
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

  const handleAddYoutubeVideo = (playNow: boolean) => {
    const trimmed = customYoutubeUrl.trim();
    if (!trimmed) return;
    sendWsAction('playlist:add', { url: trimmed, playNow });
    setCustomYoutubeUrl('');
    setAddStatusMsg(
      playNow
        ? 'Vidéo envoyée à l’antenne en direct.'
        : 'Vidéo ajoutée en haut de la grille YouTube.'
    );
    window.setTimeout(() => setAddStatusMsg(null), 3000);
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

  const filteredPlaylist = useMemo(() => {
    if (!broadcast) return [];
    const q = searchQuery.trim().toLowerCase();
    return broadcast.playlist.filter((item) => {
      if (sourceFilter !== 'all' && item.sourceType !== sourceFilter) return false;
      if (q && !item.title.toLowerCase().includes(q) && !item.id.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [broadcast, searchQuery, sourceFilter]);

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F19] text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/90 bg-[#0B0F19]/95 sticky top-0 z-30 backdrop-blur-sm">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => setActiveTab('regie')}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer font-[family-name:var(--font-display)]"
        >
          JLM Télévision H24
        </button>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          {(
            [
              { id: 'regie', label: 'Régie & Direct' },
              { id: 'grille', label: 'Grille YouTube' },
              { id: 'bot', label: 'Bot Vocal Go Live' },
              { id: 'deploy', label: 'Déploiement H24' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                activeTab === item.id
                  ? 'text-white border-rose-500'
                  : 'border-transparent hover:text-slate-100 hover:border-slate-700'
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
            className="px-4 py-2 text-xs font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Télécharger le Bot H24
          </button>
        </div>
      </header>

      {/* Mobile Navigation Bar */}
      <div className="md:hidden flex items-center gap-4 px-4 py-2.5 border-b border-slate-800 overflow-x-auto bg-slate-950">
        {(
          [
            { id: 'regie', label: 'Régie & Direct' },
            { id: 'grille', label: 'Grille YouTube' },
            { id: 'bot', label: 'Bot Vocal Go Live' },
            { id: 'deploy', label: 'Déploiement H24' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={`text-xs font-medium py-1 whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === item.id
                ? 'text-white border-rose-500'
                : 'text-slate-400 border-transparent'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!broadcast ? (
          /* Skeleton Loading State */
          <div className="space-y-6 animate-pulse">
            <div className="h-12 bg-slate-900 rounded-xl border border-slate-800" />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8 aspect-video bg-slate-900 rounded-xl border border-slate-800" />
              <div className="lg:col-span-4 h-[460px] bg-slate-900 rounded-xl border border-slate-800" />
            </div>
          </div>
        ) : activeTab === 'regie' ? (
          <div className="space-y-8">
            {/* Workspace Control Toolbar */}
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className={wsConnected ? 'text-emerald-400 font-medium' : 'text-amber-400'}>
                    {wsConnected ? 'Régie synchronisée en temps réel' : 'Reconnexion régie...'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-300">
                    <Users className="w-3.5 h-3.5 shrink-0" />
                    {broadcast.connectedViewers}{' '}
                    {broadcast.connectedViewers > 1 ? 'spectateurs connectés' : 'spectateur connecté'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Twitch jlmelenchon :{' '}
                    <strong
                      className={
                        broadcast.twitch.isLive ? 'text-emerald-400 font-medium' : 'text-slate-300'
                      }
                    >
                      {broadcast.twitch.isLive ? 'EN DIRECT' : 'Hors ligne'}
                    </strong>
                  </span>
                  {discordActivity.isEmbeddedInDiscord && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-indigo-400 font-medium">Discord Activity vocale</span>
                    </>
                  )}
                </div>
                <h1 className="text-2xl font-semibold text-white">
                  Moniteur d’antenne H24 — Mode Télévision
                </h1>
              </div>

              {/* Interactive Mode Segmented Selector + Probe Action */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                  {(
                    [
                      { id: 'auto', label: 'Auto (Priorité Twitch)' },
                      { id: 'force_twitch', label: 'Twitch Direct' },
                      { id: 'force_youtube', label: 'Grille YouTube' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSetMode(m.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        broadcast.mode === m.id
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-100'
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
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isProbing ? 'animate-spin' : ''}`} />
                  <span>Actualiser Twitch & RSS</span>
                </button>
              </div>
            </div>

            {/* Primary 2-Column Broadcast Studio Split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left 8 Cols: Master TV Monitor + Up Next Strip */}
              <div className="lg:col-span-8 space-y-6">
                <TvPlayer
                  activeSource={broadcast.activeSource}
                  twitch={broadcast.twitch}
                  currentVideo={currentVideo}
                  currentVideoStartedAt={broadcast.currentVideoStartedAt}
                  clockOffsetMs={clockOffsetMs}
                  onPrevVideo={() => sendWsAction('playlist:prev')}
                  onNextVideo={() => sendWsAction('playlist:next')}
                  onSwitchToYoutube={() => handleSetMode('force_youtube')}
                  onReportDuration={handleReportDuration}
                  onVideoEnded={handleVideoEnded}
                  onVideoError={handleVideoError}
                />

                {/* Quick Add Custom YouTube Video to Live Broadcast */}
                <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      Lancer ou programmer une vidéo YouTube immédiatement
                    </h3>
                    {addStatusMsg && (
                      <span className="text-xs text-emerald-400">{addStatusMsg}</span>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="text"
                      value={customYoutubeUrl}
                      onChange={(e) => setCustomYoutubeUrl(e.target.value)}
                      placeholder="Coller un lien YouTube (ex. https://www.youtube.com/watch?v=...)"
                      className="flex-1 px-3.5 py-2 text-sm bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAddYoutubeVideo(true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 shrink-0" />
                        <span>Diffuser maintenant</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddYoutubeVideo(false)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" />
                        <span>Ajouter à la file</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right 4 Cols: Up Next Queue + Live Salon Chat */}
              <div className="lg:col-span-4 space-y-6">
                {/* Upcoming YouTube Fallback Queue */}
                <div className="border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
                  <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Grille de relais YouTube
                      </h3>
                      <p className="text-xs text-slate-400">
                        Chaîne officielle Jean-Luc Mélenchon ({broadcast.playlist.length} vidéos)
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        sendWsAction('playlist:shuffle', { shuffle: !broadcast.shuffleYoutube })
                      }
                      title="Activer ou désactiver la rotation aléatoire"
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        broadcast.shuffleYoutube
                          ? 'bg-rose-600/20 text-rose-300 border-rose-500/40'
                          : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <Shuffle className="w-3.5 h-3.5 shrink-0" />
                      <span>{broadcast.shuffleYoutube ? 'Aléatoire' : 'Séquentiel'}</span>
                    </button>
                  </div>

                  <div className="divide-y divide-slate-800/70 max-h-[300px] overflow-y-auto">
                    {broadcast.playlist.slice(0, 8).map((video, idx) => {
                      const isCurrent = idx === broadcast.currentIndex;
                      return (
                        <button
                          key={video.id}
                          type="button"
                          onClick={() => sendWsAction('playlist:select', { videoId: video.id })}
                          className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer ${
                            isCurrent ? 'bg-slate-800/80' : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <span className="text-xs font-mono tabular-nums text-slate-500 pt-0.5 w-5 shrink-0">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p
                              className={`text-xs font-medium line-clamp-2 leading-snug ${
                                isCurrent ? 'text-white' : 'text-slate-300'
                              }`}
                            >
                              {video.title}
                            </p>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono tabular-nums">
                              {isCurrent && broadcast.activeSource === 'youtube' && (
                                <>
                                  <span className="text-amber-400 font-sans font-medium">
                                    À l’antenne
                                  </span>
                                  <span aria-hidden="true">·</span>
                                </>
                              )}
                              <span>{formatViews(video.views)}</span>
                              <span aria-hidden="true">·</span>
                              <span>{formatDateShort(video.publishedAt)}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      Cliquez sur un titre pour le lancer
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('grille')}
                      className="text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Voir toute la grille
                    </button>
                  </div>
                </div>

                {/* Real-Time WebSocket Salon Chat */}
                <div className="border border-slate-800 bg-slate-900/50 rounded-xl flex flex-col h-[340px]">
                  <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">Discussion du salon direct</h3>
                    <input
                      type="text"
                      value={authorName}
                      onChange={(e) => setAuthorName(e.target.value)}
                      aria-label="Votre pseudonyme"
                      className="w-32 px-2 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-300 focus:outline-none focus:border-slate-600"
                    />
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
                    {broadcast.chatMessages.map((m) => (
                      <div key={m.id} className="space-y-0.5">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-slate-200">{m.author}</span>
                          <span className="text-[11px] font-mono tabular-nums text-slate-500">
                            {new Date(m.createdAt).toLocaleTimeString('fr-FR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-slate-300 leading-relaxed break-words">{m.text}</p>
                      </div>
                    ))}
                  </div>

                  <form
                    onSubmit={handleSendChat}
                    className="p-3 border-t border-slate-800 flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Envoyer un message au salon..."
                      className="flex-1 px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5 shrink-0" />
                      <span>Envoyer</span>
                    </button>
                  </form>
                </div>
              </div>
            </div>

            {/* Broadcast Transition History Table */}
            <section className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">
                  Journal des bascules d’antenne H24
                </h3>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  Dernière vérification Twitch :{' '}
                  {new Date(broadcast.twitch.lastCheckedAt).toLocaleTimeString('fr-FR')}
                </span>
              </div>
              <div className="divide-y divide-slate-800/70">
                {broadcast.transitions.slice(0, 5).map((tr) => (
                  <div
                    key={tr.id}
                    className="px-5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2.5 text-slate-200">
                      {tr.source === 'twitch' ? (
                        <Radio className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Tv className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      )}
                      <span>{tr.message}</span>
                    </div>
                    <span className="font-mono tabular-nums text-slate-500 shrink-0">
                      {new Date(tr.timestamp).toLocaleTimeString('fr-FR')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : activeTab === 'grille' ? (
          /* Full YouTube Fallback Schedule Management View */
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-slate-800">
              <div className="space-y-1.5">
                <h1 className="text-2xl sm:text-3xl font-semibold text-white">
                  Grille YouTube de relais H24 — Jean-Luc Mélenchon
                </h1>
                <p className="text-sm text-slate-400">
                  Synchronisée automatiquement avec le flux RSS officiel{' '}
                  <span className="font-mono text-slate-300">@JLMelenchon</span>. Ces vidéos
                  prennent le relais dès qu’aucun direct n’est actif sur Twitch.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                  {(
                    [
                      { id: 'all', label: 'Toutes' },
                      { id: 'rss', label: 'Flux officiel JLM' },
                      { id: 'custom', label: 'Ajouts manuels' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSourceFilter(f.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        sourceFilter === f.id
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Search & Add Row */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un meeting, une conférence ou un sujet..."
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="lg:col-span-7 flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={customYoutubeUrl}
                  onChange={(e) => setCustomYoutubeUrl(e.target.value)}
                  placeholder="Ajouter une vidéo YouTube par URL ou ID (11 caractères)..."
                  className="flex-1 px-3.5 py-2.5 text-sm bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                />
                <button
                  type="button"
                  onClick={() => handleAddYoutubeVideo(false)}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>Ajouter à la grille</span>
                </button>
              </div>
            </div>

            {/* High-Density Schedule Table */}
            {filteredPlaylist.length === 0 ? (
              <div className="border border-slate-800 bg-slate-900/40 rounded-xl p-12 text-center space-y-3">
                <p className="text-sm text-slate-300">
                  Aucune vidéo ne correspond à votre filtre actuel.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSourceFilter('all');
                  }}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  Réinitialiser les filtres
                </button>
              </div>
            ) : (
              <div className="border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs text-slate-400 bg-slate-950/50">
                        <th className="py-3 px-4 font-medium w-14">#</th>
                        <th className="py-3 px-4 font-medium">Programme YouTube</th>
                        <th className="py-3 px-4 font-medium hidden md:table-cell">Publication</th>
                        <th className="py-3 px-4 font-medium text-right hidden sm:table-cell">
                          Audience
                        </th>
                        <th className="py-3 px-4 font-medium text-right hidden sm:table-cell">
                          Durée
                        </th>
                        <th className="py-3 px-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-sm">
                      {filteredPlaylist.map((video) => {
                        const realIndex = broadcast.playlist.findIndex((v) => v.id === video.id);
                        const isPlaying = realIndex === broadcast.currentIndex;

                        return (
                          <tr
                            key={video.id}
                            className={`transition-colors ${
                              isPlaying ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
                            }`}
                          >
                            <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500">
                              {String(realIndex + 1).padStart(2, '0')}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3.5">
                                <div className="w-20 aspect-video rounded bg-slate-950 overflow-hidden shrink-0 border border-slate-800 flex items-center justify-center">
                                  <img
                                    src={video.thumbnailUrl}
                                    alt={video.title}
                                    referrerPolicy="no-referrer"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                <div className="min-w-0 space-y-0.5">
                                  <p className="font-medium text-slate-100 line-clamp-1">
                                    {video.title}
                                  </p>
                                  <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <span className="font-mono">{video.id}</span>
                                    {isPlaying && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="text-amber-400 font-medium">
                                          Sélectionné en régie
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-400 hidden md:table-cell whitespace-nowrap">
                              {formatDateShort(video.publishedAt)}
                            </td>
                            <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-300 text-right hidden sm:table-cell whitespace-nowrap">
                              {formatViews(video.views)}
                            </td>
                            <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-400 text-right hidden sm:table-cell whitespace-nowrap">
                              {formatDurationHuman(video.durationSeconds)}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    sendWsAction('playlist:select', { videoId: video.id });
                                    setActiveTab('regie');
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-rose-600 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                                >
                                  <Play className="w-3 h-3 shrink-0" />
                                  <span>Diffuser</span>
                                </button>
                                {broadcast.playlist.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      sendWsAction('playlist:remove', { videoId: video.id })
                                    }
                                    title="Retirer de la grille"
                                    className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'bot' ? (
          <BotBuilderView
            config={botConfig}
            onChangeConfig={setBotConfig}
            onDownloadInstaller={handleDownloadBotInstaller}
          />
        ) : (
          <DeploymentGuideView
            appOrigin={window.location.origin}
            onDownloadInstaller={handleDownloadBotInstaller}
            onSwitchTab={(t) => setActiveTab(t)}
          />
        )}
      </main>

      {/* Clean Quiet Footer */}
      <footer className="border-t border-slate-800/80 py-5 px-6 text-xs text-slate-500">
        <div className="max-w-[1380px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>
            JLM Télévision H24 · Régie de synchronisation Twitch (jlmelenchon) & YouTube
            (@JLMelenchon)
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('bot')}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              Code source du Bot Discord
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleDownloadBotInstaller}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              Télécharger l’archive (.sh)
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
