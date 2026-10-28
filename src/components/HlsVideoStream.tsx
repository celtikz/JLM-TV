import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, VolumeX } from 'lucide-react';
import type {
  VideoQualitySetting,
  YoutubeQualityVariant,
} from '../utils/userPlayerMemory';

const ytQualitiesClientCache = new Map<string, YoutubeQualityVariant[]>();

const FALLBACK_YT_360: YoutubeQualityVariant = {
  height: 360,
  label: '360p',
  videoItag: 18,
  audioItag: null,
  fps: 30,
};

function pickYoutubeVariant(
  variants: YoutubeQualityVariant[],
  preferredQuality: VideoQualitySetting,
  excludedItags: Set<number>
): YoutubeQualityVariant {
  const usable = variants.filter((v) => !excludedItags.has(v.videoItag));
  if (usable.length === 0) return FALLBACK_YT_360;

  let targetHeight: number;
  if (preferredQuality === 'auto') {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const width = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280;
    targetHeight = width >= 768 || width * dpr >= 1280 ? 1080 : 720;
  } else {
    targetHeight = preferredQuality;
  }

  const exact = usable.find((v) => v.height === targetHeight);
  if (exact) return exact;

  const lowerOrEqual = usable
    .filter((v) => v.height <= targetHeight)
    .sort((a, b) => b.height - a.height);
  if (lowerOrEqual.length > 0) return lowerOrEqual[0];

  return usable[usable.length - 1] || FALLBACK_YT_360;
}

