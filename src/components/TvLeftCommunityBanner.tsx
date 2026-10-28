import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type {
  ActiveSource,
  ProgramTheme,
  TwitchStatus,
  YouTubeVideoItem,
} from '../types/broadcast';
import {
  handleDiscordAwareLinkClick,
  isRunningInDiscordProxy,
} from '../hooks/useDiscordActivity';
import {
  formatBroadcastHour,
  getEffectiveOutroTrimSeconds,
} from '../utils/programMetadata';
import {
  TOTAL_LEFT_LINK_BANNERS,
  TV_BANNER_SLOT_MS,
  getSynchronizedSlot15,
} from '../utils/bannerSync';

const MELENCHON_CUTOUT_PATH =
  '/assets/aistudio/M_lenchon_2027_-_55262255527_189f44be.png';

type BrandLogoKind =
  | 'support_jlm'
  | 'twitch'
  | 'youtube'
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'whatsapp'
  | 'discord';

interface SingleLinkBannerSpec {
  id: string;
  logo: BrandLogoKind;
  kicker: string;
  handle: string;
  description: string;
  ctaLabel: string;
  url: string;
  brandBgClass: string;
  kickerColorClass: string;
}

/**
 * 9 individual useful-link items rotating smoothly every 15s across the square white bandeau.
 * Adjacent items use distinct brand accents so button-to-button transitions are crisp and unmistakable.
 */
export const INDIVIDUAL_LINK_BANNERS: SingleLinkBannerSpec[] = [
  {
    id: 'melenchon-2027',
    logo: 'support_jlm',
    kicker: 'CAMPAGNE 2027',
    handle: 'melenchon2027.fr',
    description: 'Soutenez la campagne de Jean-Luc Mélenchon et rejoignez l’action populaire',
    ctaLabel: 'Soutenir',
    url: 'https://melenchon2027.fr/',
    brandBgClass: 'bg-[#c8102e]',
    kickerColorClass: 'text-[#c8102e]',
  },
  {
    id: 'twitch-jlm',
    logo: 'twitch',
    kicker: 'TWITCH OFFICIEL',
    handle: '@jlmelenchon',
    description: 'Suivez les émissions spéciales, revues et réactions en direct sur Twitch',
    ctaLabel: 'Suivre',
    url: 'https://www.twitch.tv/jlmelenchon',
    brandBgClass: 'bg-[#6d28d9]',
    kickerColorClass: 'text-[#6d28d9]',
  },
  {
    id: 'youtube-jlm',
    logo: 'youtube',
    kicker: 'CHAÎNE YOUTUBE',
    handle: '@JLMelenchon',
    description: 'Retrouvez l’intégralité des meetings, conférences, entretiens et vlogs',
    ctaLabel: 'S’abonner',
    url: 'https://www.youtube.com/@JLMelenchon',
    brandBgClass: 'bg-[#dc2626]',
    kickerColorClass: 'text-[#dc2626]',
  },
  {
    id: 'instagram-lfi',
    logo: 'instagram',
    kicker: 'INSTAGRAM LFI',
    handle: '@franceinsoumise',
    description: 'Suivez toute l’actualité en images, stories et coulisses du mouvement',
    ctaLabel: 'Suivre',
    url: 'https://www.instagram.com/franceinsoumise/',
    brandBgClass: 'bg-[#7e22ce]',
    kickerColorClass: 'text-[#7e22ce]',
  },
  {
    id: 'tiktok-lfi',
    logo: 'tiktok',
    kicker: 'TIKTOK LFI',
    handle: '@franceinsoumise',
    description: 'Retrouvez les extraits politiques et séquences de mobilisation sur TikTok',
    ctaLabel: 'Suivre',
    url: 'https://www.tiktok.com/@franceinsoumise?lang=fr',
    brandBgClass: 'bg-[#db2777]',
    kickerColorClass: 'text-[#be185d]',
  },
  {
    id: 'x-lfi',
    logo: 'x',
    kicker: 'X · TWITTER',
    handle: '@FranceInsoumise',
    description: 'Suivez le fil d’actualité officiel, communiqués et réactions en temps réel',
    ctaLabel: 'Suivre',
    url: 'https://x.com/FranceInsoumise',
    brandBgClass: 'bg-[#09090b]',
    kickerColorClass: 'text-[#09090b]',
  },
  {
    id: 'whatsapp-lfi',
    logo: 'whatsapp',
    kicker: 'CHAÎNE WHATSAPP',
    handle: 'La France Insoumise',
    description: 'Recevez directement les alertes et informations officielles sur WhatsApp',
    ctaLabel: 'Rejoindre',
    url: 'https://whatsapp.com/channel/0029VbDuBhQ2Jl8E7JiZEu1Y',
    brandBgClass: 'bg-[#15803d]',
    kickerColorClass: 'text-[#15803d]',
  },
  {
    id: 'discord-barricade',
    logo: 'discord',
    kicker: 'DISCORD COMMUNAUTÉ',
    handle: 'discord.gg/barricade',
    description: 'Rejoignez les salons vocaux, débats et veilles collectives sur La Barricade',
    ctaLabel: 'Rejoindre',
    url: 'https://discord.gg/barricade',
    brandBgClass: 'bg-[#4f46e5]',
    kickerColorClass: 'text-[#4338ca]',
  },
  {
    id: 'discord-lfi',
    logo: 'discord',
    kicker: 'DISCORD OFFICIEL',
    handle: 'discord.gg/lfi',
    description: 'Échangez et organisez-vous sur le serveur Discord officiel France Insoumise',
    ctaLabel: 'Rejoindre',
    url: 'https://discord.gg/lfi',
    brandBgClass: 'bg-[#1d4ed8]',
    kickerColorClass: 'text-[#1d4ed8]',
  },
];

