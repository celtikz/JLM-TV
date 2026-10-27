import { useEffect, useState } from 'react';
import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';

export interface DiscordActivityStatus {
  isEmbeddedInDiscord: boolean;
  ready: boolean;
  channelId: string | null;
  guildId: string | null;
}

export function isRunningInDiscordProxy(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname.endsWith('.discordsays.com') ||
    window.location.hostname.endsWith('.discord.media')
  );
}

export function useDiscordActivity(): DiscordActivityStatus {
  const [status, setStatus] = useState<DiscordActivityStatus>({
    isEmbeddedInDiscord: isRunningInDiscordProxy(),
    ready: false,
    channelId: null,
    guildId: null,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const frameId = params.get('frame_id');

    const subdomainId = isRunningInDiscordProxy()
      ? window.location.hostname.split('.')[0]
      : '';

    const clientId =
      subdomainId ||
      params.get('client_id') ||
      (import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined) ||
      '';

    if (!frameId || !clientId) {
      return;
    }

    let cancelled = false;

    async function setupActivity() {
      try {
        patchUrlMappings([
          { prefix: '/twitch-player', target: 'player.twitch.tv' },
          { prefix: '/youtube-embed', target: 'www.youtube.com' },
        ]);

        const sdk = new DiscordSDK(clientId);
        await sdk.ready();

        if (!cancelled) {
          setStatus({
            isEmbeddedInDiscord: true,
            ready: true,
            channelId: sdk.channelId ?? params.get('channel_id'),
            guildId: sdk.guildId ?? params.get('guild_id'),
          });
        }
      } catch (err) {
        console.warn('[Discord Activity SDK]:', err);
      }
    }

    void setupActivity();

    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
