import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { VolumeX } from 'lucide-react';

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
  const initialStartRef = useRef<number>(targetStartSeconds);
  const isMutedRef = useRef<boolean>(isMuted);
  const volumeRef = useRef<number>(volume);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [needsSoundClick, setNeedsSoundClick] = useState<boolean>(false);

  initialStartRef.current = targetStartSeconds;
  isMutedRef.current = isMuted;
  volumeRef.current = volume;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !manifestUrl) return;

    setIsLoading(true);
    let destroyed = false;

    const attemptAutoplay = async () => {
      if (destroyed || !videoRef.current) return;
      const el = videoRef.current;
      el.volume = Math.max(0, Math.min(1, volumeRef.current));

      if (!isMutedRef.current) {
        el.muted = false;
        try {
          await el.play();
          setNeedsSoundClick(false);
          return;
        } catch {
          // Browser autoplay policy requires muted start until user clicks once
        }
      }

      el.muted = true;
      onMutedChange(true);
      setNeedsSoundClick(true);
      try {
        await el.play();
      } catch {
        // Ignore if user hasn't interacted yet
      }
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: isLive,
        startPosition: isLive ? -1 : Math.max(0, initialStartRef.current),
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hlsRef.current = hls;

      hls.loadSource(manifestUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (destroyed) return;
        // Start on 720p (~2.8 Mbps) when available for instant smooth playback, then adapt
        const preferredIdx = data.levels.findIndex(
          (lvl) => lvl.height >= 700 && lvl.height <= 760
        );
        if (preferredIdx >= 0) {
          hls.startLevel = preferredIdx;
        }
        setIsLoading(false);
        void attemptAutoplay();
      });

      let networkRetries = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (destroyed || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 2) {
          networkRetries += 1;
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          hls.destroy();
          if (onStreamError) onStreamError();
        }
      });

      return () => {
        destroyed = true;
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
      const handleLoaded = () => {
        if (destroyed) return;
        if (!isLive && initialStartRef.current > 0) {
          video.currentTime = initialStartRef.current;
        }
        setIsLoading(false);
        void attemptAutoplay();
      };
      video.addEventListener('loadedmetadata', handleLoaded);
      return () => {
        destroyed = true;
        video.removeEventListener('loadedmetadata', handleLoaded);
        video.removeAttribute('src');
        video.load();
      };
    }
  }, [manifestUrl, isLive, reloadKey, onMutedChange, onStreamError]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = isMuted;
    el.volume = Math.max(0, Math.min(1, volume));
    if (!isMuted) {
      setNeedsSoundClick(false);
      void el.play().catch(() => {});
    }
  }, [isMuted, volume]);

  const handleUnmuteClick = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = Math.max(0.2, volume);
    onMutedChange(false);
    setNeedsSoundClick(false);
    void el.play().catch(() => {});
  };

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      <video
        ref={videoRef}
        playsInline
        autoPlay
        onClick={isMuted ? handleUnmuteClick : undefined}
        onCanPlay={() => setIsLoading(false)}
        onEnded={() => {
          if (!isLive && onEnded) onEnded();
        }}
        className="w-full h-full object-contain bg-black"
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="px-4 py-2 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-200 font-medium">
            Connexion au flux vidéo HD en cours...
          </div>
        </div>
      )}

      {(isMuted || needsSoundClick) && !isLoading && (
        <button
          type="button"
          onClick={handleUnmuteClick}
          className="absolute bottom-16 right-6 z-20 inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs sm:text-sm font-semibold shadow-lg transition-transform active:scale-95 cursor-pointer"
        >
          <VolumeX className="w-4 h-4 shrink-0" />
          <span>Cliquer pour activer le son</span>
        </button>
      )}
    </div>
  );
}