function BrandSvgLogo({
  kind,
  sizeClass = 'w-4 h-4 sm:w-[18px] sm:h-[18px]',
}: {
  kind: BrandLogoKind;
  sizeClass?: string;
}) {
  switch (kind) {
    case 'support_jlm':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={sizeClass}>
          <circle
            cx="12"
            cy="12.2"
            r="5.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
          />
          <path
            d="M13.4 3.2L10.6 20.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'twitch':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={sizeClass}>
          <path
            fill="currentColor"
            d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"
          />
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={sizeClass}>
          <path
            fill="currentColor"
            d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
          />
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={sizeClass}>
          <path
            fill="currentColor"
            d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"
          />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={sizeClass}>
          <path
            fill="currentColor"
            d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
          />
        </svg>
      );
    case 'x':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={sizeClass}>
          <path
            fill="currentColor"
            d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
          />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={sizeClass}>
          <path
            fill="currentColor"
            d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"
          />
        </svg>
      );
    case 'discord':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={sizeClass}>
          <path
            fill="currentColor"
            d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
          />
        </svg>
      );
  }
}

interface TvLeftCommunityBannerProps {
  activeSource?: ActiveSource;
  twitch?: TwitchStatus;
  playlist?: YouTubeVideoItem[];
  currentIndex?: number;
  activeThemeFilter?: ProgramTheme | 'all';
  currentVideoStartedAt?: number;
  flashBannerTriggeredAt?: number;
  clockOffsetMs: number;
  leftBannerTriggeredAt?: number;
  leftBannerManualIndex?: number;
  enabled: boolean;
  programCardVisible?: boolean;
  onToggleEnabled?: (nextEnabled?: boolean) => void;
  elevatedAboveControls?: boolean;
  suppressed?: boolean;
}

