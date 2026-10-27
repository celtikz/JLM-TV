import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  SkipForward,
  SkipBack,
  RefreshCw,
  Tv,
  Radio,
  ExternalLink,
  Maximize2,
} from 'lucide-react';
import type { ActiveSource, TwitchStatus, YouTubeVideoItem } from '../types/broadcast';
import { isRunningInDiscordProxy } from '../hooks/useDiscordActivity';
import { HlsVideoStream } from './HlsVideoStream';

const STUDIO_SLATE_IMG = '/src/assets/images/tv_broadcast_slate_1793131336238.jpg';

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

interface TvPlayerProps {
  activeSource: ActiveSource;
  twitch: TwitchStatus;
  currentVideo: YouTubeVideoItem | null;
  currentVideoStartedAt: number;
  clockOffsetMs: number;
  onPrevVideo: () => void;
  onNextVideo: () => void;
  onSeekSeconds: (seconds: number) => void;
  onSwitchToYoutube: () => void;
  onEnterFullScreenTv: () => void;
  onReportDuration: (videoId: string, durationSeconds: number) => void;
  onVideoEnded: (videoId: string) => void;
  onVideoError: (videoId: string) => void;
}

export function TvPlayer({
  activeSource,
  twitch,
  currentVideo,
  currentVideoStartedAt,
  clockOffsetMs,
  onPrevVideo,
  onNextVideo,
  onSeekSeconds,
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

  const showOfflineSlate = activeSource === 'twitch' && !twitch.isLive;

  return (
    <div className="border border-slate-800 bg-slate-900/60 rounded-xl overflow-hidden">
      {/* 16:9 Master Monitor */}
      <div className="relative aspect-video w-full bg-black overflow-hidden">
        {activeSource === 'twitch' ? (
          showOfflineSlate ? (
            <div className="relative w-full h-full flex items-end p-6 sm:p-8">
              {!slateImgError ? (
                <img
                  src={STUDIO_SLATE_IMG}
                  alt="Régie de diffusion JLM Télévision H24 en veille"
                  referrerPolicy="no-referrer"
                  onError={() => setSlateImgError(true)}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/25" />

              <div className="relative z-10 max-w-xl space-y-3">
                <div className="flex items-center gap-2 text-xs text-amber-400 font-medium">
                  <Radio className="w-4 h-4 shrink-0" />
                  <span>Chaîne Twitch jlmelenchon actuellement hors ligne</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-semibold text-white">
                  En attente du prochain direct sur Twitch
                </h2>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Le forçage manuel sur Twitch est actif. Passez en mode Automatique ou sur la
                  Grille Vidéos pour diffuser les conférences et meetings en continu.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={onSwitchToYoutube}
                    className="px-4 py-2 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
          <div className="w-full h-full flex items-center justify-center bg-black text-sm text-slate-400">
            Chargement de la grille H24...
          </div>
        )}
      </div>

      {/* Synchronized Interactive Seek Progress Bar */}
      {activeSource === 'youtube' && currentVideo && currentVideo.durationSeconds > 0 && (
        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            onSeekSeconds(Math.round(ratio * currentVideo.durationSeconds));
          }}
          className="w-full h-2 hover:h-2.5 transition-all cursor-pointer bg-slate-950 overflow-hidden"
          title="Cliquer pour avancer ou reculer dans le programme"
        >
          <progress
            value={Math.min(elapsedSeconds, currentVideo.durationSeconds)}
            max={currentVideo.durationSeconds}
            className="block w-full h-full appearance-none [&::-webkit-progress-bar]:bg-slate-950 [&::-webkit-progress-value]:bg-rose-600 hover:[&::-webkit-progress-value]:bg-rose-500 [&::-moz-progress-bar]:bg-rose-600"
          />
        </div>
      )}

      {/* Broadcast Monitor Control Strip */}
      <div className="px-5 py-4 border-t border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {activeSource === 'twitch' ? (
              <>
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                  <Radio className="w-3.5 h-3.5 shrink-0" />
                  {twitch.isLive ? 'Direct Twitch actif' : 'Canal Twitch'}
                </span>
                <span aria-hidden="true">·</span>
                <span>twitch.tv/{twitch.channelLogin}</span>
                {twitch.isLive && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      {twitch.viewersCount.toLocaleString('fr-FR')} spectateurs sur Twitch
                    </span>
                  </>
                )}
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 font-medium text-amber-400">
                  <Tv className="w-3.5 h-3.5 shrink-0" />
                  Relais TV H24
                </span>
                <span aria-hidden="true">·</span>
                <span>JEAN-LUC MÉLENCHON</span>
                {currentVideo && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      Position {formatTimecode(elapsedSeconds % Math.max(1, currentVideo.durationSeconds))} /{' '}
                      {formatTimecode(currentVideo.durationSeconds)}
                    </span>
                  </>
                )}
              </>
            )}
          </div>

          <h2 className="text-base sm:text-lg font-semibold text-slate-100 truncate">
            {activeSource === 'twitch'
              ? twitch.title
              : currentVideo?.title || 'Chargement de la programmation...'}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={handleToggleMute}
              title={isMuted ? 'Activer le son' : 'Couper le son'}
              className={`p-1 rounded transition-colors cursor-pointer ${
                isMuted
                  ? 'bg-rose-600 text-white hover:bg-rose-500'
                  : 'text-slate-200 hover:text-white'
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
              className="w-24 sm:w-28 accent-rose-600 cursor-pointer"
            />
            <span className="w-9 text-right text-xs font-mono tabular-nums text-slate-300">
              {isMuted ? 0 : volumePercent}%
            </span>
          </div>

          {activeSource === 'youtube' && (
            <>
              <button
                type="button"
                onClick={onPrevVideo}
                title="Programme précédent"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <SkipBack className="w-3.5 h-3.5 shrink-0" />
                <span>Précédent</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (currentVideo) {
                    const pos = elapsedSeconds % Math.max(1, currentVideo.durationSeconds);
                    onSeekSeconds(pos + 300);
                  }
                }}
                title="Avancer de 5 minutes"
                className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-mono font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>+5m</span>
              </button>
              <button
                type="button"
                onClick={onNextVideo}
                title="Passer à la vidéo suivante"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Suivant</span>
                <SkipForward className="w-3.5 h-3.5 shrink-0" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleResync}
            title="Resynchroniser sur le direct H24"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>Resynchroniser</span>
          </button>

          <button
            type="button"
            onClick={onEnterFullScreenTv}
            title="Afficher uniquement l’écran TV (comme dans Discord)"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5 shrink-0" />
            <span>Mode TV seul</span>
          </button>

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
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/50 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <span>Source</span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          </a>
        </div>
      </div>
    </div>
  );
}
