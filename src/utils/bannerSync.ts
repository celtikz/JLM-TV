import { useEffect, useRef, useState } from 'react';
import type { ActiveSource } from '../types/broadcast';

/**
 * Shared 15-second broadcast heartbeat (15,000 ms) used to lock
 * the always-on useful-link white bandeau (switching every 15s).
 */
export const TV_BANNER_SLOT_MS = 15_000;
export const TV_BANNER_SLOT_SEC = 15;
export const TOTAL_LEFT_LINK_BANNERS = 9;

/**
 * Left Programmation ("À suivre") card timing:
 * Slides in from left to right for 10 seconds every 5 minutes (300,000 ms),
 * plus on manual "Programmation « À suivre »" trigger and initial arrival preview.
 */
export const PROGRAM_SCHEDULE_DURATION_MS = 10_000;
export const PROGRAM_SCHEDULE_INTERVAL_MS = 300_000;

/** Legacy periodic constant kept for compatibility */
export const PROGRAMMING_PERIODIC_EVERY_SLOTS = 20;

export function getSynchronizedSlot15(serverNowMs: number): number {
  return Math.floor(serverNowMs / TV_BANNER_SLOT_MS);
}

export interface UseProgramScheduleVisibilityOptions {
  clockOffsetMs: number;
  flashBannerTriggeredAt?: number;
  enabled: boolean;
  suppressed?: boolean;
}

export function useProgramScheduleVisibility({
  clockOffsetMs,
  flashBannerTriggeredAt = 0,
  enabled,
  suppressed = false,
}: UseProgramScheduleVisibilityOptions): boolean {
  const [serverNowMs, setServerNowMs] = useState<number>(() => Date.now() + clockOffsetMs);
  const [welcomeAnchorMs, setWelcomeAnchorMs] = useState<number | null>(null);
  const clockOffsetRef = useRef<number>(clockOffsetMs);
  clockOffsetRef.current = clockOffsetMs;

  useEffect(() => {
    const id = window.setInterval(() => {
      setServerNowMs(Date.now() + clockOffsetRef.current);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  // Trigger a smooth left-to-right 10s entrance right after mount so viewers see the upcoming show on arrival
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWelcomeAnchorMs(Date.now() + clockOffsetRef.current);
    }, 220);
    return () => window.clearTimeout(timer);
  }, []);

  if (suppressed) return false;

  const isManualTrigger =
    flashBannerTriggeredAt > 0 &&
    serverNowMs >= flashBannerTriggeredAt &&
    serverNowMs - flashBannerTriggeredAt < PROGRAM_SCHEDULE_DURATION_MS;

  const cycleOffsetMs =
    ((serverNowMs % PROGRAM_SCHEDULE_INTERVAL_MS) + PROGRAM_SCHEDULE_INTERVAL_MS) %
    PROGRAM_SCHEDULE_INTERVAL_MS;
  const isPeriodicFiveMinWindow = cycleOffsetMs < PROGRAM_SCHEDULE_DURATION_MS;

  const isWelcomeTenSecWindow =
    welcomeAnchorMs !== null &&
    serverNowMs >= welcomeAnchorMs &&
    serverNowMs - welcomeAnchorMs < PROGRAM_SCHEDULE_DURATION_MS;

  return Boolean(
    isManualTrigger || (enabled && (isPeriodicFiveMinWindow || isWelcomeTenSecWindow))
  );
}

export interface ProgrammingSyncInput {
  serverNowMs: number;
  activeSource: ActiveSource;
  currentIndex: number;
  currentVideoStartedAt: number;
  remainingSec: number;
  flashBannerTriggeredAt: number;
  welcomeSlot15: number | null;
}

export function computeProgrammingFlashCycleKey({
  serverNowMs,
  activeSource,
  currentIndex,
  currentVideoStartedAt,
  remainingSec,
  flashBannerTriggeredAt,
  welcomeSlot15,
}: ProgrammingSyncInput): string | null {
  const slot15 = getSynchronizedSlot15(serverNowMs);

  // 1. Manual trigger from player / régie ("À suivre" button): 10s duration
  if (
    flashBannerTriggeredAt > 0 &&
    serverNowMs >= flashBannerTriggeredAt &&
    serverNowMs - flashBannerTriggeredAt < PROGRAM_SCHEDULE_DURATION_MS
  ) {
    return `manual-${flashBannerTriggeredAt}`;
  }

  // 2. Final announcement right before program transition
  if (activeSource === 'youtube' && remainingSec <= 12 && remainingSec >= 2) {
    return `ending-${currentIndex}-${Math.floor(currentVideoStartedAt / 1000)}`;
  }

  // 3. Synchronized periodic TV schedule slot: 10s every 5 minutes
  const cycleOffsetMs =
    ((serverNowMs % PROGRAM_SCHEDULE_INTERVAL_MS) + PROGRAM_SCHEDULE_INTERVAL_MS) %
    PROGRAM_SCHEDULE_INTERVAL_MS;
  if (cycleOffsetMs < PROGRAM_SCHEDULE_DURATION_MS) {
    return `periodic-5m-${Math.floor(serverNowMs / PROGRAM_SCHEDULE_INTERVAL_MS)}`;
  }

  // 4. Synchronized welcome slot
  if (welcomeSlot15 !== null && slot15 === welcomeSlot15) {
    return `welcome-${currentIndex}-${welcomeSlot15}`;
  }

  return null;
}