function findBestHlsLevelIndex(
  levels: Array<{ height: number }>,
  targetHeight: number
): number {
  if (levels.length === 0) return -1;
  let bestIdx = -1;
  let bestDiff = Infinity;

  // Prefer highest level <= targetHeight + 40
  for (let i = 0; i < levels.length; i += 1) {
    const h = levels[i].height || 0;
    if (h <= 0) continue;
    if (Math.abs(h - targetHeight) <= 45) {
      return i;
    }
    if (h <= targetHeight) {
      const diff = targetHeight - h;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
  }

  if (bestIdx >= 0) return bestIdx;

  // Otherwise pick the lowest available level
  let minIdx = 0;
  for (let i = 1; i < levels.length; i += 1) {
    if ((levels[i].height || 9999) < (levels[minIdx].height || 9999)) {
      minIdx = i;
    }
  }
  return minIdx;
}

interface HlsVideoStreamProps {
  manifestUrl: string;
  isLive: boolean;
  targetStartSeconds: number;
  isMuted: boolean;
  volume: number;
  preferredQuality?: VideoQualitySetting;
  reloadKey?: number;
  onMutedChange: (muted: boolean) => void;
  onAvailableQualitiesChange?: (qualities: number[]) => void;
  onActiveQualityChange?: (height: number | null) => void;
  onPlaybackProgress?: (positionSeconds: number, durationSeconds: number) => void;
  onDurationDetected?: (durationSeconds: number) => void;
  onEnded?: () => void;
  onStreamError?: () => void;
}

export function HlsVideoStream({
  manifestUrl,
  isLive,
  targetStartSeconds,
  isMuted,
  volume,
  preferredQuality = 'auto',
  reloadKey = 0,
  onMutedChange,
  onAvailableQualitiesChange,
  onActiveQualityChange,
  onPlaybackProgress,
  onDurationDetected,
  onEnded,
  onStreamError,
}: HlsVideoStreamProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const initialStartRef = useRef<number>(targetStartSeconds);
  const isMutedRef = useRef<boolean>(isMuted);
  const volumeRef = useRef<number>(volume);
  const preferredQualityRef = useRef<VideoQualitySetting>(preferredQuality);

  const onMutedChangeRef = useRef(onMutedChange);
  const onAvailableQualitiesChangeRef = useRef(onAvailableQualitiesChange);
  const onActiveQualityChangeRef = useRef(onActiveQualityChange);
  const onPlaybackProgressRef = useRef(onPlaybackProgress);
  const onDurationDetectedRef = useRef(onDurationDetected);
  const onEndedRef = useRef(onEnded);
  const onStreamErrorRef = useRef(onStreamError);

  initialStartRef.current = targetStartSeconds;
  isMutedRef.current = isMuted;
  volumeRef.current = volume;
  preferredQualityRef.current = preferredQuality;
  onMutedChangeRef.current = onMutedChange;
  onAvailableQualitiesChangeRef.current = onAvailableQualitiesChange;
  onActiveQualityChangeRef.current = onActiveQualityChange;
  onPlaybackProgressRef.current = onPlaybackProgress;
  onDurationDetectedRef.current = onDurationDetected;
  onEndedRef.current = onEnded;
  onStreamErrorRef.current = onStreamError;

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [needsSoundClick, setNeedsSoundClick] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const needsSoundClickRef = useRef<boolean>(false);
  needsSoundClickRef.current = needsSoundClick;

  const lastStreamIdentityRef = useRef<string>('');
  const lastPlaybackSecRef = useRef<number>(targetStartSeconds);
  const lastSavedProgressAtRef = useRef<number>(0);

  const isDirectMp4 = manifestUrl.includes('/api/yt/stream/');
  const ytVideoIdMatch = manifestUrl.match(/\/api\/yt\/stream\/([a-zA-Z0-9_-]{11})/);
  const ytVideoId = ytVideoIdMatch ? ytVideoIdMatch[1] : null;

  const [ytVariants, setYtVariants] = useState<YoutubeQualityVariant[] | null>(() =>
    ytVideoId ? ytQualitiesClientCache.get(ytVideoId) || null : null
  );
  const [failedYtItags, setFailedYtItags] = useState<number[]>([]);

  // Reset YouTube variant state when switching to a different video
  useEffect(() => {
    setFailedYtItags([]);
    if (!isDirectMp4 || !ytVideoId) {
      setYtVariants(null);
      return;
    }

    const cached = ytQualitiesClientCache.get(ytVideoId);
    if (cached) {
      setYtVariants(cached);
      onAvailableQualitiesChangeRef.current?.(cached.map((c) => c.height));
      return;
    }

    setYtVariants(null);
    let cancelled = false;
    const qualitiesUrl = manifestUrl.replace(
      `/api/yt/stream/${ytVideoId}`,
      `/api/yt/qualities/${ytVideoId}`
    );

    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 3200);

    fetch(qualitiesUrl, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { qualities?: YoutubeQualityVariant[] } | null) => {
        if (cancelled) return;
        const list =
          data?.qualities && data.qualities.length > 0
            ? data.qualities
            : [FALLBACK_YT_360];
        ytQualitiesClientCache.set(ytVideoId, list);
        setYtVariants(list);
        onAvailableQualitiesChangeRef.current?.(list.map((c) => c.height));
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = [FALLBACK_YT_360];
        setYtVariants(fallback);
        onAvailableQualitiesChangeRef.current?.([360]);
      })
      .finally(() => {
        window.clearTimeout(timer);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [isDirectMp4, ytVideoId, manifestUrl]);

  const activeYtVariant: YoutubeQualityVariant | null =
    isDirectMp4 && ytVariants
      ? pickYoutubeVariant(ytVariants, preferredQuality, new Set(failedYtItags))
      : null;

  // Report playback progress continuously & on tab hide/unload so resume position is exact
  useEffect(() => {
    if (isLive) return;
    const video = videoRef.current;
    if (!video) return;

    const flushProgress = (force: boolean) => {
      const el = videoRef.current;
      if (!el || isLive) return;
      const now = Date.now();
      if (!force && now - lastSavedProgressAtRef.current < 2500) return;
      const pos = el.currentTime;
      const dur = el.duration;
      if (Number.isFinite(pos) && pos >= 2) {
        lastPlaybackSecRef.current = pos;
      }
      if (Number.isFinite(pos) && pos >= 5 && Number.isFinite(dur) && dur > 30) {
        lastSavedProgressAtRef.current = now;
        onPlaybackProgressRef.current?.(Math.floor(pos), Math.round(dur));
      }
    };

    const onTimeUpdate = () => flushProgress(false);
    const onPauseFlush = () => flushProgress(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress(true);
      }
    };
    const onPageHide = () => flushProgress(true);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('pause', onPauseFlush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);

    return () => {
      flushProgress(true);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('pause', onPauseFlush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, [manifestUrl, isLive]);

  // Main YouTube MP4 (Muxed or Adaptive HD Video + Audio) Playback Pipeline
  useEffect(() => {
    if (!isDirectMp4) return;
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !manifestUrl || !activeYtVariant) return;

    const streamIdentity = `${manifestUrl}#${reloadKey}`;
    const isQualitySwitchOnSameStream =
      lastStreamIdentityRef.current === streamIdentity && lastPlaybackSecRef.current > 1;
    const desiredStartSec = isQualitySwitchOnSameStream
      ? lastPlaybackSecRef.current
      : initialStartRef.current;
    lastStreamIdentityRef.current = streamIdentity;

    setIsLoading(true);
    setIsPaused(false);
    let destroyed = false;
    let autoplayAttempted = false;
    let mp4Retries = 0;
    let retryTimer: number | null = null;
    let syncInterval: number | null = null;

    const hasSeparateAudio = activeYtVariant.audioItag !== null;
    const sep = manifestUrl.includes('?') ? '&' : '?';
    const videoSrc = `${manifestUrl}${sep}itag=${activeYtVariant.videoItag}`;
    const audioSrc = hasSeparateAudio
      ? `${manifestUrl}${sep}itag=${activeYtVariant.audioItag}`
      : '';

    onActiveQualityChangeRef.current?.(activeYtVariant.height);

    const startPlaybackWhenReady = async () => {
      if (destroyed || autoplayAttempted || !videoRef.current) return;
      autoplayAttempted = true;
      const vEl = videoRef.current;
      const aEl = audioRef.current;
      const targetVol = Math.max(0, Math.min(1, volumeRef.current));

      if (hasSeparateAudio && aEl) {
        vEl.muted = true;
        try {
          await vEl.play();
          if (!destroyed) setIsPaused(false);
        } catch {
          if (!destroyed) setIsPaused(true);
          return;
        }

        if (isMutedRef.current) {
          aEl.muted = true;
          aEl.volume = targetVol;
          setNeedsSoundClick(false);
          return;
        }

        aEl.volume = targetVol;
        aEl.muted = false;
        if (Math.abs(aEl.currentTime - vEl.currentTime) > 0.25) {
          aEl.currentTime = vEl.currentTime;
        }
        try {
          await aEl.play();
          if (!destroyed) setNeedsSoundClick(false);
        } catch {
          // Browser autoplay policy requires 1 user click before unmuting audio; keep user's saved volume intact!
          aEl.muted = true;
          aEl.pause();
          if (!destroyed) setNeedsSoundClick(true);
        }
        return;
      }

      // Muxed 360p stream (itag=18)
      vEl.volume = targetVol;
      if (!isMutedRef.current) {
        vEl.muted = false;
        try {
          await vEl.play();
          if (!destroyed) {
            setNeedsSoundClick(false);
            setIsPaused(false);
          }
          return;
        } catch {
          // Autoplay blocked with sound -> start muted locally without overwriting user's saved setting
        }
      }

      if (destroyed || !videoRef.current) return;
      vEl.muted = true;
      if (!isMutedRef.current) {
        setNeedsSoundClick(true);
      }
      try {
        await vEl.play();
        if (!destroyed) setIsPaused(false);
      } catch {
        if (!destroyed) setIsPaused(true);
      }
    };

    const onMediaReady = () => {
      if (destroyed) return;
      if (videoRef.current && videoRef.current.videoHeight > 0) {
        onActiveQualityChangeRef.current?.(videoRef.current.videoHeight);
      }
      setIsLoading(false);
      void startPlaybackWhenReady();
    };

    const handleLoadedMetadata = () => {
      if (destroyed || !videoRef.current) return;
      const dur = videoRef.current.duration;
      if (Number.isFinite(dur) && dur > 10) {
        onDurationDetectedRef.current?.(Math.round(dur));
      }
      if (videoRef.current.videoHeight > 0) {
        onActiveQualityChangeRef.current?.(videoRef.current.videoHeight);
      }
      if (!isLive && desiredStartSec > 1) {
        const maxSeek = Number.isFinite(dur) && dur > 8 ? dur - 5 : desiredStartSec;
        const clamped = Math.max(0, Math.min(desiredStartSec, maxSeek));
        videoRef.current.currentTime = clamped;
        if (hasSeparateAudio && audioRef.current && audioRef.current.readyState >= 1) {
          audioRef.current.currentTime = clamped;
        }
      }
    };

    const handleAudioLoadedMetadata = () => {
      if (destroyed || !hasSeparateAudio || !audioRef.current || !videoRef.current) return;
      const targetTime =
        videoRef.current.currentTime > 0.5 ? videoRef.current.currentTime : desiredStartSec;
      if (targetTime > 0.5) {
        audioRef.current.currentTime = targetTime;
      }
    };

    const handleVideoElementError = () => {
      if (destroyed || !videoRef.current) return;
      if (mp4Retries < 1) {
        mp4Retries += 1;
        retryTimer = window.setTimeout(() => {
          if (destroyed || !videoRef.current) return;
          videoRef.current.src = `${videoSrc}&r=${mp4Retries}`;
          videoRef.current.load();
        }, 700);
      } else if (activeYtVariant.videoItag !== 18) {
        // Gracefully step down to next available lower quality instead of dropping the broadcast
        setFailedYtItags((prev) =>
          prev.includes(activeYtVariant.videoItag)
            ? prev
            : [...prev, activeYtVariant.videoItag]
        );
      } else {
        onStreamErrorRef.current?.();
      }
    };

    const syncAudioToVideoNow = () => {
      if (!hasSeparateAudio || !audioRef.current || !videoRef.current) return;
      if (Math.abs(audioRef.current.currentTime - videoRef.current.currentTime) > 0.2) {
        audioRef.current.currentTime = videoRef.current.currentTime;
      }
    };

    const handleVideoWaitingOrPause = () => {
      if (hasSeparateAudio && audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
    };

    const handleVideoPlaying = () => {
      if (
        hasSeparateAudio &&
        audioRef.current &&
        !isMutedRef.current &&
        !needsSoundClickRef.current
      ) {
        syncAudioToVideoNow();
        if (audioRef.current.paused) {
          void audioRef.current.play().catch(() => {});
        }
      }
    };

    video.preload = 'auto';
    video.muted = hasSeparateAudio ? true : isMutedRef.current;
    video.addEventListener('canplay', onMediaReady);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleVideoElementError);
    video.addEventListener('seeking', syncAudioToVideoNow);
    video.addEventListener('seeked', syncAudioToVideoNow);
    video.addEventListener('waiting', handleVideoWaitingOrPause);
    video.addEventListener('pause', handleVideoWaitingOrPause);
    video.addEventListener('playing', handleVideoPlaying);

    if (hasSeparateAudio && audio) {
      audio.preload = 'auto';
      audio.volume = Math.max(0, Math.min(1, volumeRef.current));
      audio.muted = isMutedRef.current;
      audio.addEventListener('loadedmetadata', handleAudioLoadedMetadata);
      audio.src = audioSrc;
      audio.load();

      syncInterval = window.setInterval(() => {
        const vEl = videoRef.current;
        const aEl = audioRef.current;
        if (!vEl || !aEl || destroyed) return;

        if (vEl.paused || vEl.seeking || vEl.ended || vEl.readyState < 2) {
          if (!aEl.paused) aEl.pause();
          return;
        }

        if (isMutedRef.current || needsSoundClickRef.current) {
          if (!aEl.paused) aEl.pause();
          return;
        }

        aEl.volume = Math.max(0, Math.min(1, volumeRef.current));
        aEl.muted = false;

        if (aEl.paused && aEl.readyState >= 2) {
          aEl.currentTime = vEl.currentTime;
          void aEl.play().catch(() => {
            setNeedsSoundClick(true);
          });
          return;
        }

        if (!aEl.paused) {
          const drift = aEl.currentTime - vEl.currentTime;
          if (Math.abs(drift) > 0.22) {
            aEl.currentTime = vEl.currentTime;
            aEl.playbackRate = 1;
          } else if (Math.abs(drift) > 0.06) {
            aEl.playbackRate = drift > 0 ? 0.985 : 1.015;
          } else if (aEl.playbackRate !== 1) {
            aEl.playbackRate = 1;
          }
        }
      }, 350);
    } else if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    video.src = videoSrc;
    video.load();

    return () => {
      destroyed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (syncInterval) window.clearInterval(syncInterval);
      if (video.currentTime > 1) {
        lastPlaybackSecRef.current = video.currentTime;
      }
      video.removeEventListener('canplay', onMediaReady);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleVideoElementError);
      video.removeEventListener('seeking', syncAudioToVideoNow);
      video.removeEventListener('seeked', syncAudioToVideoNow);
      video.removeEventListener('waiting', handleVideoWaitingOrPause);
      video.removeEventListener('pause', handleVideoWaitingOrPause);
      video.removeEventListener('playing', handleVideoPlaying);
      video.removeAttribute('src');
      video.load();

      if (audio) {
        audio.removeEventListener('loadedmetadata', handleAudioLoadedMetadata);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, [
    isDirectMp4,
    manifestUrl,
    isLive,
    reloadKey,
    activeYtVariant?.videoItag,
    activeYtVariant?.audioItag,
  ]);

  // Main HLS (Twitch Live & VOD) Playback Pipeline
  useEffect(() => {
    if (isDirectMp4) return;
    const video = videoRef.current;
    if (!video || !manifestUrl) return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }

    setIsLoading(true);
    setIsPaused(false);
    onActiveQualityChangeRef.current?.(null);
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
      if (!isMutedRef.current) {
        setNeedsSoundClick(true);
      }
      try {
        await el.play();
        if (!destroyed) setIsPaused(false);
      } catch {
        if (!destroyed) setIsPaused(true);
      }
    };

    const onMediaReady = () => {
      if (destroyed) return;
      if (videoRef.current && videoRef.current.videoHeight > 0) {
        onActiveQualityChangeRef.current?.(videoRef.current.videoHeight);
      }
      setIsLoading(false);
      void startPlaybackWhenReady();
    };

    const onVideoResize = () => {
      if (!destroyed && videoRef.current && videoRef.current.videoHeight > 0) {
        onActiveQualityChangeRef.current?.(videoRef.current.videoHeight);
      }
    };

    video.addEventListener('canplay', onMediaReady);
    video.addEventListener('resize', onVideoResize);

    if (Hls.isSupported()) {
      const startPos = isLive ? -1 : Math.max(0, initialStartRef.current);
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: isLive,
        autoStartLoad: false,
        startPosition: startPos,
        capLevelToPlayerSize: false,
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
        const uniqueHeights = Array.from(
          new Set(
            data.levels
              .map((lvl) => lvl.height || 0)
              .filter((h) => h >= 240)
          )
        ).sort((a, b) => b - a);
        onAvailableQualitiesChangeRef.current?.(uniqueHeights);

        const pref = preferredQualityRef.current;
        if (pref === 'auto') {
          const hdStartIdx = findBestHlsLevelIndex(data.levels, 720);
          if (hdStartIdx >= 0) {
            hls.startLevel = hdStartIdx;
          }
          hls.currentLevel = -1;
        } else {
          const targetIdx = findBestHlsLevelIndex(data.levels, pref);
          if (targetIdx >= 0) {
            hls.startLevel = targetIdx;
            hls.currentLevel = targetIdx;
          }
        }

        const desiredStart = isLive ? -1 : Math.max(0, initialStartRef.current);
        hls.startLoad(desiredStart);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        if (destroyed) return;
        const lvl = hls.levels[data.level];
        if (lvl && lvl.height > 0) {
          onActiveQualityChangeRef.current?.(lvl.height);
        }
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (destroyed || !videoRef.current) return;
        const el = videoRef.current;
        if (!isLive && el.buffered.length > 0) {
          const bufStart = el.buffered.start(0);
          const bufEnd = el.buffered.end(el.buffered.length - 1);
          if (el.currentTime < bufStart - 0.5 || el.currentTime > bufEnd + 1) {
            el.currentTime = Math.max(
              bufStart + 0.05,
              Math.min(bufEnd - 0.1, initialStartRef.current)
            );
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
        video.removeEventListener('resize', onVideoResize);
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
        video.removeEventListener('resize', onVideoResize);
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeAttribute('src');
        video.load();
      };
    }

    return () => {
      destroyed = true;
      video.removeEventListener('canplay', onMediaReady);
      video.removeEventListener('resize', onVideoResize);
    };
  }, [isDirectMp4, manifestUrl, isLive, reloadKey]);

  // Dynamic HLS Quality Level Switch (Instantaneous without stream reload)
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls || isDirectMp4 || hls.levels.length === 0) return;
    if (preferredQuality === 'auto') {
      hls.currentLevel = -1;
    } else {
      const idx = findBestHlsLevelIndex(hls.levels, preferredQuality);
      if (idx >= 0) {
        hls.currentLevel = idx;
      }
    }
  }, [preferredQuality, isDirectMp4]);

  // Synchronize external seeks (timeline scrub / chapter click / resync)
  useEffect(() => {
    if (isLive) return;
    const el = videoRef.current;
    if (!el || el.readyState < 1) return;
    if (Math.abs(el.currentTime - targetStartSeconds) > 3) {
      const clamped = Math.max(0, targetStartSeconds);
      el.currentTime = clamped;
      lastPlaybackSecRef.current = clamped;
      if (audioRef.current && audioRef.current.readyState >= 1) {
        audioRef.current.currentTime = clamped;
      }
      if (el.paused) {
        void el.play().catch(() => {});
      }
    }
  }, [targetStartSeconds, isLive]);

  // Synchronize user's exact local volume & mute settings
  useEffect(() => {
    const vEl = videoRef.current;
    const aEl = audioRef.current;
    if (!vEl) return;

    const clampedVolume = Math.max(0, Math.min(1, volume));
    const hasSeparateAudio = Boolean(isDirectMp4 && activeYtVariant?.audioItag);

    if (hasSeparateAudio) {
      vEl.muted = true;
      if (aEl) {
        aEl.volume = clampedVolume;
        aEl.muted = isMuted || needsSoundClick;
        if (!isMuted && !needsSoundClick && !vEl.paused && aEl.paused && aEl.readyState >= 2) {
          aEl.currentTime = vEl.currentTime;
          void aEl.play().catch(() => {});
        }
        if (isMuted && !aEl.paused) {
          aEl.pause();
        }
      }
    } else {
      vEl.volume = clampedVolume;
      vEl.muted = isMuted || needsSoundClick;
    }

    if (!isMuted && vEl.paused && vEl.readyState >= 2 && !needsSoundClick) {
      void vEl.play().catch(() => {});
    }
  }, [isMuted, volume, needsSoundClick, isDirectMp4, activeYtVariant?.audioItag]);

  const handleUnmuteOrPlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const vEl = videoRef.current;
    const aEl = audioRef.current;
    if (!vEl) return;

    const restoredVol = volume > 0 ? Math.max(0, Math.min(1, volume)) : 0.5;
    const hasSeparateAudio = Boolean(isDirectMp4 && activeYtVariant?.audioItag);

    onMutedChangeRef.current(false);
    setNeedsSoundClick(false);
    setIsPaused(false);

    if (hasSeparateAudio && aEl) {
      vEl.muted = true;
      void vEl.play().catch(() => {});
      aEl.volume = restoredVol;
      aEl.muted = false;
      aEl.currentTime = vEl.currentTime;
      void aEl.play().catch(() => {
        aEl.muted = true;
        setNeedsSoundClick(true);
      });
      return;
    }

    vEl.muted = false;
    vEl.volume = restoredVol;
    void vEl.play().catch(() => {
      vEl.muted = true;
      setNeedsSoundClick(true);
      void vEl.play().catch(() => {});
    });
  };

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      <video
        ref={videoRef}
        playsInline
        onClick={isMuted || needsSoundClick || isPaused ? handleUnmuteOrPlayClick : undefined}
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

      <audio ref={audioRef} className="hidden" />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black pointer-events-none">
          <div className="px-5 py-3 rounded-xl bg-neutral-950/95 border border-white/15 text-xs text-neutral-200 font-medium tracking-wide">
            Synchronisation du signal TV...
          </div>
        </div>
      )}

      {!isLoading && isPaused && (
        <button
          type="button"
          onClick={handleUnmuteOrPlayClick}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 cursor-pointer"
        >
          <span className="inline-flex items-center gap-3 px-6 py-3.5 rounded-xl bg-white hover:bg-neutral-200 text-black text-sm font-semibold shadow-2xl transition-colors">
            <Play className="w-4 h-4 fill-current shrink-0" />
            <span>Lancer la lecture TV</span>
          </span>
        </button>
      )}

      {(isMuted || needsSoundClick) && !isLoading && !isPaused && (
        <button
          type="button"
          onClick={handleUnmuteOrPlayClick}
          className="absolute top-6 right-6 z-20 inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs sm:text-sm font-semibold shadow-2xl transition-transform active:scale-95 cursor-pointer"
        >
          <VolumeX className="w-4 h-4 shrink-0" />
          <span>Activer le son</span>
        </button>
      )}
    </div>
  );
}
