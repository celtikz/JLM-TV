import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
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
}

const TEN_MINUTES_SEC = 600;
const PERIODIC_DISPLAY_DURATION_SEC = 22;

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
}: TvFlashBannerProps) {
  const [serverNowMs, setServerNowMs] = useState<number>(() => Date.now() + clockOffsetMs);
  const [dismissedCycleKey, setDismissedCycleKey] = useState<string | null>(null);
  const [initialWelcomeActive, setInitialWelcomeActive] = useState<boolean>(true);
  const [cutoutError, setCutoutError] = useState<boolean>(false);

  const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';
  const portraitSrc = `${apiBase}${MELENCHON_CUTOUT_PATH}`;

  useEffect(() => {
    const id = window.setInterval(() => {
      setServerNowMs(Date.now() + clockOffsetMs);
    }, 1000);
    return () => window.clearInterval(id);
  }, [clockOffsetMs]);

  useEffect(() => {
    setInitialWelcomeActive(true);
    const timer = window.setTimeout(() => {
      setInitialWelcomeActive(false);
    }, 11_000);
    return () => window.clearTimeout(timer);
  }, [currentIndex, activeSource]);

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

  if (!scheduleInfo) return null;

  const serverSec = Math.floor(serverNowMs / 1000);
  const tenMinSlot = Math.floor(serverSec / TEN_MINUTES_SEC);
  const secIntoSlot = serverSec % TEN_MINUTES_SEC;

  const isTenMinuteFlash = secIntoSlot < PERIODIC_DISPLAY_DURATION_SEC;
  const isEndingSoonFlash =
    activeSource === 'youtube' &&
    scheduleInfo.remainingSec <= 38 &&
    scheduleInfo.remainingSec >= 2;
  const isManualFlash =
    flashBannerTriggeredAt > 0 && serverNowMs - flashBannerTriggeredAt < 16_000;

  const cycleKey = isManualFlash
    ? `manual-${flashBannerTriggeredAt}`
    : isEndingSoonFlash
      ? `ending-${currentIndex}-${Math.floor(currentVideoStartedAt / 1000)}`
      : isTenMinuteFlash
        ? `slot-${tenMinSlot}`
        : initialWelcomeActive
          ? `welcome-${currentIndex}`
          : null;

  const isVisible = Boolean(!suppressed && cycleKey && cycleKey !== dismissedCycleKey);

  const nextHourLabel = formatBroadcastHour(scheduleInfo.nextStartMs);
  const followingHourLabel = formatBroadcastHour(scheduleInfo.followingStartMs);
  const nextTheme = getThemeDefinition(scheduleInfo.nextVideo.theme);
  const minsRemaining = Math.max(1, Math.ceil(scheduleInfo.remainingSec / 60));

  const topTabLabel =
    activeSource === 'twitch' && twitch.isLive
      ? 'RELAIS À SUIVRE'
      : isEndingSoonFlash
        ? `DANS UN INSTANT · ${nextHourLabel}`
        : `À SUIVRE · ${nextHourLabel}`;

  return (
    <div
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
      className={`absolute bottom-3.5 right-3.5 sm:bottom-5 sm:right-5 z-20 w-[216px] sm:w-[258px] lg:w-[284px] max-w-[46%] sm:max-w-[25%] transition-transform duration-200 ease-out pointer-events-none ${
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
        <div key={cycleKey || 'idle'} className={isVisible ? 'tv-card-animate' : ''}>
          {/* Top-Right Compact Broadcast Tab (matching French news corner box) */}
          <div className="flex items-stretch justify-end">
            <div className="bg-white text-black px-2.5 py-0.5 text-[9.5px] sm:text-[10px] font-mono font-bold tabular-nums tracking-wider uppercase rounded-tl-md whitespace-nowrap shadow">
              {topTabLabel}
            </div>
            <button
              type="button"
              onClick={() => {
                if (cycleKey) setDismissedCycleKey(cycleKey);
              }}
              title="Masquer cette vignette"
              className="bg-neutral-950/95 text-neutral-300 hover:text-white hover:bg-neutral-800 px-1.5 py-0.5 rounded-tr-md border-t border-r border-white/25 transition-colors cursor-pointer flex items-center justify-center"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Compact Corner Promo Card (<= 1/4 screen maximum) */}
          <div className="tv-vignette-backdrop relative overflow-hidden rounded-tl-lg rounded-bl-lg rounded-br-2xl border border-white/25 shadow-2xl min-h-[96px] sm:min-h-[112px] flex items-stretch">
            {/* Subtle Studio Light Sweep on Entrance */}
            <div
              aria-hidden="true"
              className="tv-sheen-animate absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none z-20"
            />

            {/* Left Column (~58%): Stacked Broadcast Headline & Timing */}
            <div
              className={`${
                !cutoutError ? 'w-[59%] pr-1' : 'w-full pr-3'
              } pl-3 sm:pl-3.5 py-2.5 sm:py-3 flex flex-col justify-between gap-1.5 relative z-10`}
            >
              <div className="flex items-center gap-1 text-[9px] sm:text-[9.5px] font-mono tabular-nums text-neutral-300 truncate">
                <span>{nextTheme.shortLabel}</span>
                {activeSource === 'youtube' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>dans {minsRemaining}m</span>
                  </>
                )}
              </div>

              <p className="text-[11px] sm:text-[12.5px] font-extrabold uppercase leading-[1.14] tracking-tight text-white line-clamp-3 drop-shadow">
                {scheduleInfo.nextVideo.title}
              </p>

              {scheduleInfo.followingVideo &&
              scheduleInfo.followingVideo.id !== scheduleInfo.nextVideo.id ? (
                <div className="text-[9px] sm:text-[9.5px] font-mono tabular-nums text-neutral-400 truncate">
                  Ensuite {followingHourLabel}
                </div>
              ) : (
                <div className="text-[9px] font-mono text-neutral-400">JLM TV H24</div>
              )}
            </div>

            {/* Right Column (~41%): Cutout Portrait of Jean-Luc Mélenchon */}
            {!cutoutError && (
              <div className="w-[41%] relative flex items-end justify-end overflow-hidden pointer-events-none select-none">
                <img
                  src={portraitSrc}
                  alt="Jean-Luc Mélenchon"
                  referrerPolicy="no-referrer"
                  onError={() => setCutoutError(true)}
                  className="tv-portrait-animate h-[94px] sm:h-[110px] lg:h-[116px] w-auto max-w-none object-contain object-bottom drop-shadow-[0_6px_12px_rgba(0,0,0,0.9)]"
                />
              </div>
            )}

            {/* Bottom 2px Broadcast Countdown Hairline */}
            {isVisible && (
              <div
                aria-hidden="true"
                className="tv-timer-animate absolute bottom-0 inset-x-0 h-[2px] bg-white/85 pointer-events-none z-20"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
