import { useEffect, useMemo, useState } from 'react';
import { Clock, Tv, X } from 'lucide-react';
import type {
  ActiveSource,
  ProgramTheme,
  TwitchStatus,
  YouTubeVideoItem,
} from '../types/broadcast';
import { isRunningInDiscordProxy } from '../hooks/useDiscordActivity';
import {
  formatBroadcastHour,
  getEffectiveOutroTrimSeconds,
  getThemeDefinition,
} from '../utils/programMetadata';
import {
  computeProgrammingFlashCycleKey,
  getSynchronizedSlot15,
} from '../utils/bannerSync';

const MELENCHON_CUTOUT_PATH =
  '/assets/aistudio/M_lenchon_2027_-_55262255527_189f44be.png';

interface TvFlashBannerProps {
  activeSource: ActiveSource;
  twitch: TwitchStatus;
  playlist: YouTubeVideoItem[];
  currentIndex: number;
  activeThemeFilter: ProgramTheme | 'all';
  currentVideoStartedAt: number;
  clockOffsetMs: number;
  flashBannerTriggeredAt: number;
  elevatedAboveControls: boolean;
  suppressed?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export function TvFlashBanner({
  activeSource,
  twitch,
  playlist,
  currentIndex,
  activeThemeFilter,
  currentVideoStartedAt,
  clockOffsetMs,
  flashBannerTriggeredAt,
  elevatedAboveControls,
  suppressed = false,
  onVisibilityChange,
}: TvFlashBannerProps) {
  const [serverNowMs, setServerNowMs] = useState<number>(() => Date.now() + clockOffsetMs);
  const [dismissedCycleKey, setDismissedCycleKey] = useState<string | null>(null);
  const [welcomeSlot15, setWelcomeSlot15] = useState<number | null>(() =>
    getSynchronizedSlot15(Date.now() + clockOffsetMs) + 1
  );
  const [cutoutError, setCutoutError] = useState<boolean>(false);

  const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';
  const portraitSrc = `${apiBase}${MELENCHON_CUTOUT_PATH}`;

  // Fast 250ms tick keeps the TV schedule card in exact 15s lockstep with the left banners
  useEffect(() => {
    const id = window.setInterval(() => {
      setServerNowMs(Date.now() + clockOffsetMs);
    }, 250);
    return () => window.clearInterval(id);
  }, [clockOffsetMs]);

  // Schedule 1 synchronized 15s welcome slot aligned to the next 15s switch when program changes
  useEffect(() => {
    const nextAlignedSlot = getSynchronizedSlot15(Date.now() + clockOffsetMs) + 1;
    setWelcomeSlot15(nextAlignedSlot);
  }, [currentIndex, activeSource, clockOffsetMs]);

  const scheduleInfo = useMemo(() => {
    if (playlist.length === 0) return null;

    const currentVideo = playlist[currentIndex] || playlist[0];
    if (!currentVideo) return null;

    const poolIndices = playlist
      .map((item, idx) => ({ item, idx }))
      .filter((entry) =>
        activeThemeFilter === 'all' ? true : entry.item.theme === activeThemeFilter
      );
    const effectivePool =
      poolIndices.length > 0 ? poolIndices : playlist.map((item, idx) => ({ item, idx }));

    const posInPool = effectivePool.findIndex((p) => p.idx === currentIndex);
    const nextEntry =
      posInPool >= 0
        ? effectivePool[(posInPool + 1) % effectivePool.length]
        : effectivePool[0];
    const followingEntry =
      posInPool >= 0
        ? effectivePool[(posInPool + 2) % effectivePool.length]
        : effectivePool[Math.min(1, effectivePool.length - 1)];

    const nextVideo = nextEntry?.item || currentVideo;
    const followingVideo = followingEntry?.item || null;

    const elapsedSec = Math.max(
      0,
      Math.floor((serverNowMs - currentVideoStartedAt) / 1000)
    );
    const effectiveCurrentDur = Math.max(
      30,
      currentVideo.durationSeconds - getEffectiveOutroTrimSeconds(currentVideo)
    );
    const posSec =
      currentVideo.durationSeconds > 0
        ? elapsedSec % Math.max(1, currentVideo.durationSeconds)
        : elapsedSec;
    const remainingSec = Math.max(0, effectiveCurrentDur - posSec);

    const nextStartMs = serverNowMs + remainingSec * 1000;
    const nextEffectiveDur = Math.max(
      60,
      nextVideo.durationSeconds - getEffectiveOutroTrimSeconds(nextVideo)
    );
    const followingStartMs = nextStartMs + nextEffectiveDur * 1000;

    return {
      currentVideo,
      nextVideo,
      followingVideo,
      remainingSec,
      nextStartMs,
      followingStartMs,
    };
  }, [
    playlist,
    currentIndex,
    activeThemeFilter,
    currentVideoStartedAt,
    serverNowMs,
  ]);

  const cycleKey = scheduleInfo
    ? computeProgrammingFlashCycleKey({
        serverNowMs,
        activeSource,
        currentIndex,
        currentVideoStartedAt,
        remainingSec: scheduleInfo.remainingSec,
        flashBannerTriggeredAt,
        welcomeSlot15,
      })
    : null;

  const isVisible = Boolean(!suppressed && scheduleInfo && cycleKey && cycleKey !== dismissedCycleKey);

  useEffect(() => {
    onVisibilityChange?.(isVisible);
  }, [isVisible, onVisibilityChange]);

  if (!scheduleInfo) return null;

  const isEndingSoonFlash =
    activeSource === 'youtube' &&
    scheduleInfo.remainingSec <= 17 &&
    scheduleInfo.remainingSec >= 2;

  const nextHourLabel = formatBroadcastHour(scheduleInfo.nextStartMs);
  const followingHourLabel = formatBroadcastHour(scheduleInfo.followingStartMs);
  const nextTheme = getThemeDefinition(scheduleInfo.nextVideo.theme);
  const minsRemaining = Math.max(1, Math.ceil(scheduleInfo.remainingSec / 60));

  const badgeLabel =
    activeSource === 'twitch' && twitch.isLive
      ? 'RELAIS H24'
      : isEndingSoonFlash
        ? 'IMMÉDIAT'
        : 'GRILLE TV';

  const timeHeaderLabel =
    activeSource === 'twitch' && twitch.isLive
      ? 'APRÈS LE DIRECT'
      : `À SUIVRE · ${nextHourLabel}`;

  return (
    <div
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
      className={`absolute bottom-3.5 right-3.5 sm:bottom-5 sm:right-5 z-20 w-[236px] sm:w-[288px] lg:w-[322px] max-w-[88%] sm:max-w-[29%] transition-transform duration-200 ease-out pointer-events-none ${
        elevatedAboveControls ? '-translate-y-20 sm:-translate-y-24' : 'translate-y-0'
      }`}
    >
      <div
        className={`origin-bottom-right transition-all duration-300 ease-out ${
          isVisible
            ? 'opacity-100 translate-x-0 translate-y-0 scale-100 pointer-events-auto'
            : 'opacity-0 translate-x-6 translate-y-3 scale-95 pointer-events-none'
        }`}
      >
        <div
          key={cycleKey || 'idle'}
          className={`overflow-hidden rounded-2xl border border-white/25 shadow-2xl ${
            isVisible ? 'tv-card-animate' : ''
          }`}
        >
          {/* Distinctive Editorial TV Programme EPG Header Strip */}
          <div className="flex items-stretch justify-between bg-neutral-950 border-b border-white/20">
            <div className="inline-flex items-center gap-1.5 bg-white text-black px-2.5 py-1 text-[9.5px] sm:text-[10px] font-mono font-extrabold tracking-wider uppercase whitespace-nowrap shrink-0">
              <Tv className="w-3 h-3 shrink-0" />
              <span>{badgeLabel}</span>
            </div>

            <div className="flex items-center justify-end gap-1.5 pl-2 pr-1 py-0.5 min-w-0 flex-1">
              <span className="inline-flex items-center gap-1 text-[9.5px] sm:text-[10px] font-mono font-bold tabular-nums tracking-wider uppercase text-white truncate">
                <Clock className="w-2.5 h-2.5 text-neutral-400 shrink-0" />
                <span>{timeHeaderLabel}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  if (cycleKey) setDismissedCycleKey(cycleKey);
                }}
                title="Masquer ce rappel de programmation"
                className="h-5 w-5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer inline-flex items-center justify-center shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* TV Studio Schedule Card Body with Jean-Luc Mélenchon Cutout */}
          <div className="tv-program-epg-backdrop relative overflow-hidden min-h-[104px] sm:min-h-[118px] flex items-stretch">
            <div
              aria-hidden="true"
              className="tv-sheen-animate absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none z-20"
            />

