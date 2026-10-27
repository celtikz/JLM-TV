import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, VolumeX } from 'lucide-react';

interface HlsVideoStreamProps {
  manifestUrl: string;
  isLive: boolean;
  targetStartSeconds: number;
  isMuted: boolean;
  volume: number;
  reloadKey?: number;
  onMutedChange: (muted: boolean) => void;
  onEnded?: () => void;
  onStreamError?: () => void;
}

export function HlsVideoStream({
  manifestUrl,
  isLive,
  targetStartSeconds,
  isMuted,
  volume,
  reloadKey = 0,
  onMutedChange,
  onEnded,
  onStreamError,
}: HlsVideoStreamProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Store dynamic props and callbacks in refs so the HLS instance is NEVER recreated on parent re-renders
  const initialStartRef = useRef<number>(targetStartSeconds);
  const isMutedRef = useRef<boolean>(isMuted);
  const volumeRef = useRef<number>(volume);
  const onMutedChangeRef = useRef(onMutedChange);
  const onEndedRef = useRef(onEnded);
  const onStreamErrorRef = useRef(onStreamError);

  initialStartRef.current = targetStartSeconds;
  isMutedRef.current = isMuted;
  volumeRef.current = volume;
  onMutedChangeRef.current = onMutedChange;
  onEndedRef.current = onEnded;
  onStreamErrorRef.current = onStreamError;

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [needsSoundClick, setNeedsSoundClick] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !manifestUrl) return;

    setIsLoading(true);
    setIsPaused(false);
    let destroyed = false;
    let autoplayAttempted = false;

    const startPlaybackWhenReady = async () => {
      if (destroyed || autoplayAttempted || !videoRef.current) return;
      autoplayAttempted = true;
      const el = videoRef.current;
      el.volume = Math.max(0, Math.min(1, volumeRef.current));

      if (!isMutedRef.current) {
        el.muted = false;
        try {
          await el.play();
          if (!destroyed) {
            setNeedsSoundClick(false);
            setIsPaused(false);
          }
          return;
        } catch {
          // Browser/Discord autoplay policy requires muted start until user clicks once
        }
      }

      if (destroyed || !videoRef.current) return;
      el.muted = true;
      onMutedChangeRef.current(true);
      setNeedsSoundClick(true);
      try {
        await el.play();
        if (!destroyed) setIsPaused(false);
      } catch {
        if (!destroyed) setIsPaused(true);
      }
    };

    const onMediaReady = () => {
      if (destroyed) return;
      setIsLoading(false);
      void startPlaybackWhenReady();
    };

    video.addEventListener('canplay', onMediaReady);

    if (Hls.isSupported()) {
      const startPos = isLive ? -1 : Math.max(0, initialStartRef.current);
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: isLive,
        autoStartLoad: false,
        startPosition: startPos,
        capLevelToPlayerSize: true,
        maxBufferLength: 25,
        maxMaxBufferLength: 45,
      });
      hlsRef.current = hls;

      hls.attachMedia(video);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (destroyed) return;
        hls.loadSource(manifestUrl);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (destroyed) return;
        // Start on 480p (~1.1 MB segment) for sub-second first frame via proxy, then ABR scales up to HD automatically
        const fastIdx = data.levels.findIndex(
          (lvl) => lvl.height >= 440 && lvl.height <= 540
        );
        const hdIdx = data.levels.findIndex(
          (lvl) => lvl.height >= 700 && lvl.height <= 760
        );
        if (fastIdx >= 0) {
          hls.startLevel = fastIdx;
        } else if (hdIdx >= 0) {
          hls.startLevel = hdIdx;
        }

        const desiredStart = isLive ? -1 : Math.max(0, initialStartRef.current);
        hls.startLoad(desiredStart);
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (destroyed || !videoRef.current) return;
        const el = videoRef.current;
        if (!isLive && el.buffered.length > 0) {
          const bufStart = el.buffered.start(0);
          const bufEnd = el.buffered.end(el.buffered.length - 1);
          if (el.currentTime < bufStart - 0.5 || el.currentTime > bufEnd + 1) {
            el.currentTime = Math.max(bufStart + 0.05, Math.min(bufEnd - 0.1, initialStartRef.current));
          }
        }
        setIsLoading(false);
        void startPlaybackWhenReady();
      });

      let networkRetries = 0;
      let mediaRetries = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (destroyed || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
          networkRetries += 1;
          window.setTimeout(() => {
            if (!destroyed) hls.startLoad();
          }, 800 * networkRetries);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
          mediaRetries += 1;
          hls.recoverMediaError();
        } else {
          hls.destroy();
          onStreamErrorRef.current?.();
        }
      });

      return () => {
        destroyed = true;
        video.removeEventListener('canplay', onMediaReady);
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
      const handleLoadedMetadata = () => {
        if (destroyed) return;
        if (!isLive && initialStartRef.current > 0) {
          video.currentTime = initialStartRef.current;
        }
      };
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      return () => {
        destroyed = true;
        video.removeEventListener('canplay', onMediaReady);
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeAttribute('src');
        video.load();
      };
    }

    return () => {
      destroyed = true;
      video.removeEventListener('canplay', onMediaReady);
    };
  }, [manifestUrl, isLive, reloadKey]);

  // Smoothly seek when targetStartSeconds jumps (e.g. +5 min button or progress bar click)
  useEffect(() => {
    if (isLive) return;
    const el = videoRef.current;
    if (!el || el.readyState < 1) return;
    if (Math.abs(el.currentTime - targetStartSeconds) > 12) {
      el.currentTime = Math.max(0, targetStartSeconds);
      if (el.paused) {
        void el.play().catch(() => {});
      }
    }
  }, [targetStartSeconds, isLive]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = isMuted;
    el.volume = Math.max(0, Math.min(1, volume));
    if (!isMuted) {
      setNeedsSoundClick(false);
      if (el.paused && el.readyState >= 2) {
        void el.play().catch(() => {});
      }
    }
  }, [isMuted, volume]);

  const handleUnmuteOrPlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = Math.max(0.25, volume);
    onMutedChangeRef.current(false);
    setNeedsSoundClick(false);
    setIsPaused(false);
    void el.play().catch(() => {
      el.muted = true;
      onMutedChangeRef.current(true);
      void el.play().catch(() => {});
    });
  };

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      <video
        ref={videoRef}
        playsInline
        onClick={isMuted || isPaused ? handleUnmuteOrPlayClick : undefined}
        onPlaying={() => {
          setIsLoading(false);
          setIsPaused(false);
        }}
        onPause={() => {
          if (!videoRef.current?.ended) {
            setIsPaused(true);
          }
        }}
        onEnded={() => {
          if (!isLive) {
            onEndedRef.current?.();
          }
        }}
        className="w-full h-full object-contain bg-black"
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black pointer-events-none">
          <div className="px-4 py-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-200 font-medium">
            Chargement du signal TV en cours...
          </div>
        </div>
      )}

      {!isLoading && isPaused && (
        <button
          type="button"
          onClick={handleUnmuteOrPlayClick}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 cursor-pointer"
        >
          <span className="inline-flex items-center gap-2.5 px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold shadow-lg">
            <Play className="w-4 h-4 fill-current shrink-0" />
            <span>Cliquer pour lancer le direct TV</span>
          </span>
        </button>
      )}

      {(isMuted || needsSoundClick) && !isLoading && !isPaused && (
        <button
          type="button"
          onClick={handleUnmuteOrPlayClick}
          className="absolute bottom-16 right-6 z-20 inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs sm:text-sm font-semibold shadow-lg transition-transform active:scale-95 cursor-pointer"
        >
          <VolumeX className="w-4 h-4 shrink-0" />
          <span>Cliquer pour activer le son</span>
        </button>
      )}
    </div>
  );
}