export function TvLeftCommunityBanner({
  activeSource = 'youtube',
  twitch,
  playlist = [],
  currentIndex = 0,
  activeThemeFilter = 'all',
  currentVideoStartedAt = 0,
  flashBannerTriggeredAt = 0,
  clockOffsetMs,
  leftBannerTriggeredAt = 0,
  leftBannerManualIndex = 0,
  enabled,
  programCardVisible = false,
  suppressed = false,
}: TvLeftCommunityBannerProps) {
  const [serverNowMs, setServerNowMs] = useState<number>(() => Date.now() + clockOffsetMs);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [cutoutError, setCutoutError] = useState<boolean>(false);

  const apiBase = isRunningInDiscordProxy() ? '/.proxy' : '';
  const portraitSrc = `${apiBase}${MELENCHON_CUTOUT_PATH}`;

  // Fast 250ms tick ensures accurate schedule clock and exact 15s synchronized link switches
  useEffect(() => {
    const id = window.setInterval(() => {
      setServerNowMs(Date.now() + clockOffsetMs);
    }, 250);
    return () => window.clearInterval(id);
  }, [clockOffsetMs]);

  // Compute upcoming TV schedule for the left Programmation card
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

    const nextVideo = nextEntry?.item || currentVideo;
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

    return {
      nextVideo,
      nextHourLabel: formatBroadcastHour(nextStartMs),
    };
  }, [playlist, currentIndex, activeThemeFilter, currentVideoStartedAt, serverNowMs]);

  const slot15 = getSynchronizedSlot15(serverNowMs);
  const isManualLinkOverride =
    leftBannerTriggeredAt > 0 &&
    serverNowMs >= leftBannerTriggeredAt &&
    serverNowMs - leftBannerTriggeredAt < TV_BANNER_SLOT_MS;

  const baseIndex = isManualLinkOverride
    ? ((leftBannerManualIndex % TOTAL_LEFT_LINK_BANNERS) + TOTAL_LEFT_LINK_BANNERS) %
      TOTAL_LEFT_LINK_BANNERS
    : ((slot15 % TOTAL_LEFT_LINK_BANNERS) + TOTAL_LEFT_LINK_BANNERS) %
      TOTAL_LEFT_LINK_BANNERS;

  // Latch active item while hovered so a button never transitions away right under a click
  const [latchedIndex, setLatchedIndex] = useState<number>(baseIndex);
  useEffect(() => {
    if (!isHovered) {
      setLatchedIndex(baseIndex);
    }
  }, [baseIndex, isHovered]);

  const activeIndex = isHovered ? latchedIndex : baseIndex;

  // Dual-layer opaque white slide state: Bandeau 1 slides upward while Bandeau 2 glides up behind it
  const [displayIndex, setDisplayIndex] = useState<number>(activeIndex);
  const [exitingIndex, setExitingIndex] = useState<number | null>(null);
  const [transitionTick, setTransitionTick] = useState<number>(0);
  const currentDisplayRef = useRef<number>(activeIndex);

  useEffect(() => {
    if (activeIndex === currentDisplayRef.current) return;
    const previous = currentDisplayRef.current;
    currentDisplayRef.current = activeIndex;
    setExitingIndex(previous);
    setDisplayIndex(activeIndex);
    setTransitionTick((prev) => prev + 1);
  }, [activeIndex]);

  useEffect(() => {
    if (transitionTick === 0) return;
    const timer = window.setTimeout(() => {
      setExitingIndex(null);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [transitionTick]);

  const currentBanner = INDIVIDUAL_LINK_BANNERS[displayIndex] || INDIVIDUAL_LINK_BANNERS[0];
  const exitingBanner =
    exitingIndex !== null ? INDIVIDUAL_LINK_BANNERS[exitingIndex] || null : null;

  const showProgramCard = Boolean(!suppressed && programCardVisible);
  const showLinksBar = Boolean(!suppressed && enabled);

  const isTwitchLiveNow = Boolean(activeSource === 'twitch' && twitch?.isLive);
  const programKicker = isTwitchLiveNow ? 'APRÈS DIRECT' : 'À SUIVRE';
  const programTimeTag = isTwitchLiveNow
    ? 'H24'
    : scheduleInfo?.nextHourLabel || 'H24';
  const programTitle = scheduleInfo?.nextVideo.title || 'Antenne continue JLM TV';

  const renderWhiteBandeauContent = (
    banner: SingleLinkBannerSpec,
    interactive: boolean
  ) => {
    if (!interactive) {
      return (
        <>
          <div className="min-w-0 flex-1 h-full flex items-center gap-2.5 sm:gap-3">
            <div
              className={`hidden sm:flex w-8 h-8 lg:w-9 lg:h-9 shrink-0 items-center justify-center text-white ${banner.brandBgClass}`}
            >
              <BrandSvgLogo kind={banner.logo} />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`font-display text-[10px] sm:text-[12px] lg:text-[12.5px] font-extrabold uppercase tracking-tight shrink-0 ${banner.kickerColorClass}`}
                >
                  {banner.kicker}
                </span>
                <span aria-hidden="true" className="text-neutral-400 text-xs shrink-0">
                  ·
                </span>
                <span className="font-mono text-[10px] sm:text-[11.5px] font-bold text-neutral-900 truncate">
                  {banner.handle}
                </span>
              </div>
              <p className="hidden sm:block text-[11px] lg:text-[12px] text-neutral-700 truncate mt-0.5">
                {banner.description}
              </p>
            </div>
          </div>

          <div
            className={`shrink-0 w-[96px] sm:w-[138px] lg:w-[154px] h-[32px] sm:h-[38px] flex items-center justify-center gap-1.5 px-2.5 text-white ${banner.brandBgClass}`}
          >
            <span className="hidden sm:inline-flex shrink-0">
              <BrandSvgLogo kind={banner.logo} sizeClass="w-3.5 h-3.5" />
            </span>
            <span className="font-display text-[10px] sm:text-[11.5px] font-extrabold uppercase tracking-tight whitespace-nowrap">
              {banner.ctaLabel}
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
          </div>
        </>
      );
    }

    return (
      <>
        <a
          href={banner.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => handleDiscordAwareLinkClick(e, banner.url)}
          className="min-w-0 flex-1 h-full flex items-center gap-2.5 sm:gap-3 cursor-pointer"
        >
          <div
            className={`hidden sm:flex w-8 h-8 lg:w-9 lg:h-9 shrink-0 items-center justify-center text-white ${banner.brandBgClass}`}
          >
            <BrandSvgLogo kind={banner.logo} />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`font-display text-[10px] sm:text-[12px] lg:text-[12.5px] font-extrabold uppercase tracking-tight shrink-0 ${banner.kickerColorClass}`}
              >
                {banner.kicker}
              </span>
              <span aria-hidden="true" className="text-neutral-400 text-xs shrink-0">
                ·
              </span>
              <span className="font-mono text-[10px] sm:text-[11.5px] font-bold text-neutral-900 truncate">
                {banner.handle}
              </span>
            </div>
            <p className="hidden sm:block text-[11px] lg:text-[12px] text-neutral-700 truncate mt-0.5">
              {banner.description}
            </p>
          </div>
        </a>

        <a
          href={banner.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => handleDiscordAwareLinkClick(e, banner.url)}
          className={`group/cta shrink-0 w-[96px] sm:w-[138px] lg:w-[154px] h-[32px] sm:h-[38px] flex items-center justify-center gap-1.5 px-2.5 text-white hover:brightness-110 transition-[filter] duration-150 cursor-pointer ${banner.brandBgClass}`}
        >
          <span className="hidden sm:inline-flex shrink-0">
            <BrandSvgLogo kind={banner.logo} sizeClass="w-3.5 h-3.5" />
          </span>
          <span className="font-display text-[10px] sm:text-[11.5px] font-extrabold uppercase tracking-tight whitespace-nowrap">
            {banner.ctaLabel}
          </span>
          <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5] shrink-0 transition-transform duration-150 group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5" />
        </a>
      </>
    );
  };

  return (
    <div
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-x-0 bottom-0 z-20 pointer-events-none"
    >
      {/* 1. LEFT BLOCK (Detached slightly): Appears 10s every 5min by sliding from left to right into position */}
      <div
        className={`
          absolute left-0 bottom-0 z-20
          w-[108px] sm:w-[154px] lg:w-[174px]
          h-[78px] sm:h-[98px] lg:h-[108px]
          overflow-visible select-none
          transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]
          ${
            showProgramCard
              ? 'translate-x-0 pointer-events-auto shadow-[6px_0_18px_rgba(0,0,0,0.65)]'
              : '-translate-x-[115%] pointer-events-none'
          }
        `}
      >
        {/* Sharp square dark-slate studio background */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#494e59] via-[#252830] to-[#0f1116] border-t border-r border-white/20" />

        {/* Jean-Luc Mélenchon cutout portrait rising cleanly out of the top edge */}
        {!cutoutError && (
          <img
            src={portraitSrc}
            alt="Jean-Luc Mélenchon"
            referrerPolicy="no-referrer"
            onError={() => setCutoutError(true)}
            className="tv-portrait-animate absolute bottom-0 left-1/2 -translate-x-1/2 h-[94px] sm:h-[118px] lg:h-[130px] w-auto max-w-none object-contain object-bottom pointer-events-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]"
          />
        )}

        {/* Studio sheen & bottom legibility scrim */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            key={`sheen-${currentIndex}-${flashBannerTriggeredAt}-${showProgramCard ? 'in' : 'out'}`}
            aria-hidden="true"
            className="tv-sheen-animate absolute inset-y-0 w-12 bg-gradient-to-r from-transparent via-white/20 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 h-[76%] bg-gradient-to-t from-[#090a0d] via-[#0e1015]/85 to-transparent" />
        </div>

        {/* Schedule Kicker + Yellow Square Time Tag + Bold Stacked Show Title */}
        <div className="relative z-10 w-full h-full px-2 sm:px-2.5 pb-1.5 sm:pb-2 flex flex-col justify-end">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[7.5px] sm:text-[9px] font-extrabold uppercase tracking-tight text-white leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] truncate">
              {programKicker}
            </span>
            <span className="bg-[#f2e600] text-black px-1 py-[1px] text-[8px] sm:text-[9.5px] font-mono font-black tabular-nums leading-none shrink-0">
              {programTimeTag}
            </span>
          </div>
          <p className="font-display text-[9px] sm:text-[10.5px] lg:text-[11.5px] font-black uppercase leading-[1.06] tracking-tight text-white line-clamp-2 drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
            {programTitle}
          </p>
        </div>
      </div>

      {/* 2. FUSED JLMTV + SQUARE WHITE LINKS BANDEAU (Anchored at bottom: 0, yields space + slight gap when Programmation slides in) */}
      <div
        onMouseEnter={(e) => {
          e.stopPropagation();
          setIsHovered(true);
        }}
        onMouseMove={(e) => e.stopPropagation()}
        onMouseLeave={() => setIsHovered(false)}
        className={`w-full flex items-end transition-all duration-300 ease-out ${
          showLinksBar
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        {/* Smooth Left Spacer (108+6=114 / 154+8=162 / 174+10=184) so ONLY the Programmation card detaches slightly */}
        <div
          aria-hidden="true"
          className={`shrink-0 transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            showProgramCard ? 'w-[114px] sm:w-[162px] lg:w-[184px]' : 'w-0'
          }`}
        />

        {/* Pure All-White "JLMTV" Square Logo Block (Flush with White Bandeau, no TV icon, no bottom line) */}
        <div className="h-[46px] sm:h-[54px] lg:h-[58px] px-2.5 sm:px-4 bg-[#c8102e] flex items-center justify-center shrink-0 select-none shadow-[0_-4px_16px_rgba(0,0,0,0.35)]">
          <span className="font-display font-black text-[12px] sm:text-[15px] lg:text-[16px] tracking-tight text-white leading-none">
            JLMTV
          </span>
        </div>

        {/* Square White Bandeau Viewport: Bandeau 1 slides upward (z-20) while Bandeau 2 glides up behind it (z-10) */}
        <div className="relative flex-1 min-w-0 h-[46px] sm:h-[54px] lg:h-[58px] bg-white text-neutral-950 border-t border-neutral-200 overflow-hidden shadow-[0_-4px_16px_rgba(0,0,0,0.28)]">
          {exitingBanner && (
            <div
              key={`bandeau-exit-${exitingBanner.id}-${transitionTick}`}
              aria-hidden="true"
              className="tv-bandeau-outgoing-up absolute inset-0 z-20 bg-white border-b border-neutral-200 shadow-[0_5px_12px_rgba(0,0,0,0.10)] px-2.5 sm:px-4 lg:px-5 flex items-center justify-between gap-2.5 sm:gap-4 pointer-events-none"
            >
              {renderWhiteBandeauContent(exitingBanner, false)}
            </div>
          )}

          <div
            key={`bandeau-curr-${currentBanner.id}-${transitionTick}`}
            className={`${
              transitionTick > 0 ? 'tv-bandeau-incoming-behind' : ''
            } relative z-10 w-full h-full bg-white px-2.5 sm:px-4 lg:px-5 flex items-center justify-between gap-2.5 sm:gap-4`}
          >
            {renderWhiteBandeauContent(currentBanner, true)}
          </div>

          {/* Synchronized 15-Second Switch Hairline Along Bottom Edge */}
          {showLinksBar && (
            <div className="absolute bottom-0 inset-x-0 h-[2.5px] bg-neutral-200 pointer-events-none z-30">
              <div
                key={`timer-${slot15}-${leftBannerTriggeredAt}`}
                aria-hidden="true"
                className={`tv-slot-timer-15s h-full transition-colors duration-500 ${
                  currentBanner.brandBgClass
                } ${isHovered ? 'tv-timer-paused' : ''}`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
