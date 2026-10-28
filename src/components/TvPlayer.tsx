import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  SkipForward,
  SkipBack,
  RefreshCw,
  Radio,
  ExternalLink,
  Maximize2,
  ListOrdered,
  Bell,
  ArrowUpLeft,
} from 'lucide-react';
import type {
  ActiveSource,
  ProgramTheme,
  TwitchStatus,
  YouTubeVideoItem,
} from '../types/broadcast';
import { isRunningInDiscordProxy } from '../hooks/useDiscordActivity';
import {
  formatBroadcastHour,
  formatTimecode,
  getActiveChapterInfo,
  getEffectiveOutroTrimSeconds,
  getThemeDefinition,
} from '../utils/programMetadata';
import { HlsVideoStream } from './HlsVideoStream';
import { ChapterTimeline } from './ChapterTimeline';
import { TvFlashBanner } from './TvFlashBanner';

const STUDIO_SLATE_IMG = '/src/assets/images/tv_broadcast_slate_1793131336238.jpg';

interface TvPlayerProps {
  activeSource: ActiveSource;
  twitch: TwitchStatus;
  playlist: YouTubeVideoItem[];
  currentIndex: number;
  activeThemeFilter: ProgramTheme | 'all';
  flashBannerTriggeredAt: number;
  currentVideo: YouTubeVideoItem | null;
  currentVideoStartedAt: number;
  clockOffsetMs: number;
  miniMode?: boolean;
  onReturnToRegie?: () => void;
  onPrevVideo: () => void;
  onNextVideo: () => void;
  onSeekSeconds: (seconds: number) => void;
  onTriggerFlashBanner: () => void;
  onSwitchToYoutube: () => void;
  onEnterFullScreenTv: () => void;
  onReportDuration: (videoId: string, durationSeconds: number) => void;
  onVideoEnded: (videoId: string) => void;
  onVideoError: (videoId: string) => void;
}

