import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  SkipBack,
  SkipForward,
  RefreshCw,
  ListVideo,
  X,
  Users,
  Radio,
  Tv,
  Minimize2,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { BroadcastMode, BroadcastState } from '../types/broadcast';
import { HlsVideoStream } from './HlsVideoStream';
import { isRunningInDiscordProxy } from '../hooks/useDiscordActivity';

interface YoutubeSearchItem {
  videoId: string;
  title: string;
  channelName: string;
  durationSeconds: number;
  views: number;
}

function formatTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function looksLikeMediaUrlOrId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return true;
  if (/^\d{8,14}$/.test(trimmed)) return true;
  return /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be|twitch\.tv)\//i.test(trimmed);
}

interface DiscordTvFullScreenProps {
  broadcast: BroadcastState;
  clockOffsetMs: number;
  canExitFullScreen: boolean;
  onExitFullScreen: () => void;
  onSetMode: (mode: BroadcastMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onSeekSeconds: (seconds: number) => void;
  onSelectVideo: (videoId: string) => void;
  onAddMedia: (url: string, playNow: boolean) => Promise<{ ok: boolean; message: string }>;
  onRemoveVideo: (videoId: string) => void;
  onReportDuration: (videoId: string, durationSeconds: number) => void;
  onVideoEnded: (videoId: string) => void;
  onVideoError: (videoId: string) => void;
}

export function DiscordTvFullScreen({
  broadcast,
  clockOffsetMs,
  canExitFullScreen,
  onExitFullScreen,
  onSetMode,
  onPrev,
  onNext,
  onSeekSeconds,
  onSelectVideo,
  onAddMedia,
  onRemoveVideo,
  onReportDuration,
  onVideoEnded,
  onVideoError,
}: DiscordTvFullScreenProps) {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volumePercent, setVolumePercent] = useState<number>(100);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const [customLinkInput, setCustomLinkInput] = useState<string>('');
  const [customLinkStatus, setCustomLinkStatus] = useState<string | null>(null);
  const [isSubmittingLink, setIsSubmittingLink] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<YoutubeSearchItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const hideTimerRef = useRef<number | null>(null);
  const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';

  const activeVodItem = useMemo(
    () => broadcast.playlist[broadcast.currentIndex] || broadcast.playlist[0] || null,
    [broadcast.playlist, broadcast.currentIndex]
  );

  const isPlayingTwitchLive =
    broadcast.activeSource === 'twitch' && broadcast.twitch.isLive;
  const isLiveStream =
    isPlayingTwitchLive || Boolean(activeVodItem?.twitchChannelLogin);

