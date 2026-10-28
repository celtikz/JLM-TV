import { useEffect, useState, type MouseEvent } from 'react';
import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';

export interface DiscordActivityStatus {
  isEmbeddedInDiscord: boolean;
  ready: boolean;
  channelId: string | null;
  guildId: string | null;
}

let activeDiscordSdk: DiscordSDK | null = null;

export function isRunningInDiscordProxy(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname.endsWith('.discordsays.com') ||
    window.location.hostname.endsWith('.discord.media')
  );
}

/**
 * Opens an external URL cleanly in both Web browsers (via native <a target="_blank">)
 * and Discord Voice Activities (via DiscordSDK openExternalLink command).
 */
export function handleDiscordAwareLinkClick(
  e: MouseEvent<HTMLAnchorElement>,
  url: string
): void {
  e.stopPropagation();
  if (activeDiscordSdk) {
    e.preventDefault();
    void activeDiscordSdk.commands.openExternalLink({ url }).catch(() => {
      // Fallback handled by Discord client modal
    });
  }
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
          activeDiscordSdk = sdk;
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