export function TvPlayer({
  activeSource,
  twitch,
  playlist,
  currentIndex,
  activeThemeFilter,
  flashBannerTriggeredAt,
  currentVideo,
  currentVideoStartedAt,
  clockOffsetMs,
  miniMode = false,
  onReturnToRegie,
  onPrevVideo,
  onNextVideo,
  onSeekSeconds,
  onTriggerFlashBanner,
  onSwitchToYoutube,
  onEnterFullScreenTv,
  onReportDuration,
  onVideoEnded,
  onVideoError,
}: TvPlayerProps) {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volumePercent, setVolumePercent] = useState<number>(100);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [slateImgError, setSlateImgError] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [controlsVisible, setControlsVisible] = useState<boolean>(false);
  const [chaptersExpanded, setChaptersExpanded] = useState<boolean>(true);

  const hideTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const isHoveringBarRef = useRef<boolean>(false);

  const targetStartRef = useRef<number>(currentVideoStartedAt);
  const clockOffsetRef = useRef<number>(clockOffsetMs);
  targetStartRef.current = currentVideoStartedAt;
  clockOffsetRef.current = clockOffsetMs;

  const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';

  useEffect(() => {
    const updateClock = () => {
      const serverNow = Date.now() + clockOffsetRef.current;
      const sec = Math.max(0, Math.floor((serverNow - targetStartRef.current) / 1000));
      setElapsedSeconds(sec);
    };
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, [currentVideoStartedAt, clockOffsetMs]);

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

  const handleVideoMouseMove = () => {
    if (miniMode) return;
    clearTimers();
    setControlsVisible(true);
    if (!isHoveringBarRef.current) {
      hideTimerRef.current = window.setTimeout(() => {
        if (!isHoveringBarRef.current) {
          setControlsVisible(false);
        }
      }, 1450);
    }
  };

  const handleVideoMouseLeave = () => {
    isHoveringBarRef.current = false;
    clearTimers();
    leaveTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 100);
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    if (!nextMuted && volumePercent === 0) {
      setVolumePercent(50);
    }
    setIsMuted(nextMuted);
  };

  const handleVolumeChange = (nextPercent: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextPercent)));
    setVolumePercent(clamped);
    setIsMuted(clamped === 0);
  };

  const handleResync = () => {
    setReloadNonce((n) => n + 1);
  };

  const targetVodStartSec = useMemo(() => {
    if (!currentVideo) return 0;
    const serverNow = Date.now() + clockOffsetMs;
    const raw = Math.max(0, Math.floor((serverNow - currentVideoStartedAt) / 1000));
    return currentVideo.durationSeconds > 0 ? raw % currentVideo.durationSeconds : raw;
  }, [
    currentVideo?.id,
    currentVideo?.durationSeconds,
    currentVideoStartedAt,
    clockOffsetMs,
    reloadNonce,
  ]);

  const videoStreamUrl = useMemo(() => {
    if (!currentVideo) return '';
    if (currentVideo.twitchChannelLogin) {
      return `${apiBase}/api/hls/channel-${currentVideo.twitchChannelLogin}.m3u8`;
    }
    if (currentVideo.twitchVodId) {
      return `${apiBase}/api/hls/vod-${currentVideo.twitchVodId}.m3u8`;
    }
    return `${apiBase}/api/yt/stream/${encodeURIComponent(currentVideo.id)}`;
  }, [
    apiBase,
    currentVideo?.id,
    currentVideo?.twitchChannelLogin,
    currentVideo?.twitchVodId,
  ]);

  const positionInVideo =
    currentVideo && currentVideo.durationSeconds > 0
      ? elapsedSeconds % Math.max(1, currentVideo.durationSeconds)
      : elapsedSeconds;

  const activeChapterInfo = useMemo(
    () => getActiveChapterInfo(currentVideo?.chapters, positionInVideo),
    [currentVideo?.chapters, positionInVideo]
  );

  const nextSchedule = useMemo(() => {
    if (!currentVideo || playlist.length === 0) return null;
    const nextVid = playlist[(currentIndex + 1) % playlist.length] || currentVideo;
    const effectiveDur = Math.max(
      30,
      currentVideo.durationSeconds - getEffectiveOutroTrimSeconds(currentVideo)
    );
    const remainingSec = Math.max(0, effectiveDur - positionInVideo);
    const nextMs = Date.now() + clockOffsetMs + remainingSec * 1000;
    return {
      nextVideo: nextVid,
      nextHourLabel: formatBroadcastHour(nextMs),
    };
  }, [currentVideo, playlist, currentIndex, positionInVideo, clockOffsetMs]);

  const showOfflineSlate = activeSource === 'twitch' && !twitch.isLive;
  const currentTheme = getThemeDefinition(currentVideo?.theme);

  return (
    <div
      className={`border bg-neutral-950 rounded-2xl overflow-hidden ${
        miniMode ? 'border-white/30 shadow-2xl' : 'border-white/15'
      }`}
    >
      {/* 16:9 Cinema Broadcast Monitor (kept at identical DOM position in both full & mini modes) */}
      <div
        onMouseEnter={handleVideoMouseMove}
        onMouseMove={handleVideoMouseMove}
        onMouseLeave={handleVideoMouseLeave}
        className="relative aspect-video w-full bg-black overflow-hidden"
      >
        {activeSource === 'twitch' ? (
          showOfflineSlate ? (
            <div className="relative w-full h-full flex items-end p-5 sm:p-10">
              {!slateImgError ? (
                <img
                  src={STUDIO_SLATE_IMG}
                  alt="Régie de diffusion JLM Télévision H24 en veille"
                  referrerPolicy="no-referrer"
                  onError={() => setSlateImgError(true)}
                  className="absolute inset-0 w-full h-full object-cover grayscale"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-950 to-black" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/65 to-black/30" />

              <div className="relative z-10 max-w-xl space-y-3">
                <div className="flex items-center gap-2 text-xs text-neutral-300 font-medium">
                  <Radio className="w-4 h-4 shrink-0" />
                  <span>Chaîne Twitch jlmelenchon hors ligne</span>
                </div>
                {!miniMode && (
                  <>
                    <h2 className="text-xl sm:text-2xl font-semibold text-white">
                      En attente du prochain direct sur Twitch
                    </h2>
                    <p className="text-sm text-neutral-300 leading-relaxed">
                      Le forçage manuel sur Twitch est actif. Passez en mode Automatique ou sur la
                      Grille Vidéos pour reprendre la diffusion H24.
                    </p>
                  </>
                )}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={onSwitchToYoutube}
                    className="px-4 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Basculer sur le relais vidéos H24
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <HlsVideoStream
              manifestUrl={`${apiBase}/api/hls/live.m3u8`}
              isLive={true}
              targetStartSeconds={0}
              isMuted={isMuted}
              volume={volumePercent / 100}
              reloadKey={reloadNonce}
              onMutedChange={setIsMuted}
            />
          )
        ) : currentVideo && videoStreamUrl ? (
          <HlsVideoStream
            manifestUrl={videoStreamUrl}
            isLive={Boolean(currentVideo.twitchChannelLogin)}
            targetStartSeconds={currentVideo.twitchChannelLogin ? 0 : targetVodStartSec}
            isMuted={isMuted}
            volume={volumePercent / 100}
            reloadKey={reloadNonce}
            onMutedChange={setIsMuted}
            onDurationDetected={(dur) => onReportDuration(currentVideo.id, dur)}
            onEnded={() => onVideoEnded(currentVideo.id)}
            onStreamError={() => onVideoError(currentVideo.id)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-black text-sm text-neutral-400">
            Chargement de la grille H24...
          </div>
        )}

        {/* Compact Bottom-Right TV Promo Vignette ("À suivre...") */}
        {!showOfflineSlate && !miniMode && (
          <TvFlashBanner
            activeSource={activeSource}
            twitch={twitch}
            playlist={playlist}
            currentIndex={currentIndex}
            activeThemeFilter={activeThemeFilter}
            currentVideoStartedAt={currentVideoStartedAt}
            clockOffsetMs={clockOffsetMs}
            flashBannerTriggeredAt={flashBannerTriggeredAt}
            elevatedAboveControls={controlsVisible}
          />
        )}

        {/* Top Minimalist Monochrome Broadcast OSD (fast 150ms fade, full mode only) */}
        {!miniMode && (
          <div
            className={`absolute top-0 inset-x-0 z-10 px-6 pt-5 pb-12 bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-150 ease-out pointer-events-none ${
              controlsVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 text-xs text-neutral-200">
                <span className="px-2.5 py-1 bg-white text-black font-mono font-bold tracking-wider uppercase">
                  {activeSource === 'twitch' && twitch.isLive ? 'DIRECT' : 'JLM TV H24'}
                </span>
                <span className="text-neutral-300 font-medium">{currentTheme.label}</span>
                {activeChapterInfo && activeSource === 'youtube' && (
                  <>
                    <span aria-hidden="true" className="text-neutral-500">
                      ·
                    </span>
                    <span className="text-neutral-300 truncate max-w-xs sm:max-w-md">
                      {activeChapterInfo.current.title}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Bottom Player Overlay (full mode only) */}
        {!miniMode && (
          <div
            onMouseEnter={() => {
              isHoveringBarRef.current = true;
              clearTimers();
              setControlsVisible(true);
            }}
            onMouseLeave={() => {
              isHoveringBarRef.current = false;
            }}
            className={`absolute bottom-0 inset-x-0 z-20 px-6 pb-5 pt-14 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-150 ease-out ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            {activeSource === 'youtube' &&
              currentVideo &&
              !currentVideo.twitchChannelLogin &&
              currentVideo.durationSeconds > 0 && (
                <div className="mb-2">
                  <ChapterTimeline
                    durationSeconds={currentVideo.durationSeconds}
                    positionSeconds={positionInVideo}
                    chapters={currentVideo.chapters}
                    onSeekSeconds={onSeekSeconds}
                  />
                </div>
              )}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <button
                  type="button"
                  onClick={handleToggleMute}
                  title={isMuted ? 'Activer le son' : 'Couper le son'}
                  className={`h-10 w-10 inline-flex items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                    isMuted
                      ? 'bg-white text-black border-white hover:bg-neutral-200'
                      : 'bg-black/80 text-white border-white/20 hover:bg-white/15'
                  }`}
                >
                  {isMuted ? (
                    <VolumeX className="w-4 h-4 shrink-0" />
                  ) : (
                    <Volume2 className="w-4 h-4 shrink-0" />
                  )}
                </button>

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={isMuted ? 0 : volumePercent}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  aria-label="Volume sonore pourcent par pourcent"
                  className="mono-slider w-24 sm:w-32 cursor-pointer"
                />

                <span className="w-10 text-right text-xs font-mono tabular-nums text-neutral-200">
                  {isMuted ? 0 : volumePercent}%
                </span>

                {activeSource === 'youtube' && currentVideo && !currentVideo.twitchChannelLogin && (
                  <span className="text-xs font-mono tabular-nums text-neutral-300 pl-2 border-l border-white/15">
                    {formatTimecode(positionInVideo)} / {formatTimecode(currentVideo.durationSeconds)}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {activeSource === 'youtube' && (
                  <>
                    <button
                      type="button"
                      onClick={onPrevVideo}
                      title="Programme précédent"
                      className="h-10 inline-flex items-center gap-2 px-3.5 text-xs font-medium text-white bg-black/80 hover:bg-white/15 border border-white/20 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <SkipBack className="w-4 h-4 shrink-0" />
                      <span className="hidden sm:inline">Précédent</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (currentVideo) {
                          onSeekSeconds(positionInVideo + 300);
                        }
                      }}
                      title="Avancer de 5 minutes"
                      className="h-10 inline-flex items-center px-3.5 text-xs font-mono font-medium text-white bg-black/80 hover:bg-white/15 border border-white/20 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      +5m
                    </button>
                    <button
                      type="button"
                      onClick={onNextVideo}
                      title="Programme suivant"
                      className="h-10 inline-flex items-center gap-2 px-3.5 text-xs font-medium text-white bg-black/80 hover:bg-white/15 border border-white/20 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span className="hidden sm:inline">Suivant</span>
                      <SkipForward className="w-4 h-4 shrink-0" />
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={handleResync}
                  title="Resynchroniser sur le direct H24"
                  className="h-10 inline-flex items-center gap-2 px-3.5 text-xs font-medium text-white bg-black/80 hover:bg-white/15 border border-white/20 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4 shrink-0" />
                  <span className="hidden xl:inline">Direct</span>
                </button>

                <button
                  type="button"
                  onClick={onEnterFullScreenTv}
                  title="Plein écran TV pur"
                  className="h-10 inline-flex items-center gap-2 px-4 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Maximize2 className="w-4 h-4 shrink-0" />
                  <span>Plein écran TV</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Docked YouTube-Style Mini-Player Bar (when browsing Programmes & Grille without stopping live TV) */}
      {miniMode ? (
        <div className="px-3.5 py-2.5 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={onReturnToRegie}
            className="min-w-0 flex-1 text-left space-y-0.5 cursor-pointer group"
            title="Revenir au moniteur principal"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums text-neutral-400">
              <span className="text-white font-semibold uppercase">En direct</span>
              <span aria-hidden="true">·</span>
              <span>
                {activeSource === 'youtube' && currentVideo
                  ? formatTimecode(positionInVideo)
                  : 'Twitch'}
              </span>
            </div>
            <p className="text-xs font-semibold text-white truncate group-hover:underline">
              {activeSource === 'twitch'
                ? twitch.title
                : currentVideo?.title || 'JLM Télévision H24'}
            </p>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleMute}
              title={isMuted ? 'Activer le son' : 'Couper le son'}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                isMuted
                  ? 'bg-white text-black border-white'
                  : 'bg-neutral-900 text-white border-neutral-800 hover:bg-neutral-800'
              }`}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            {activeSource === 'youtube' && (
              <button
                type="button"
                onClick={onNextVideo}
                title="Programme suivant"
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-800 transition-colors cursor-pointer"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onReturnToRegie}
              title="Agrandir dans la régie"
              className="h-8 inline-flex items-center gap-1 px-2.5 rounded-lg bg-white hover:bg-neutral-200 text-black text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowUpLeft className="w-3.5 h-3.5 shrink-0" />
              <span>Régie</span>
            </button>
          </div>
        </div>
      ) : (
        /* Spacious Editorial Program Deck + Interactive Chapters Below Monitor */
        <div className="p-6 sm:p-7 space-y-6 bg-neutral-950">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                <span className="text-white font-semibold uppercase tracking-wider font-mono">
                  {activeSource === 'twitch' && twitch.isLive ? 'Direct Twitch' : currentTheme.label}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-neutral-300">
                  {activeSource === 'twitch'
                    ? `twitch.tv/${twitch.channelLogin}`
                    : currentVideo
                      ? `${formatTimecode(positionInVideo)} / ${formatTimecode(currentVideo.durationSeconds)}`
                      : 'Antenne H24'}
                </span>
                {nextSchedule && activeSource === 'youtube' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-neutral-300">
                      À suivre à{' '}
                      <strong className="font-mono tabular-nums text-white font-semibold">
                        {nextSchedule.nextHourLabel}
                      </strong>
                    </span>
                  </>
                )}
              </div>

              <h2 className="text-lg sm:text-xl font-semibold text-white leading-snug">
                {activeSource === 'twitch'
                  ? twitch.title
                  : currentVideo?.title || 'Chargement de la programmation...'}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={onTriggerFlashBanner}
                title="Afficher la vignette TV « À suivre » en bas à droite"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-neutral-100 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Bell className="w-3.5 h-3.5 shrink-0" />
                <span>Bandeau « À suivre »</span>
              </button>

              {activeSource === 'youtube' &&
                currentVideo &&
                currentVideo.chapters &&
                currentVideo.chapters.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setChaptersExpanded((prev) => !prev)}
                    className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      chaptersExpanded
                        ? 'bg-white text-black border-white'
                        : 'bg-neutral-900 text-neutral-200 border-neutral-800 hover:bg-neutral-800'
                    }`}
                  >
                    <ListOrdered className="w-3.5 h-3.5 shrink-0" />
                    <span>Chapitres ({currentVideo.chapters.length})</span>
                  </button>
                )}

              <a
                href={
                  activeSource === 'twitch'
                    ? `https://www.twitch.tv/${twitch.channelLogin}`
                    : currentVideo?.twitchVodId
                      ? `https://www.twitch.tv/videos/${currentVideo.twitchVodId}`
                      : `https://www.youtube.com/watch?v=${currentVideo?.id || ''}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <span>Source</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              </a>
            </div>
          </div>

          {/* Interactive Chapters Strip */}
          {activeSource === 'youtube' &&
            chaptersExpanded &&
            currentVideo &&
            currentVideo.chapters &&
            currentVideo.chapters.length > 1 && (
              <div className="pt-5 border-t border-neutral-800/90 space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs text-neutral-400">
                  <span className="font-medium text-neutral-200">
                    Chapitrage du programme — cliquez sur une séquence pour y accéder en direct
                  </span>
                  {activeChapterInfo && (
                    <span className="font-mono tabular-nums text-neutral-400">
                      Séquence {activeChapterInfo.index + 1} / {activeChapterInfo.total}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {currentVideo.chapters.map((chap, idx) => {
                    const isCurrentChap = activeChapterInfo?.index === idx;
                    return (
                      <button
                        key={`${chap.startSeconds}-${idx}`}
                        type="button"
                        onClick={() => onSeekSeconds(chap.startSeconds)}
                        className={`text-left px-4 py-3 rounded-xl border transition-colors cursor-pointer flex items-start gap-3 ${
                          isCurrentChap
                            ? 'bg-white text-black border-white'
                            : 'bg-neutral-900/60 hover:bg-neutral-900 text-neutral-200 border-neutral-800/90'
                        }`}
                      >
                        <span
                          className={`text-xs font-mono tabular-nums pt-0.5 shrink-0 ${
                            isCurrentChap ? 'text-neutral-700 font-semibold' : 'text-neutral-500'
                          }`}
                        >
                          {formatTimecode(chap.startSeconds)}
                        </span>
                        <span
                          className={`text-xs font-medium line-clamp-2 leading-snug ${
                            isCurrentChap ? 'text-black font-semibold' : 'text-neutral-200'
                          }`}
                        >
                          {chap.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