  useEffect(() => {
    const tick = () => {
      const serverNow = Date.now() + clockOffsetMs;
      setElapsedSeconds(
        Math.max(0, Math.floor((serverNow - broadcast.currentVideoStartedAt) / 1000))
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [broadcast.currentVideoStartedAt, clockOffsetMs]);

  const revealControls = () => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 3200);
  };

  useEffect(() => {
    revealControls();
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  const manifestUrl = useMemo(() => {
    if (isPlayingTwitchLive) {
      return `${apiBase}/api/hls/live.m3u8`;
    }
    if (activeVodItem?.twitchChannelLogin) {
      return `${apiBase}/api/hls/channel-${activeVodItem.twitchChannelLogin}.m3u8`;
    }
    if (activeVodItem?.twitchVodId) {
      return `${apiBase}/api/hls/vod-${activeVodItem.twitchVodId}.m3u8`;
    }
    if (activeVodItem?.id) {
      return `${apiBase}/api/yt/stream/${encodeURIComponent(activeVodItem.id)}`;
    }
    return '';
  }, [
    apiBase,
    isPlayingTwitchLive,
    activeVodItem?.id,
    activeVodItem?.twitchChannelLogin,
    activeVodItem?.twitchVodId,
  ]);

  const targetStartSec = useMemo(() => {
    if (isLiveStream || !activeVodItem) return 0;
    const serverNow = Date.now() + clockOffsetMs;
    const rawElapsed = Math.max(
      0,
      Math.floor((serverNow - broadcast.currentVideoStartedAt) / 1000)
    );
    return activeVodItem.durationSeconds > 0
      ? rawElapsed % activeVodItem.durationSeconds
      : rawElapsed;
  }, [
    isLiveStream,
    activeVodItem?.id,
    activeVodItem?.durationSeconds,
    broadcast.currentVideoStartedAt,
    clockOffsetMs,
    reloadNonce,
  ]);

  const submitUrlAction = async (rawInput: string, playNow: boolean) => {
    const trimmed = rawInput.trim();
    if (!trimmed || isSubmittingLink) return;
    const normalized =
      /^(www\.|m\.)?(youtube\.com|youtu\.be|twitch\.tv)\//i.test(trimmed)
        ? `https://${trimmed}`
        : trimmed;

    setIsSubmittingLink(true);
    try {
      const res = await onAddMedia(normalized, playNow);
      setCustomLinkStatus(res.message);
      if (res.ok) {
        setCustomLinkInput('');
        setSearchResults([]);
        if (playNow) {
          setDrawerOpen(false);
        }
      }
      window.setTimeout(() => setCustomLinkStatus(null), 5000);
    } finally {
      setIsSubmittingLink(false);
    }
  };

  const handleSearchYoutube = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || isSearching) return;
    setIsSearching(true);
    setCustomLinkStatus(null);
    try {
      const res = await fetch(
        `${apiBase}/api/tv/youtube-search?q=${encodeURIComponent(trimmed)}`
      );
      if (res.ok) {
        const data = (await res.json()) as { results?: YoutubeSearchItem[] };
        const items = data.results || [];
        setSearchResults(items);
        if (items.length === 0) {
          setCustomLinkStatus('Aucun résultat YouTube trouvé pour cette recherche.');
        }
      }
    } catch {
      setCustomLinkStatus('Erreur réseau lors de la recherche YouTube.');
    } finally {
      setIsSearching(false);
    }
  };

  const handlePrimarySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customLinkInput.trim();
    if (!trimmed) return;
    if (looksLikeMediaUrlOrId(trimmed)) {
      await submitUrlAction(trimmed, true);
    } else {
      await handleSearchYoutube(trimmed);
    }
  };

  const isUrlInput = looksLikeMediaUrlOrId(customLinkInput);
  const showOverlay = controlsVisible || drawerOpen || isMuted;

