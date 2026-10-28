import { useRef, useState } from 'react';
import type { VideoChapter } from '../types/broadcast';
import { formatTimecode, getActiveChapterInfo } from '../utils/programMetadata';

interface ChapterTimelineProps {
  durationSeconds: number;
  positionSeconds: number;
  chapters: VideoChapter[];
  onSeekSeconds: (seconds: number) => void;
}

export function ChapterTimeline({
  durationSeconds,
  positionSeconds,
  chapters,
  onSeekSeconds,
}: ChapterTimelineProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [hoverSec, setHoverSec] = useState<number | null>(null);

  if (durationSeconds <= 0) return null;

  const safePosition = Math.max(0, Math.min(durationSeconds, positionSeconds));
  const normalizedChapters: VideoChapter[] =
    chapters && chapters.length > 0
      ? chapters
      : [{ startSeconds: 0, title: 'Programme en cours' }];

  const hoveredChapter =
    hoverSec !== null ? getActiveChapterInfo(normalizedChapters, hoverSec) : null;

  const updateHover = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHoverSec(Math.round(ratio * durationSeconds));
  };

  const VIEWBOX_WIDTH = 1000;
  const GAP_UNITS = normalizedChapters.length > 1 ? 4 : 0;

  return (
    <div
      ref={barRef}
      onMouseMove={(e) => updateHover(e.clientX)}
      onMouseLeave={() => setHoverSec(null)}
      onClick={(e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onSeekSeconds(Math.round(ratio * durationSeconds));
      }}
      className="relative group py-3 cursor-pointer select-none"
      title="Cliquer pour naviguer dans les chapitres du programme"
    >
      {/* Floating Monochrome Hover Preview Bar */}
      {hoverSec !== null && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-lg bg-black/95 border border-white/25 text-xs text-white whitespace-nowrap pointer-events-none shadow-2xl flex items-center gap-2.5">
          <span className="font-mono tabular-nums font-semibold">
            {formatTimecode(hoverSec)}
          </span>
          {hoveredChapter && (
            <>
              <span aria-hidden="true" className="text-neutral-500">
                ·
              </span>
              <span className="text-neutral-200 max-w-[320px] truncate">
                Chapitre {hoveredChapter.index + 1} : {hoveredChapter.current.title}
              </span>
            </>
          )}
        </div>
      )}

      {/* Vector Chapter-Segmented Monochrome Scrubber */}
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} 12`}
        preserveAspectRatio="none"
        className="block w-full h-2 group-hover:h-3 transition-all overflow-visible"
        aria-label="Barre de progression chapitrée"
      >
        {normalizedChapters.map((chap, idx) => {
          const segStart = chap.startSeconds;
          const segEnd =
            idx + 1 < normalizedChapters.length
              ? normalizedChapters[idx + 1].startSeconds
              : durationSeconds;
          const xStart = (segStart / durationSeconds) * VIEWBOX_WIDTH;
          const xEnd = (segEnd / durationSeconds) * VIEWBOX_WIDTH;
          const rawWidth = Math.max(2, xEnd - xStart - (idx + 1 < normalizedChapters.length ? GAP_UNITS : 0));

          let fillRatio = 0;
          if (safePosition >= segEnd) {
            fillRatio = 1;
          } else if (safePosition > segStart) {
            fillRatio = (safePosition - segStart) / Math.max(1, segEnd - segStart);
          }

          return (
            <g key={`${chap.startSeconds}-${idx}`}>
              <rect
                x={xStart}
                y={0}
                width={rawWidth}
                height={12}
                rx={4}
                className="fill-white/25 group-hover:fill-white/35 transition-colors"
              />
              {fillRatio > 0 && (
                <rect
                  x={xStart}
                  y={0}
                  width={Math.max(2, rawWidth * Math.min(1, fillRatio))}
                  height={12}
                  rx={4}
                  className="fill-white"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
