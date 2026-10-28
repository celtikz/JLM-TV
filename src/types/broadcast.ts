export type BroadcastMode = 'auto' | 'force_twitch' | 'force_youtube';
export type ActiveSource = 'twitch' | 'youtube';

export type ProgramTheme =
  | 'entretiens'
  | 'conferences'
  | 'vlogs'
  | 'meetings'
  | 'assemblee'
  | 'international';

export interface VideoChapter {
  title: string;
  startSeconds: number;
}

export interface TwitchStatus {
  isLive: boolean;
  channelLogin: string;
  displayName: string;
  streamId: string | null;
  title: string;
  viewersCount: number;
  startedAt: string | null;
  profileImageUrl: string;
  lastCheckedAt: string;
}

export interface YouTubeVideoItem {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  views: number;
  durationSeconds: number;
  sourceType: 'rss' | 'custom';
  twitchVodId?: string;
  twitchChannelLogin?: string;
  theme: ProgramTheme;
  chapters: VideoChapter[];
  chaptersHydrated?: boolean;
}

export interface TransitionLog {
  id: string;
  timestamp: string;
  message: string;
  source: ActiveSource;
}

export interface ChatMessage {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface KeepAliveStats {
  enabled: boolean;
  targetUrl: string | null;
  intervalSeconds: number;
  pingCount: number;
  lastPingAt: string | null;
  lastPingStatus: 'ok' | 'local' | 'error';
  uptimeSeconds: number;
}

export interface BroadcastState {
  mode: BroadcastMode;
  activeSource: ActiveSource;
  activeThemeFilter: ProgramTheme | 'all';
  flashBannerTriggeredAt: number;
  leftBannerTriggeredAt?: number;
  leftBannerManualIndex?: number;
  keepAlive: KeepAliveStats;
  twitch: TwitchStatus;
  playlist: YouTubeVideoItem[];
  currentIndex: number;
  currentVideoStartedAt: number;
  serverTime: number;
  connectedViewers: number;
  shuffleYoutube: boolean;
  transitions: TransitionLog[];
  chatMessages: ChatMessage[];
}

export interface BotConfigOptions {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  twitchChannel: string;
  youtubeChannelId: string;
  resolutionPreset: '720p30' | '720p60' | '1080p60';
  videoCodec: 'H264' | 'VP8';
  bitrateKbps: number;
  probeIntervalSec: number;
  shuffleFallback: boolean;
  syncWithWebRegie: boolean;
  webRegieUrl: string;
}