            {/* Left Schedule Column (~61%) */}
            <div
              className={`${
                !cutoutError ? 'w-[61%] pr-1' : 'w-full pr-3.5'
              } pl-3 sm:pl-3.5 py-2.5 sm:py-3 flex flex-col justify-between gap-1.5 relative z-10`}
            >
              <div className="flex items-center gap-1.5 text-[9.5px] sm:text-[10px] font-mono tabular-nums text-neutral-300 truncate">
                <span className="uppercase font-semibold text-white/90">
                  {nextTheme.shortLabel}
                </span>
                {activeSource === 'youtube' && (
                  <>
                    <span aria-hidden="true" className="text-neutral-500">
                      ·
                    </span>
                    <span>dans {minsRemaining} min</span>
                  </>
                )}
              </div>

              <p className="text-[11px] sm:text-[12.5px] font-extrabold uppercase leading-[1.15] tracking-tight text-white line-clamp-3">
                {scheduleInfo.nextVideo.title}
              </p>

              <div className="pt-1 border-t border-white/10 text-[9px] sm:text-[9.5px] font-mono tabular-nums text-neutral-400 truncate">
                {scheduleInfo.followingVideo &&
                scheduleInfo.followingVideo.id !== scheduleInfo.nextVideo.id
                  ? `Ensuite ${followingHourLabel} · ${scheduleInfo.followingVideo.title}`
                  : 'Antenne continue JLM TV H24'}
              </div>
            </div>

            {/* Right Cutout Portrait (~39%) */}
            {!cutoutError && (
              <div className="w-[39%] relative flex items-end justify-end overflow-hidden pointer-events-none select-none">
                <img
                  src={portraitSrc}
                  alt="Jean-Luc Mélenchon"
                  referrerPolicy="no-referrer"
                  onError={() => setCutoutError(true)}
                  className="tv-portrait-animate h-[98px] sm:h-[112px] lg:h-[118px] w-auto max-w-none object-contain object-bottom drop-shadow-[0_6px_12px_rgba(0,0,0,0.9)]"
                />
              </div>
            )}

            {/* Synchronized 15-Second Countdown Hairline */}
            {isVisible && (
              <div className="absolute bottom-0 inset-x-0 h-[2px] bg-white/15 pointer-events-none z-20">
                <div
                  aria-hidden="true"
                  className="tv-slot-timer-15s h-full bg-white/90"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