  return (
    <div
      onMouseMove={revealControls}
      onClick={revealControls}
      className="fixed inset-0 w-screen h-screen bg-black text-slate-100 overflow-hidden select-none"
    >
      {/* 100% Full-Screen Video Feed */}
      {manifestUrl ? (
        <HlsVideoStream
          manifestUrl={manifestUrl}
          isLive={isLiveStream}
          targetStartSeconds={targetStartSec}
          isMuted={isMuted}
          volume={volumePercent / 100}
          reloadKey={reloadNonce}
          onMutedChange={setIsMuted}
          onDurationDetected={(dur) => {
            if (activeVodItem && !isLiveStream) {
              onReportDuration(activeVodItem.id, dur);
            }
          }}
          onEnded={() => {
            if (activeVodItem) onVideoEnded(activeVodItem.id);
          }}
          onStreamError={() => {
            if (isPlayingTwitchLive) {
              onSetMode('auto');
            } else if (activeVodItem) {
              onVideoError(activeVodItem.id);
            }
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-black text-sm text-slate-400">
          Synchronisation du flux télévisé H24 en cours...
        </div>
      )}

      {/* Subtle Top Television OSD */}
      <div
        className={`absolute top-0 inset-x-0 z-10 px-6 pt-5 pb-10 bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-200 pointer-events-none ${
          showOverlay ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              {isLiveStream ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                  <Radio className="w-3.5 h-3.5 shrink-0" />
                  EN DIRECT ·{' '}
                  {isPlayingTwitchLive
                    ? 'Twitch jlmelenchon'
                    : `Twitch ${activeVodItem?.twitchChannelLogin}`}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-rose-400">
                  <Tv className="w-3.5 h-3.5 shrink-0" />
                  JLM TV H24 · Diffusion continue
                </span>
              )}
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-300">
                <Users className="w-3.5 h-3.5 shrink-0" />
                {broadcast.connectedViewers}
              </span>
            </div>
            <h1 className="text-sm sm:text-base font-semibold text-white truncate max-w-2xl">
              {isPlayingTwitchLive
                ? broadcast.twitch.title
                : activeVodItem?.title || 'Programme Jean-Luc Mélenchon'}
            </h1>
          </div>

          {canExitFullScreen && (
            <button
              type="button"
              onClick={onExitFullScreen}
              className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900/80 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Minimize2 className="w-3.5 h-3.5 shrink-0" />
              <span>Régie complète</span>
            </button>
          )}
        </div>
      </div>

      {/* Bottom Television Remote Bar */}
      <div
        className={`absolute bottom-0 inset-x-0 z-10 px-6 pb-4 pt-10 bg-gradient-to-t from-black/90 via-black/45 to-transparent transition-opacity duration-200 ${
          showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {!isLiveStream && activeVodItem && activeVodItem.durationSeconds > 0 && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              onSeekSeconds(Math.round(ratio * activeVodItem.durationSeconds));
            }}
            className="h-1.5 hover:h-2.5 w-full bg-white/20 rounded-full overflow-hidden mb-3 cursor-pointer transition-all"
            title="Cliquer pour avancer ou reculer dans la vidéo"
          >
            <progress
              value={elapsedSeconds % Math.max(1, activeVodItem.durationSeconds)}
              max={activeVodItem.durationSeconds}
              className="block w-full h-full appearance-none [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:bg-rose-500 [&::-moz-progress-bar]:bg-rose-500"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Audio (1% by 1% precision slider) + Timecode */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2.5"
          >
            <button
              type="button"
              onClick={() => {
                if (isMuted && volumePercent === 0) {
                  setVolumePercent(50);
                }
                setIsMuted((m) => !m);
              }}
              className="p-2 rounded-lg bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 text-white transition-colors cursor-pointer"
              title={isMuted ? 'Activer le son' : 'Couper le son'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={isMuted ? 0 : volumePercent}
              onChange={(e) => {
                const pct = Math.max(0, Math.min(100, Math.round(Number(e.target.value))));
                setVolumePercent(pct);
                setIsMuted(pct === 0);
              }}
              aria-label="Volume sonore pourcent par pourcent"
              className="w-28 sm:w-36 accent-rose-600 cursor-pointer"
            />

            <span className="w-9 text-right text-xs font-mono tabular-nums text-slate-200">
              {isMuted ? 0 : volumePercent}%
            </span>

            {!isLiveStream && activeVodItem && (
              <span className="text-xs font-mono tabular-nums text-slate-300 pl-1.5">
                {formatTimecode(elapsedSeconds % Math.max(1, activeVodItem.durationSeconds))} /{' '}
                {formatTimecode(activeVodItem.durationSeconds)}
              </span>
            )}
          </div>

          {/* Channel / Program Remote Actions */}
          <div className="flex items-center gap-2">
            {!isPlayingTwitchLive && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPrev();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <SkipBack className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Précédent</span>
                </button>
                {!isLiveStream && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeVodItem) {
                        const pos =
                          elapsedSeconds % Math.max(1, activeVodItem.durationSeconds);
                        onSeekSeconds(pos + 300);
                      }
                    }}
                    title="Avancer de 5 minutes"
                    className="inline-flex items-center px-2.5 py-1.5 text-xs font-mono font-medium text-slate-200 bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    +5m
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNext();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <span className="hidden sm:inline">Suivant</span>
                  <SkipForward className="w-3.5 h-3.5 shrink-0" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setReloadNonce((n) => n + 1);
              }}
              title="Resynchroniser sur le direct"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">Direct</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDrawerOpen((o) => !o);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-rose-600/90 hover:bg-rose-500 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <ListVideo className="w-3.5 h-3.5 shrink-0" />
              <span>Programmes</span>
            </button>
          </div>
        </div>
      </div>

      {/* Compact Slide-Over Program Guide & YouTube/Twitch Launcher Drawer */}
      {drawerOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-0 right-0 bottom-0 w-full max-w-md bg-slate-950/95 border-l border-slate-800 z-30 flex flex-col"
        >
          <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">Grille & Ajout de vidéos</h2>
              <p className="text-xs text-slate-400">
                YouTube & Twitch synchronisés pour tout le salon vocal
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-1 bg-slate-900/60">
            <button
              type="button"
              onClick={() => onSetMode('auto')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                broadcast.mode === 'auto'
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Auto (Priorité Live Twitch)
            </button>
            <button
              type="button"
              onClick={() => onSetMode('force_youtube')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                broadcast.mode === 'force_youtube'
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Grille Vidéos JLM
            </button>
          </div>

          {/* Direct YouTube / Twitch URL or Search Box inside Discord Activity */}
          <form
            onSubmit={handlePrimarySubmit}
            className="p-3.5 border-b border-slate-800 bg-slate-900/40 space-y-2"
          >
            <label className="block text-[11px] font-medium text-slate-300">
              Coller un lien YouTube / Twitch ou rechercher une vidéo
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={customLinkInput}
                onChange={(e) => setCustomLinkInput(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=... ou recherche"
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
              />
              {isUrlInput ? (
                <>
                  <button
                    type="submit"
                    disabled={isSubmittingLink}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    <Play className="w-3 h-3 fill-current shrink-0" />
                    <span>{isSubmittingLink ? '...' : 'Diffuser'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmittingLink}
                    onClick={() => void submitUrlAction(customLinkInput, false)}
                    title="Ajouter à la grille sans couper la vidéo en cours"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>Grille</span>
                  </button>
                </>
              ) : (
                <button
                  type="submit"
                  disabled={isSearching || !customLinkInput.trim()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <Search className="w-3.5 h-3.5 shrink-0" />
                  <span>{isSearching ? '...' : 'Chercher'}</span>
                </button>
              )}
            </div>

            {customLinkStatus && (
              <p className="text-[11px] text-emerald-400 leading-snug">{customLinkStatus}</p>
            )}

            {searchResults.length > 0 && (
              <div className="pt-1 space-y-1.5 max-h-52 overflow-y-auto border-t border-slate-800/80">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Résultats YouTube</span>
                  <button
                    type="button"
                    onClick={() => setSearchResults([])}
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    Fermer
                  </button>
                </div>
                {searchResults.map((resItem) => (
                  <div
                    key={resItem.videoId}
                    className="p-2 rounded-lg bg-slate-950/90 border border-slate-800/80 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-100 line-clamp-2 leading-snug">
                        {resItem.title}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {resItem.channelName} · {formatTimecode(resItem.durationSeconds)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={isSubmittingLink}
                        onClick={() =>
                          void submitUrlAction(
                            `https://www.youtube.com/watch?v=${resItem.videoId}`,
                            true
                          )
                        }
                        className="px-2 py-1 text-[11px] font-medium text-white bg-rose-600 hover:bg-rose-500 rounded cursor-pointer disabled:opacity-50"
                      >
                        Diffuser
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingLink}
                        onClick={() =>
                          void submitUrlAction(
                            `https://www.youtube.com/watch?v=${resItem.videoId}`,
                            false
                          )
                        }
                        title="Ajouter à la grille"
                        className="p-1 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </form>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
            {broadcast.playlist.map((item, idx) => {
              const isSelected = activeVodItem?.id === item.id && !isPlayingTwitchLive;
              return (
                <div
                  key={item.id}
                  className={`w-full px-4 py-3 flex items-start gap-3 transition-colors ${
                    isSelected ? 'bg-slate-800/90' : 'hover:bg-slate-900'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectVideo(item.id);
                      setDrawerOpen(false);
                    }}
                    className="flex-1 min-w-0 text-left flex items-start gap-3 cursor-pointer"
                  >
                    <span className="text-xs font-mono tabular-nums text-slate-500 pt-0.5 w-5 shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-xs font-medium text-slate-100 line-clamp-2 leading-snug">
                        {item.title}
                      </p>
                      <p className="text-[11px] font-mono tabular-nums text-slate-400">
                        {item.twitchChannelLogin
                          ? `Direct Twitch · ${item.twitchChannelLogin}`
                          : `${item.sourceType === 'custom' ? 'Ajouté · ' : ''}Durée ${formatTimecode(item.durationSeconds)}`}
                      </p>
                    </div>
                  </button>

                  {item.sourceType === 'custom' && broadcast.playlist.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveVideo(item.id)}
                      title="Retirer de la grille"
                      className="p-1.5 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
