import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  SkipBack,
  SkipForward,
  RefreshCw,
  ListVideo,
  ListOrdered,
  X,
  Users,
  Radio,
  Tv,
  Minimize2,
  Play,
  Plus,
  Search,
  Trash2,
  Bell,
  ListPlus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { BroadcastMode, BroadcastState, ProgramTheme } from '../types/broadcast';
import { HlsVideoStream } from './HlsVideoStream';
import { ChapterTimeline } from './ChapterTimeline';
import { TvFlashBanner } from './TvFlashBanner';
import { ProgramThumbnail } from './ProgramThumbnail';
import { isRunningInDiscordProxy } from '../hooks/useDiscordActivity';
import {
  PROGRAM_THEMES,
  formatTimecode,
  getActiveChapterInfo,
  getThemeDefinition,
} from '../utils/programMetadata';

interface YoutubeSearchItem {
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  channelName: string;
  durationSeconds: number;
  views: number;
}

function formatCompactViews(views: number): string {
  if (!views) return 'Catalogue H24';
  if (views >= 1_000_000) {
    return `${(views / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M vues`;
  }
  if (views >= 1_000) {
    return `${Math.round(views / 1_000).toLocaleString('fr-FR')} k vues`;
  }
  return `${views.toLocaleString('fr-FR')} vues`;
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
  onSetThemeFilter: (theme: ProgramTheme | 'all') => void;
  onTriggerFlashBanner: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeekSeconds: (seconds: number) => void;
  onSelectVideo: (videoId: string, startSeconds?: number) => void;
  onQueueNext: (videoId: string) => void;
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
  onSetThemeFilter,
  onTriggerFlashBanner,
  onPrev,
  onNext,
  onSeekSeconds,
  onSelectVideo,
  onQueueNext,
  onAddMedia,
  onRemoveVideo,
  onReportDuration,
  onVideoEnded,
  onVideoError,
}: DiscordTvFullScreenProps) {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volumePercent, setVolumePercent] = useState<number>(100);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [controlsVisible, setControlsVisible] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [drawerTab, setDrawerTab] = useState<'programmes' | 'chapitres'>('programmes');
  const [drawerThemeFilter, setDrawerThemeFilter] = useState<ProgramTheme | 'all'>('all');
  const [expandedCardChaptersId, setExpandedCardChaptersId] = useState<string | null>(null);
  const [queuedFeedbackId, setQueuedFeedbackId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const [customLinkInput, setCustomLinkInput] = useState<string>('');
  const [customLinkStatus, setCustomLinkStatus] = useState<string | null>(null);
  const [isSubmittingLink, setIsSubmittingLink] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<YoutubeSearchItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const hideTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const isHoveringControlsRef = useRef<boolean>(false);

  const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';

  const activeVodItem = useMemo(
    () => broadcast.playlist[broadcast.currentIndex] || broadcast.playlist[0] || null,
    [broadcast.playlist, broadcast.currentIndex]
  );

  const nextQueuedId = useMemo(() => {
    if (broadcast.playlist.length <= 1) return null;
    const nextIdx = (broadcast.currentIndex + 1) % broadcast.playlist.length;
    return broadcast.playlist[nextIdx]?.id || null;
  }, [broadcast.playlist, broadcast.currentIndex]);

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

  const clearTimers = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (leaveTimerRef.current) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  const revealControls = () => {
    clearTimers();
    setControlsVisible(true);
    if (!isHoveringControlsRef.current) {
      hideTimerRef.current = window.setTimeout(() => {
        if (!isHoveringControlsRef.current) {
          setControlsVisible(false);
        }
      }, 1450);
    }
  };

  const handleContainerMouseLeave = () => {
    isHoveringControlsRef.current = false;
    clearTimers();
    leaveTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 100);
  };

  useEffect(() => {
    setControlsVisible(true);
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 1400);
    return () => clearTimers();
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

  const positionInVideo =
    !isLiveStream && activeVodItem && activeVodItem.durationSeconds > 0
      ? elapsedSeconds % Math.max(1, activeVodItem.durationSeconds)
      : elapsedSeconds;

  const activeChapterInfo = useMemo(
    () => getActiveChapterInfo(activeVodItem?.chapters, positionInVideo),
    [activeVodItem?.chapters, positionInVideo]
  );

  // Local non-interrupting filtering (browsing categories or typing does NOT stop the live stream!)
  const filteredDrawerPlaylist = useMemo(() => {
    const q = !looksLikeMediaUrlOrId(customLinkInput)
      ? customLinkInput.trim().toLowerCase()
      : '';
    return broadcast.playlist.filter((v) => {
      if (drawerThemeFilter !== 'all' && v.theme !== drawerThemeFilter) return false;
      if (q && !v.title.toLowerCase().includes(q) && !v.id.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [broadcast.playlist, drawerThemeFilter, customLinkInput]);

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
        if (looksLikeMediaUrlOrId(customLinkInput)) {
          setCustomLinkInput('');
        }
        if (playNow) {
          setSearchResults([]);
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

  const handleQueueNextClick = (videoId: string) => {
    onQueueNext(videoId);
    setQueuedFeedbackId(videoId);
    window.setTimeout(() => {
      setQueuedFeedbackId((prev) => (prev === videoId ? null : prev));
    }, 2400);
  };

  const isUrlInput = looksLikeMediaUrlOrId(customLinkInput);
  const showOverlay = controlsVisible || drawerOpen;
  const activeThemeDef = getThemeDefinition(activeVodItem?.theme);

  return (
    <div
      onMouseEnter={revealControls}
      onMouseMove={revealControls}
      onMouseLeave={handleContainerMouseLeave}
      onClick={revealControls}
      className={`fixed inset-0 w-screen h-screen bg-black text-white overflow-hidden select-none flex ${
        showOverlay ? 'cursor-default' : 'cursor-none'
      }`}
    >
      {/* Left / Main Live Broadcast Stage (Never unmounts or stops while browsing Programmes!) */}
      <div className="relative flex-1 min-w-0 h-full bg-black overflow-hidden">
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
          <div className="w-full h-full flex items-center justify-center bg-black text-sm text-neutral-400">
            Synchronisation du flux télévisé H24 en cours...
          </div>
        )}

        {/* Compact Bottom-Right TV Promo Vignette ("À suivre...") */}
        <TvFlashBanner
          activeSource={broadcast.activeSource}
          twitch={broadcast.twitch}
          playlist={broadcast.playlist}
          currentIndex={broadcast.currentIndex}
          activeThemeFilter={broadcast.activeThemeFilter}
          currentVideoStartedAt={broadcast.currentVideoStartedAt}
          clockOffsetMs={clockOffsetMs}
          flashBannerTriggeredAt={broadcast.flashBannerTriggeredAt}
          elevatedAboveControls={showOverlay}
          suppressed={drawerOpen}
        />

        {/* Top Television OSD (150ms fast fade) */}
        <div
          className={`absolute top-0 inset-x-0 z-10 px-6 sm:px-8 pt-5 pb-14 bg-gradient-to-b from-black/90 via-black/45 to-transparent transition-opacity duration-150 ease-out pointer-events-none ${
            showOverlay ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-neutral-300">
                <span className="px-2.5 py-1 bg-white text-black font-mono font-bold tracking-wider uppercase inline-flex items-center gap-1.5">
                  {isLiveStream ? (
                    <>
                      <Radio className="w-3.5 h-3.5 shrink-0" />
                      <span>EN DIRECT</span>
                    </>
                  ) : (
                    <>
                      <Tv className="w-3.5 h-3.5 shrink-0" />
                      <span>JLM TV H24</span>
                    </>
                  )}
                </span>
                <span className="text-neutral-200 font-medium">{activeThemeDef.label}</span>
                <span aria-hidden="true" className="text-neutral-600">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-neutral-300">
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  {broadcast.connectedViewers}
                </span>
                {!isLiveStream && activeChapterInfo && (
                  <>
                    <span aria-hidden="true" className="text-neutral-600">
                      ·
                    </span>
                    <span className="text-neutral-300 truncate max-w-xs">
                      Chapitre {activeChapterInfo.index + 1} : {activeChapterInfo.current.title}
                    </span>
                  </>
                )}
              </div>
              <h1 className="text-sm sm:text-lg font-semibold text-white truncate max-w-2xl">
                {isPlayingTwitchLive
                  ? broadcast.twitch.title
                  : activeVodItem?.title || 'Programme Jean-Luc Mélenchon'}
              </h1>
            </div>

            {canExitFullScreen && (
              <button
                type="button"
                onClick={onExitFullScreen}
                className="pointer-events-auto inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-black/85 hover:bg-white/15 border border-white/20 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Minimize2 className="w-4 h-4 shrink-0" />
                <span>Régie complète</span>
              </button>
            )}
          </div>
        </div>

        {/* Bottom Player Control Bar (150ms fast fade on mouse leave) */}
        <div
          onMouseEnter={() => {
            isHoveringControlsRef.current = true;
            clearTimers();
            setControlsVisible(true);
          }}
          onMouseLeave={() => {
            isHoveringControlsRef.current = false;
          }}
          onClick={(e) => e.stopPropagation()}
          className={`absolute bottom-0 inset-x-0 z-10 px-6 sm:px-8 pb-5 pt-14 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-150 ease-out ${
            showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {!isLiveStream && activeVodItem && activeVodItem.durationSeconds > 0 && (
            <div className="mb-3">
              <ChapterTimeline
                durationSeconds={activeVodItem.durationSeconds}
                positionSeconds={positionInVideo}
                chapters={activeVodItem.chapters}
                onSeekSeconds={onSeekSeconds}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left Cluster: Audio (1% step) + Timecode */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isMuted && volumePercent === 0) {
                    setVolumePercent(50);
                  }
                  setIsMuted((m) => !m);
                }}
                className={`h-10 w-10 inline-flex items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                  isMuted
                    ? 'bg-white text-black border-white hover:bg-neutral-200'
                    : 'bg-black/85 hover:bg-white/15 border-white/20 text-white'
                }`}
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
                className="mono-slider w-24 sm:w-32 cursor-pointer"
              />

              <span className="w-9 text-right text-xs font-mono tabular-nums text-neutral-100">
                {isMuted ? 0 : volumePercent}%
              </span>

              {!isLiveStream && activeVodItem && (
                <span className="text-xs font-mono tabular-nums text-neutral-300 pl-2.5 border-l border-white/15">
                  {formatTimecode(positionInVideo)} / {formatTimecode(activeVodItem.durationSeconds)}
                </span>
              )}
            </div>

            {/* Right Cluster: Remote Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {!isPlayingTwitchLive && (
                <>
                  <button
                    type="button"
                    onClick={onPrev}
                    className="h-10 inline-flex items-center gap-1.5 px-3.5 text-xs font-medium text-white bg-black/85 hover:bg-white/15 border border-white/20 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <SkipBack className="w-4 h-4 shrink-0" />
                    <span className="hidden sm:inline">Précédent</span>
                  </button>
                  {!isLiveStream && (
                    <button
                      type="button"
                      onClick={() => {
                        if (activeVodItem) {
                          onSeekSeconds(positionInVideo + 300);
                        }
                      }}
                      title="Avancer de 5 minutes"
                      className="h-10 inline-flex items-center px-3 text-xs font-mono font-medium text-white bg-black/85 hover:bg-white/15 border border-white/20 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                    >
                      +5m
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onNext}
                    className="h-10 inline-flex items-center gap-1.5 px-3.5 text-xs font-medium text-white bg-black/85 hover:bg-white/15 border border-white/20 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <span className="hidden sm:inline">Suivant</span>
                    <SkipForward className="w-4 h-4 shrink-0" />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={onTriggerFlashBanner}
                title="Afficher la vignette À suivre"
                className="h-10 inline-flex items-center gap-1.5 px-3 text-xs font-medium text-white bg-black/85 hover:bg-white/15 border border-white/20 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <Bell className="w-4 h-4 shrink-0" />
                <span className="hidden xl:inline">À suivre</span>
              </button>

              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                title="Resynchroniser sur le direct"
                className="h-10 inline-flex items-center gap-1.5 px-3 text-xs font-medium text-white bg-black/85 hover:bg-white/15 border border-white/20 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-4 h-4 shrink-0" />
                <span className="hidden xl:inline">Direct</span>
              </button>

              {!isLiveStream && activeVodItem?.chapters && activeVodItem.chapters.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setDrawerTab('chapitres');
                    setDrawerOpen((o) => (drawerTab === 'chapitres' ? !o : true));
                  }}
                  className="h-10 inline-flex items-center gap-1.5 px-3.5 text-xs font-medium text-white bg-black/85 hover:bg-white/15 border border-white/20 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ListOrdered className="w-4 h-4 shrink-0" />
                  <span>Chapitres</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setDrawerTab('programmes');
                  setDrawerOpen((o) => (drawerTab === 'programmes' ? !o : true));
                }}
                className={`h-10 inline-flex items-center gap-2 px-4 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap ${
                  drawerOpen && drawerTab === 'programmes'
                    ? 'bg-neutral-200 text-black'
                    : 'bg-white hover:bg-neutral-200 text-black'
                }`}
              >
                <ListVideo className="w-4 h-4 shrink-0" />
                <span>Programmes</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* YouTube-Style Split / Slide-Over Browser (Live TV keeps playing uninterrupted!) */}
      {drawerOpen && (
        <aside
          onMouseEnter={() => {
            isHoveringControlsRef.current = true;
            clearTimers();
          }}
          onMouseLeave={() => {
            isHoveringControlsRef.current = false;
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-y-0 right-0 lg:static w-full sm:max-w-xl lg:max-w-none lg:w-[500px] xl:w-[580px] shrink-0 bg-neutral-950/98 border-l border-white/15 z-30 flex flex-col shadow-2xl"
        >
          {/* Browser Header + Non-Interrupting Live Status Strip */}
          <div className="px-5 py-4 border-b border-neutral-800 space-y-3 bg-black">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 p-1 bg-neutral-900 border border-neutral-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setDrawerTab('programmes')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    drawerTab === 'programmes'
                      ? 'bg-white text-black font-semibold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Programmes ({broadcast.playlist.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerTab('chapitres')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    drawerTab === 'chapitres'
                      ? 'bg-white text-black font-semibold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Chapitres en cours ({activeVodItem?.chapters?.length || 0})
                </button>
              </div>

              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                title="Refermer le navigateur de programmes"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>Fermer</span>
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quiet Reassurance Strip: Live Broadcast Continues Uninterrupted */}
            <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-400">
              <span className="truncate">
                Diffusion maintenue en direct :{' '}
                <strong className="text-neutral-200 font-medium">
                  {isPlayingTwitchLive
                    ? broadcast.twitch.title
                    : activeVodItem?.title || 'Antenne H24'}
                </strong>
              </span>
              <span className="font-mono tabular-nums text-neutral-300 shrink-0">
                {!isLiveStream && activeVodItem ? formatTimecode(positionInVideo) : 'DIRECT'}
              </span>
            </div>
          </div>

          {drawerTab === 'chapitres' ? (
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="space-y-1 pb-3 border-b border-neutral-800">
                <p className="text-xs text-neutral-400">Chapitrage du programme à l’antenne</p>
                <h3 className="text-sm font-semibold text-white leading-snug">
                  {activeVodItem?.title || 'En direct'}
                </h3>
              </div>

              {activeVodItem?.chapters && activeVodItem.chapters.length > 0 ? (
                <div className="space-y-2 pt-1">
                  {activeVodItem.chapters.map((chap, idx) => {
                    const isCurrent = activeChapterInfo?.index === idx;
                    return (
                      <button
                        key={`${chap.startSeconds}-${idx}`}
                        type="button"
                        onClick={() => {
                          onSeekSeconds(chap.startSeconds);
                        }}
                        className={`w-full text-left px-4 py-3 rounded-xl border transition-colors cursor-pointer flex items-start gap-3.5 ${
                          isCurrent
                            ? 'bg-white text-black border-white'
                            : 'bg-neutral-900/70 hover:bg-neutral-900 text-neutral-200 border-neutral-800'
                        }`}
                      >
                        <span
                          className={`text-xs font-mono tabular-nums pt-0.5 shrink-0 ${
                            isCurrent ? 'text-neutral-700 font-semibold' : 'text-neutral-500'
                          }`}
                        >
                          {formatTimecode(chap.startSeconds)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-xs leading-snug ${
                              isCurrent ? 'text-black font-semibold' : 'text-white font-medium'
                            }`}
                          >
                            {chap.title}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-neutral-400 py-8 text-center">
                  Aucun chapitre disponible sur un flux en direct continu.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* YouTube-Style Search & URL Bar */}
              <form
                onSubmit={handlePrimarySubmit}
                className="px-5 py-3.5 border-b border-neutral-800 bg-neutral-950 space-y-2.5"
              >
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={customLinkInput}
                      onChange={(e) => setCustomLinkInput(e.target.value)}
                      placeholder="Filtrer les programmes, chercher sur YouTube ou coller un lien..."
                      className="w-full pl-9 pr-8 py-2 text-xs bg-black border border-neutral-800 rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:border-white"
                    />
                    {customLinkInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomLinkInput('');
                          setSearchResults([]);
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {isUrlInput ? (
                    <>
                      <button
                        type="submit"
                        disabled={isSubmittingLink}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                        <span>{isSubmittingLink ? '...' : 'Diffuser'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingLink}
                        onClick={() => void submitUrlAction(customLinkInput, false)}
                        title="Ajouter à la grille sans couper la diffusion actuelle"
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" />
                        <span>File</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="submit"
                      disabled={isSearching || !customLinkInput.trim()}
                      title="Rechercher sur YouTube sans couper le direct"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors cursor-pointer shrink-0 disabled:opacity-40 whitespace-nowrap"
                    >
                      <Search className="w-3.5 h-3.5 shrink-0" />
                      <span>{isSearching ? 'Recherche...' : 'YouTube'}</span>
                    </button>
                  )}
                </div>

                {customLinkStatus && (
                  <p className="text-xs text-neutral-200 leading-snug">{customLinkStatus}</p>
                )}
              </form>

              {/* Category Filter Chips (100% Local Browsing — Never Interrupts Live Broadcast!) */}
              <div className="px-5 py-2.5 border-b border-neutral-800 flex items-center justify-between gap-2 bg-black">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  <button
                    type="button"
                    onClick={() => setDrawerThemeFilter('all')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      drawerThemeFilter === 'all'
                        ? 'bg-white text-black font-semibold'
                        : 'text-neutral-400 hover:text-white bg-neutral-900'
                    }`}
                  >
                    Tout ({broadcast.playlist.length})
                  </button>
                  {PROGRAM_THEMES.map((th) => {
                    const count = broadcast.playlist.filter((v) => v.theme === th.id).length;
                    return (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => setDrawerThemeFilter(th.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          drawerThemeFilter === th.id
                            ? 'bg-white text-black font-semibold'
                            : 'text-neutral-400 hover:text-white bg-neutral-900'
                        }`}
                      >
                        {th.shortLabel} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scrollable YouTube-Style Thumbnail Feed */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {/* Live YouTube Search Results with 16:9 Thumbnails */}
                {searchResults.length > 0 && (
                  <div className="space-y-3 pb-5 border-b border-neutral-800">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-white">
                        Résultats YouTube ({searchResults.length})
                      </h3>
                      <button
                        type="button"
                        onClick={() => setSearchResults([])}
                        className="text-xs text-neutral-400 hover:text-white cursor-pointer"
                      >
                        Effacer les résultats
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {searchResults.map((resItem) => (
                        <div
                          key={resItem.videoId}
                          className="group rounded-xl bg-neutral-900/60 border border-neutral-800/90 hover:border-white/30 overflow-hidden flex flex-col transition-colors"
                        >
                          <button
                            type="button"
                            disabled={isSubmittingLink}
                            onClick={() =>
                              void submitUrlAction(
                                `https://www.youtube.com/watch?v=${resItem.videoId}`,
                                true
                              )
                            }
                            className="w-full text-left cursor-pointer"
                          >
                            <ProgramThumbnail
                              videoId={resItem.videoId}
                              thumbnailUrl={resItem.thumbnailUrl}
                              title={resItem.title}
                              durationSeconds={resItem.durationSeconds}
                            />
                          </button>

                          <div className="p-3 flex-1 flex flex-col justify-between gap-2.5">
                            <div className="space-y-1">
                              <button
                                type="button"
                                disabled={isSubmittingLink}
                                onClick={() =>
                                  void submitUrlAction(
                                    `https://www.youtube.com/watch?v=${resItem.videoId}`,
                                    true
                                  )
                                }
                                className="text-left cursor-pointer"
                              >
                                <p className="text-xs font-semibold text-white line-clamp-2 leading-snug group-hover:underline">
                                  {resItem.title}
                                </p>
                              </button>
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400 font-mono tabular-nums">
                                <span className="font-sans truncate max-w-[130px]">
                                  {resItem.channelName}
                                </span>
                                {resItem.views > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-sans">
                                      {formatCompactViews(resItem.views)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 pt-1">
                              <button
                                type="button"
                                disabled={isSubmittingLink}
                                onClick={() =>
                                  void submitUrlAction(
                                    `https://www.youtube.com/watch?v=${resItem.videoId}`,
                                    true
                                  )
                                }
                                className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-[11px] font-semibold text-black bg-white hover:bg-neutral-200 rounded-lg cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              >
                                <Play className="w-3 h-3 fill-current shrink-0" />
                                <span>Diffuser</span>
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
                                title="Ajouter à la grille sans couper le direct"
                                className="inline-flex items-center gap-1 py-1.5 px-2.5 text-[11px] font-medium text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              >
                                <Plus className="w-3 h-3 shrink-0" />
                                <span>Grille</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Optional Channel-Wide Theme Rotation Action (Only when filtering a specific theme) */}
                {drawerThemeFilter !== 'all' && (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-neutral-900/70 border border-neutral-800 text-xs">
                    <span className="text-neutral-300">
                      Aperçu de la rubrique{' '}
                      <strong className="text-white font-semibold">
                        {getThemeDefinition(drawerThemeFilter).label}
                      </strong>
                    </span>
                    {broadcast.activeThemeFilter !== drawerThemeFilter ? (
                      <button
                        type="button"
                        onClick={() => onSetThemeFilter(drawerThemeFilter)}
                        className="text-xs font-semibold text-white hover:underline cursor-pointer whitespace-nowrap"
                      >
                        Programmer l’antenne sur ce thème
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSetThemeFilter('all')}
                        className="text-xs text-neutral-400 hover:text-white cursor-pointer whitespace-nowrap"
                      >
                        Réouvrir toute l’antenne
                      </button>
                    )}
                  </div>
                )}

                {/* H24 Catalog YouTube-Style 2-Column Video Cards */}
                {filteredDrawerPlaylist.length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <p className="text-xs text-neutral-400">
                      Aucun programme de la grille ne correspond à ce filtre.
                    </p>
                    {customLinkInput.trim() && !isUrlInput && (
                      <button
                        type="button"
                        onClick={() => void handleSearchYoutube(customLinkInput)}
                        className="px-4 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl cursor-pointer"
                      >
                        Rechercher « {customLinkInput.trim()} » sur YouTube
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {filteredDrawerPlaylist.map((item) => {
                      const isCurrent = activeVodItem?.id === item.id && !isPlayingTwitchLive;
                      const isQueuedNext = !isCurrent && nextQueuedId === item.id;
                      const itemTheme = getThemeDefinition(item.theme);
                      const chaptersOpen = expandedCardChaptersId === item.id;
                      const justQueued = queuedFeedbackId === item.id;

                      return (
                        <div
                          key={item.id}
                          className={`group rounded-xl border overflow-hidden flex flex-col transition-colors ${
                            isCurrent
                              ? 'bg-neutral-900 border-white/45'
                              : 'bg-neutral-900/45 border-neutral-800/90 hover:border-white/30'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectVideo(item.id)}
                            className="w-full text-left cursor-pointer"
                            title="Lancer ce programme à l’antenne"
                          >
                            <ProgramThumbnail
                              videoId={
                                !item.twitchVodId && !item.twitchChannelLogin
                                  ? item.id
                                  : undefined
                              }
                              thumbnailUrl={item.thumbnailUrl}
                              title={item.title}
                              durationSeconds={item.durationSeconds}
                              isCurrent={isCurrent}
                              isQueuedNext={isQueuedNext}
                            />
                          </button>

                          <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                            <div className="space-y-1.5">
                              <button
                                type="button"
                                onClick={() => onSelectVideo(item.id)}
                                className="text-left cursor-pointer w-full"
                              >
                                <p className="text-xs sm:text-[13px] font-semibold text-white line-clamp-2 leading-snug group-hover:underline">
                                  {item.title}
                                </p>
                              </button>

                              {/* Clean Unboxed Metadata (Zero Static Pills) */}
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400 font-mono tabular-nums">
                                <span className="font-sans text-neutral-300">
                                  {itemTheme.shortLabel}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-sans">{formatCompactViews(item.views)}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-sans">
                                  {item.chapters?.length || 1} chap.
                                </span>
                              </div>
                            </div>

                            {/* Card Actions: Watch Now OR Queue Next / Browse Chapters Without Interrupting */}
                            <div className="space-y-2">
                              <div className="flex items-center gap-1.5">
                                {!isCurrent ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => onSelectVideo(item.id)}
                                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-[11px] font-semibold text-black bg-white hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                                    >
                                      <Play className="w-3 h-3 fill-current shrink-0" />
                                      <span>Regarder</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleQueueNextClick(item.id)}
                                      title="Programmer juste après la diffusion actuelle sans la couper"
                                      className={`inline-flex items-center gap-1 py-1.5 px-2.5 text-[11px] font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                                        justQueued || isQueuedNext
                                          ? 'bg-neutral-200 text-black border-white font-semibold'
                                          : 'bg-neutral-950 text-neutral-200 border-neutral-800 hover:bg-neutral-800 hover:text-white'
                                      }`}
                                    >
                                      <ListPlus className="w-3.5 h-3.5 shrink-0" />
                                      <span>{justQueued ? 'À suivre !' : 'À suivre'}</span>
                                    </button>
                                  </>
                                ) : (
                                  <span className="flex-1 py-1.5 text-[11px] font-semibold text-neutral-200">
                                    En cours de diffusion
                                  </span>
                                )}

                                {item.chapters && item.chapters.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedCardChaptersId((prev) =>
                                        prev === item.id ? null : item.id
                                      )
                                    }
                                    title="Explorer les chapitres sans couper le direct"
                                    className="p-1.5 text-neutral-300 hover:text-white bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors cursor-pointer shrink-0"
                                  >
                                    {chaptersOpen ? (
                                      <ChevronUp className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                )}

                                {item.sourceType === 'custom' && broadcast.playlist.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => onRemoveVideo(item.id)}
                                    title="Retirer de la grille"
                                    className="p-1.5 text-neutral-500 hover:text-white rounded-lg transition-colors cursor-pointer shrink-0"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>

                              {/* Non-Interrupting Inline Chapter Explorer */}
                              {chaptersOpen && item.chapters && item.chapters.length > 1 && (
                                <div className="pt-2 border-t border-neutral-800 space-y-1 max-h-40 overflow-y-auto">
                                  {item.chapters.map((ch, cIdx) => (
                                    <button
                                      key={`${ch.startSeconds}-${cIdx}`}
                                      type="button"
                                      onClick={() => {
                                        if (isCurrent) {
                                          onSeekSeconds(ch.startSeconds);
                                        } else {
                                          onSelectVideo(item.id, ch.startSeconds);
                                        }
                                      }}
                                      className="w-full text-left px-2 py-1 rounded hover:bg-neutral-800 flex items-start gap-2 text-[11px] transition-colors cursor-pointer"
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
