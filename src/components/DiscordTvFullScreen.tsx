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
} from 'lucide-react';
import type { BroadcastMode, BroadcastState } from '../types/broadcast';
import { HlsVideoStream } from './HlsVideoStream';
import { isRunningInDiscordProxy } from '../hooks/useDiscordActivity';

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

interface DiscordTvFullScreenProps {
  broadcast: BroadcastState;
  clockOffsetMs: number;
  canExitFullScreen: boolean;
  onExitFullScreen: () => void;
  onSetMode: (mode: BroadcastMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onSelectVideo: (videoId: string) => void;
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
  onSelectVideo,
  onVideoEnded,
  onVideoError,
}: DiscordTvFullScreenProps) {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const hideTimerRef = useRef<number | null>(null);
  const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';

  const hlsCompatiblePlaylist = useMemo(
    () => broadcast.playlist.filter((v) => Boolean(v.twitchVodId)),
    [broadcast.playlist]
  );

  const activeVodItem = useMemo(() => {
    const rawCurrent = broadcast.playlist[broadcast.currentIndex];
    if (rawCurrent?.twitchVodId) return rawCurrent;
    return hlsCompatiblePlaylist[0] || null;
  }, [broadcast.playlist, broadcast.currentIndex, hlsCompatiblePlaylist]);

  const isPlayingTwitchLive =
    broadcast.activeSource === 'twitch' && broadcast.twitch.isLive;

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
    if (activeVodItem?.twitchVodId) {
      return `${apiBase}/api/hls/vod-${activeVodItem.twitchVodId}.m3u8`;
    }
    return '';
  }, [apiBase, isPlayingTwitchLive, activeVodItem?.twitchVodId]);

  const targetStartSec = useMemo(() => {
    if (isPlayingTwitchLive || !activeVodItem) return 0;
    const serverNow = Date.now() + clockOffsetMs;
    const rawElapsed = Math.max(
      0,
      Math.floor((serverNow - broadcast.currentVideoStartedAt) / 1000)
    );
    return activeVodItem.durationSeconds > 0
      ? rawElapsed % activeVodItem.durationSeconds
      : rawElapsed;
  }, [
    isPlayingTwitchLive,
    activeVodItem?.id,
    activeVodItem?.durationSeconds,
    broadcast.currentVideoStartedAt,
    clockOffsetMs,
    reloadNonce,
  ]);

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
          isLive={isPlayingTwitchLive}
          targetStartSeconds={targetStartSec}
          isMuted={isMuted}
          volume={volume}
          reloadKey={reloadNonce}
          onMutedChange={setIsMuted}
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
            <div className="flex items-center gap-2 text-xs text-slate-300">
              {isPlayingTwitchLive ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                  <Radio className="w-3.5 h-3.5 shrink-0" />
                  EN DIRECT · Twitch jlmelenchon
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Audio + Timecode */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMuted((m) => !m)}
              className="p-2 rounded-lg bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 text-white transition-colors cursor-pointer"
              title={isMuted ? 'Activer le son' : 'Couper le son'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                setIsMuted(v === 0);
              }}
              aria-label="Volume sonore"
              className="w-20 sm:w-24 accent-rose-600 cursor-pointer"
            />

            {!isPlayingTwitchLive && activeVodItem && (
              <span className="text-xs font-mono tabular-nums text-slate-300 pl-1">
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
                  onClick={onPrev}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <SkipBack className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Précédent</span>
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <span className="hidden sm:inline">Suivant</span>
                  <SkipForward className="w-3.5 h-3.5 shrink-0" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              title="Resynchroniser sur le direct"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">Direct</span>
            </button>

            <button
              type="button"
              onClick={() => setDrawerOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-rose-600/90 hover:bg-rose-500 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <ListVideo className="w-3.5 h-3.5 shrink-0" />
              <span>Programmes</span>
            </button>
          </div>
        </div>
      </div>

      {/* Compact Slide-Over Program Guide Drawer */}
      {drawerOpen && (
        <div className="absolute top-0 right-0 bottom-0 w-full max-w-sm bg-slate-950/95 border-l border-slate-800 z-30 flex flex-col">
          <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">Choix du programme TV</h2>
              <p className="text-xs text-slate-400">
                Synchronisé pour tout le salon vocal
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
              Rediffusions JLM
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
            {hlsCompatiblePlaylist.map((item, idx) => {
              const isSelected = activeVodItem?.id === item.id && !isPlayingTwitchLive;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectVideo(item.id);
                    setDrawerOpen(false);
                  }}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer ${
                    isSelected ? 'bg-slate-800/90' : 'hover:bg-slate-900'
                  }`}
                >
                  <span className="text-xs font-mono tabular-nums text-slate-500 pt-0.5 w-5 shrink-0">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-medium text-slate-100 line-clamp-2 leading-snug">
                      {item.title}
                    </p>
                    <p className="text-[11px] font-mono tabular-nums text-slate-400">
                      Durée {formatTimecode(item.durationSeconds)} ·{' '}
                      {item.views.toLocaleString('fr-FR')} vues
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
