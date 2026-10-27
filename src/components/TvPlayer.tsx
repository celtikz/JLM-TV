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
} from 'lucide-react';
import type { ActiveSource, TwitchStatus, YouTubeVideoItem } from '../types/broadcast';
import { isRunningInDiscordProxy } from '../hooks/useDiscordActivity';

const STUDIO_SLATE_IMG = '/src/assets/images/tv_broadcast_slate_1793131336238.jpg';

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (e: { target: YTPlayerInstance }) => void;
            onStateChange?: (e: { data: number; target: YTPlayerInstance }) => void;
            onError?: (e: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState?: {
        ENDED: number;
        PLAYING: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerInstance {
  loadVideoById: (opts: { videoId: string; startSeconds?: number }) => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  playVideo: () => void;
  destroy: () => void;
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve();
    };
    const existingScript = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
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

interface TvPlayerProps {
  activeSource: ActiveSource;
  twitch: TwitchStatus;
  currentVideo: YouTubeVideoItem | null;
  currentVideoStartedAt: number;
  clockOffsetMs: number;
  onPrevVideo: () => void;
  onNextVideo: () => void;
  onSwitchToYoutube: () => void;
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
  onSwitchToYoutube,
  onReportDuration,
  onVideoEnded,
  onVideoError,
}: TvPlayerProps) {
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [showRawTwitchWhenOffline, setShowRawTwitchWhenOffline] = useState<boolean>(false);
  const [slateImgError, setSlateImgError] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const ytMountRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const currentVideoIdRef = useRef<string | null>(null);
  const targetStartRef = useRef<number>(currentVideoStartedAt);
  const clockOffsetRef = useRef<number>(clockOffsetMs);
  const isMutedRef = useRef<boolean>(isMuted);

  targetStartRef.current = currentVideoStartedAt;
  clockOffsetRef.current = clockOffsetMs;
  isMutedRef.current = isMuted;

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

  const twitchEmbedUrl = useMemo(() => {
    const parents = new Set<string>();
    if (window.location.hostname) {
      parents.add(window.location.hostname);
    }
    const ancestorList = window.location.ancestorOrigins;
    if (ancestorList) {
      for (let i = 0; i < ancestorList.length; i++) {
        try {
          const host = new URL(ancestorList[i]).hostname;
          if (host) parents.add(host);
        } catch {
          // Ignore malformed origin
        }
      }
    }
    if (document.referrer) {
      try {
        const refHost = new URL(document.referrer).hostname;
        if (refHost) parents.add(refHost);
      } catch {
        // Ignore malformed referrer
      }
    }
    parents.add('aistudio.google.com');
    parents.add('discord.com');

    const parentQuery = Array.from(parents)
      .map((p) => `parent=${encodeURIComponent(p)}`)
      .join('&');

    const baseHost = isRunningInDiscordProxy() ? '/twitch-player/' : 'https://player.twitch.tv/';
    return `${baseHost}?channel=${encodeURIComponent(
      twitch.channelLogin
    )}&autoplay=true&muted=${isMuted ? 'true' : 'false'}&${parentQuery}&_r=${reloadNonce}`;
  }, [twitch.channelLogin, isMuted, reloadNonce]);

  const inDiscordProxy = isRunningInDiscordProxy();

  useEffect(() => {
    if (inDiscordProxy || activeSource !== 'youtube' || !currentVideo) {
      if (ytPlayerRef.current) {
        ytPlayerRef.current.destroy();
        ytPlayerRef.current = null;
        currentVideoIdRef.current = null;
      }
      return;
    }

    let disposed = false;

    async function syncOrMountPlayer() {
      await loadYouTubeIframeApi();
      if (disposed || !ytMountRef.current || !window.YT || !currentVideo) return;

      const serverNow = Date.now() + clockOffsetRef.current;
      const startSec = Math.max(0, Math.floor((serverNow - targetStartRef.current) / 1000));

      if (ytPlayerRef.current) {
        if (currentVideoIdRef.current !== currentVideo.id) {
          currentVideoIdRef.current = currentVideo.id;
          ytPlayerRef.current.loadVideoById({
            videoId: currentVideo.id,
            startSeconds: startSec,
          });
        } else {
          const currentPos = ytPlayerRef.current.getCurrentTime?.() ?? 0;
          if (Math.abs(currentPos - startSec) > 5) {
            ytPlayerRef.current.seekTo(startSec, true);
          }
        }
        return;
      }

      const mountNode = document.createElement('div');
      ytMountRef.current.innerHTML = '';
      ytMountRef.current.appendChild(mountNode);
      currentVideoIdRef.current = currentVideo.id;

      ytPlayerRef.current = new window.YT.Player(mountNode, {
        videoId: currentVideo.id,
        playerVars: {
          autoplay: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          start: startSec,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            if (disposed) return;
            if (isMutedRef.current) {
              e.target.mute();
            } else {
              e.target.unMute();
            }
            e.target.playVideo();
            const dur = e.target.getDuration();
            if (dur > 0 && currentVideoIdRef.current) {
              onReportDuration(currentVideoIdRef.current, dur);
            }
          },
          onStateChange: (e) => {
            if (disposed) return;
            if (e.data === 1) {
              const dur = e.target.getDuration();
              if (dur > 0 && currentVideoIdRef.current) {
                onReportDuration(currentVideoIdRef.current, dur);
              }
            }
            if (e.data === 0 && currentVideoIdRef.current) {
              onVideoEnded(currentVideoIdRef.current);
            }
          },
          onError: () => {
            if (!disposed && currentVideoIdRef.current) {
              onVideoError(currentVideoIdRef.current);
            }
          },
        },
      });
    }

    void syncOrMountPlayer();

    return () => {
      disposed = true;
    };
  }, [
    activeSource,
    currentVideo?.id,
    currentVideoStartedAt,
    reloadNonce,
    onReportDuration,
    onVideoEnded,
    onVideoError,
  ]);

  useEffect(() => {
    return () => {
      if (ytPlayerRef.current) {
        ytPlayerRef.current.destroy();
        ytPlayerRef.current = null;
      }
    };
  }, []);

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (activeSource === 'youtube' && ytPlayerRef.current) {
      if (nextMuted) {
        ytPlayerRef.current.mute();
      } else {
        ytPlayerRef.current.unMute();
        ytPlayerRef.current.playVideo();
      }
    }
  };

  const handleResync = () => {
    if (activeSource === 'youtube' && ytPlayerRef.current) {
      const serverNow = Date.now() + clockOffsetMs;
      const startSec = Math.max(0, Math.floor((serverNow - currentVideoStartedAt) / 1000));
      ytPlayerRef.current.seekTo(startSec, true);
      ytPlayerRef.current.playVideo();
    } else {
      setReloadNonce((n) => n + 1);
    }
  };

  const showOfflineSlate =
    activeSource === 'twitch' && !twitch.isLive && !showRawTwitchWhenOffline;

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
                  Grille YouTube pour diffuser les conférences et interventions en continu.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={onSwitchToYoutube}
                    className="px-4 py-2 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Basculer sur le relais YouTube
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRawTwitchWhenOffline(true)}
                    className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800/90 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Afficher le lecteur Twitch
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <iframe
              key={twitchEmbedUrl}
              src={twitchEmbedUrl}
              title={`Direct Twitch ${twitch.displayName}`}
              className="w-full h-full border-0"
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          )
        ) : inDiscordProxy && currentVideo ? (
          <iframe
            key={`${currentVideo.id}-${isMuted}-${reloadNonce}`}
            src={`/youtube-embed/embed/${encodeURIComponent(currentVideo.id)}?autoplay=1&mute=${
              isMuted ? 1 : 0
            }&start=${Math.max(
              0,
              Math.floor((Date.now() + clockOffsetMs - currentVideoStartedAt) / 1000)
            )}&playsinline=1&rel=0`}
            title={currentVideo.title}
            className="w-full h-full border-0"
            allow="autoplay; fullscreen"
            allowFullScreen
          />
        ) : (
          <div
            ref={ytMountRef}
            className="w-full h-full [&>div]:w-full [&>div]:h-full [&_iframe]:w-full [&_iframe]:h-full [&_iframe]:border-0"
          />
        )}
      </div>

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
                  Relais TV YouTube H24
                </span>
                <span aria-hidden="true">·</span>
                <span>JEAN-LUC MÉLENCHON</span>
                {currentVideo && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      Position {formatTimecode(elapsedSeconds)} /{' '}
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
              : currentVideo?.title || 'Chargement de la programmation YouTube...'}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleMute}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isMuted
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
            }`}
          >
            {isMuted ? (
              <>
                <VolumeX className="w-4 h-4 shrink-0" />
                <span>Activer le son</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 shrink-0" />
                <span>Son actif</span>
              </>
            )}
          </button>

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

          <a
            href={
              activeSource === 'twitch'
                ? `https://www.twitch.tv/${twitch.channelLogin}`
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
