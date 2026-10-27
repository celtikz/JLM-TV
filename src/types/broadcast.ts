export type BroadcastMode = 'auto' | 'force_twitch' | 'force_youtube';
export type ActiveSource = 'twitch' | 'youtube';

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

export interface BroadcastState {
  mode: BroadcastMode;
  activeSource: ActiveSource;
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
