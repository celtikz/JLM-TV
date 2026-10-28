import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Settings } from 'lucide-react';
import type { VideoQualitySetting } from '../utils/userPlayerMemory';

interface VideoQualityControlProps {
  preferredQuality: VideoQualitySetting;
  availableQualities: number[];
  activeQualityHeight: number | null;
  onSelectQuality: (quality: VideoQualitySetting) => void;
  onMenuOpenChange?: (open: boolean) => void;
}

const STANDARD_TIERS: Array<1080 | 720 | 480 | 360> = [1080, 720, 480, 360];

function normalizeTierHeight(height: number): 1080 | 720 | 480 | 360 | null {
  if (height >= 960) return 1080;
  if (height >= 640) return 720;
  if (height >= 420) return 480;
  if (height >= 240) return 360;
  return null;
}

export function VideoQualityControl({
  preferredQuality,
  availableQualities,
  activeQualityHeight,
  onSelectQuality,
  onMenuOpenChange,
}: VideoQualityControlProps) {
  const [open, setOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onMenuOpenChangeRef = useRef(onMenuOpenChange);
  onMenuOpenChangeRef.current = onMenuOpenChange;

  const setMenuOpen = (next: boolean) => {
    setOpen(next);
    onMenuOpenChangeRef.current?.(next);
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      onMenuOpenChangeRef.current?.(false);
    };
  }, []);

  const displayedTiers = useMemo(() => {
    if (!availableQualities || availableQualities.length === 0) {
      return STANDARD_TIERS;
    }
    const present = new Set<1080 | 720 | 480 | 360>();
    for (const h of availableQualities) {
      const tier = normalizeTierHeight(h);
      if (tier) present.add(tier);
    }
    const list = STANDARD_TIERS.filter((t) => present.has(t));
    return list.length > 0 ? list : STANDARD_TIERS;
  }, [availableQualities]);

  const normalizedActiveTier = activeQualityHeight
    ? normalizeTierHeight(activeQualityHeight) || activeQualityHeight
    : null;

  const buttonLabel = useMemo(() => {
    if (preferredQuality === 'auto') {
      return normalizedActiveTier ? `Auto · ${normalizedActiveTier}p` : 'Auto';
    }
    if (normalizedActiveTier && normalizedActiveTier !== preferredQuality) {
      return `${normalizedActiveTier}p`;
    }
    return `${preferredQuality}p`;
  }, [preferredQuality, normalizedActiveTier]);

  const isHdActive =
    (normalizedActiveTier !== null && normalizedActiveTier >= 720) ||
    (normalizedActiveTier === null &&
      typeof preferredQuality === 'number' &&
      preferredQuality >= 720);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!open);
        }}
        title="Changer la qualité vidéo (uniquement sur votre écran)"
        aria-expanded={open}
        aria-haspopup="menu"
        className={`h-8 inline-flex items-center gap-1.5 px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          open
            ? 'bg-white text-black border-white font-semibold'
            : 'bg-black/85 text-white border-white/20 hover:bg-white/15'
        }`}
      >
        <Settings className="w-3.5 h-3.5 shrink-0" />
        <span className="font-mono tabular-nums text-[11px]">{buttonLabel}</span>
        {isHdActive && (
          <span
            className={`text-[9px] font-mono font-bold tracking-wider uppercase ${
              open ? 'text-neutral-700' : 'text-neutral-300'
            }`}
          >
            HD
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-full right-0 mb-2 w-56 rounded-xl bg-neutral-950/98 backdrop-blur-xl border border-white/20 shadow-2xl py-1.5 z-50 text-left"
        >
          <div className="px-3.5 py-2 border-b border-white/10 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-white">Qualité vidéo</span>
            <span className="text-[10px] text-neutral-400">Votre écran seul</span>
          </div>

          <div className="py-1">
            {displayedTiers.map((tier) => {
              const selected = preferredQuality === tier;
              const isHd = tier >= 720;
              return (
                <button
                  key={tier}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onSelectQuality(tier);
                    setMenuOpen(false);
                  }}
                  className={`w-full px-3.5 py-2 flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                    selected
                      ? 'bg-white/12 text-white font-semibold'
                      : 'text-neutral-200 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <span className="w-3.5 h-3.5 inline-flex items-center justify-center shrink-0">
                      {selected && <Check className="w-3.5 h-3.5 text-white" />}
                    </span>
                    <span className="font-mono tabular-nums">{tier}p</span>
                  </span>
                  {isHd && (
                    <span className="text-[10px] font-mono font-bold tracking-wider text-neutral-400 uppercase">
                      HD
                    </span>
                  )}
                </button>
              );
            })}

            <div className="my-1 border-t border-white/10" />

            <button
              type="button"
              role="menuitemradio"
              aria-checked={preferredQuality === 'auto'}
              onClick={() => {
                onSelectQuality('auto');
                setMenuOpen(false);
              }}
              className={`w-full px-3.5 py-2 flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                preferredQuality === 'auto'
                  ? 'bg-white/12 text-white font-semibold'
                  : 'text-neutral-200 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <span className="w-3.5 h-3.5 inline-flex items-center justify-center shrink-0">
                  {preferredQuality === 'auto' && <Check className="w-3.5 h-3.5 text-white" />}
                </span>
                <span>Auto</span>
              </span>
              {normalizedActiveTier && (
                <span className="text-[11px] font-mono tabular-nums text-neutral-400">
                  {normalizedActiveTier}p
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
