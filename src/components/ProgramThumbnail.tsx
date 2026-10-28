import { useEffect, useMemo, useState } from 'react';
import { Play, Tv } from 'lucide-react';
import { isRunningInDiscordProxy } from '../hooks/useDiscordActivity';
import { formatTimecode } from '../utils/programMetadata';

interface ProgramThumbnailProps {
  videoId?: string;
  thumbnailUrl?: string;
  title: string;
  durationSeconds?: number;
  isCurrent?: boolean;
  isQueuedNext?: boolean;
  showHoverPlay?: boolean;
  className?: string;
}

export function resolveProxiedThumbnailUrl(
  videoId?: string,
  thumbnailUrl?: string
): string {
  const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';
  if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return `${apiBase}/api/tv/thumb?yt=${encodeURIComponent(videoId)}`;
  }
  const trimmed = (thumbnailUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  return `${apiBase}/api/tv/thumb?u=${encodeURIComponent(trimmed)}`;
}

export function ProgramThumbnail({
  videoId,
  thumbnailUrl,
  title,
  durationSeconds,
  isCurrent = false,
  isQueuedNext = false,
  showHoverPlay = true,
  className = '',
}: ProgramThumbnailProps) {
  const [imgError, setImgError] = useState<boolean>(false);

  const resolvedSrc = useMemo(
    () => resolveProxiedThumbnailUrl(videoId, thumbnailUrl),
    [videoId, thumbnailUrl]
  );

  useEffect(() => {
    setImgError(false);
  }, [resolvedSrc]);

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden bg-neutral-900 select-none ${className}`}
    >
      {resolvedSrc && !imgError ? (
        <img
          src={resolvedSrc}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03]"
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-neutral-800 via-neutral-900 to-black flex flex-col items-center justify-center gap-1.5 p-3 text-center">
          <Tv className="w-5 h-5 text-neutral-400 shrink-0" />
          <span className="text-[10px] font-medium text-neutral-400 line-clamp-2 leading-tight">
            {title}
          </span>
        </div>
      )}

      {/* Subtle Bottom Scrim for Legible Timecode */}
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/80 via-black/25 to-transparent pointer-events-none" />

      {/* Hover Play Affordance (YouTube-style) */}
      {showHoverPlay && !isCurrent && (
        <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center pointer-events-none">
          <span className="w-9 h-9 rounded-full bg-black/85 border border-white/30 text-white flex items-center justify-center shadow-lg">
            <Play className="w-4 h-4 fill-current ml-0.5" />
          </span>
        </div>
      )}

      {/* Status Overlay (Bottom-Left) */}
      {isCurrent ? (
        <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-white text-black text-[10px] font-mono font-bold tracking-wide uppercase shadow">
          À l’antenne
        </span>
      ) : isQueuedNext ? (
        <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/90 text-white border border-white/30 text-[10px] font-mono font-semibold tracking-wide uppercase shadow">
          À suivre
        </span>
      ) : null}

      {/* Duration Overlay (Bottom-Right, YouTube-style) */}
      {typeof durationSeconds === 'number' && durationSeconds > 0 && (
        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/85 text-white text-[11px] font-mono tabular-nums font-medium leading-none shadow">
          {formatTimecode(durationSeconds)}
        </span>
      )}
    </div>
  );
}
