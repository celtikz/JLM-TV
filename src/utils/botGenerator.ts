import type { BotConfigOptions } from '../types/broadcast';

export interface GeneratedBotFiles {
  botTs: string;
  dockerfile: string;
  dockerCompose: string;
  packageJson: string;
  envExample: string;
  installScript: string;
}

function getResolutionDimensions(preset: BotConfigOptions['resolutionPreset']) {
  if (preset === '1080p60') return { width: 1920, height: 1080, fps: 60, streamlinkQuality: '1080p60,1080p,720p60,best', ytdlpHeight: 1080 };
  if (preset === '720p60') return { width: 1280, height: 720, fps: 60, streamlinkQuality: '720p60,720p,best', ytdlpHeight: 720 };
  return { width: 1280, height: 720, fps: 30, streamlinkQuality: '720p,480p,best', ytdlpHeight: 720 };
}

export function generateDiscordBotFiles(config: BotConfigOptions): GeneratedBotFiles {
  const dims = getResolutionDimensions(config.resolutionPreset);
  const guildDefault = config.guildId.trim() || '123456789012345678';
  const voiceDefault = config.voiceChannelId.trim() || '987654321098765432';
  const textDefault = config.textChannelId.trim() || '';

  const envExample = `# Token du compte dédié à la diffusion vocale Discord ("Go Live" H24)
# À renseigner uniquement sur votre serveur/VPS dans un fichier .env privé
DISCORD_USER_TOKEN="VOTRE_TOKEN_COMPTE_DEDIE"

# Identifiants du serveur Discord et du salon vocal cible
DISCORD_GUILD_ID="${guildDefault}"
DISCORD_VOICE_CHANNEL_ID="${voiceDefault}"
DISCORD_TEXT_CHANNEL_ID="${textDefault}"

# Sources officielles surveillées H24
TWITCH_CHANNEL="${config.twitchChannel}"
YOUTUBE_CHANNEL_ID="${config.youtubeChannelId}"

# Paramètres d'encodage vidéo WebRTC / UDP Discord
STREAM_WIDTH="${dims.width}"
STREAM_HEIGHT="${dims.height}"
STREAM_FPS="${dims.fps}"
STREAM_BITRATE_KBPS="${config.bitrateKbps}"
STREAM_CODEC="${config.videoCodec}"
TWITCH_PROBE_INTERVAL_SEC="${config.probeIntervalSec}"
SHUFFLE_YOUTUBE="${config.shuffleFallback ? 'true' : 'false'}"

# Synchronisation optionnelle avec votre Régie Web JLM Télévision H24
SYNC_WEB_REGIE="${config.syncWithWebRegie ? 'true' : 'false'}"
WEB_REGIE_URL="${config.webRegieUrl}"
`;

  const packageJson = JSON.stringify(
    {
      name: 'jlm-tv-discord-bot-h24',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: {
        start: 'tsx src/bot.ts',
      },
      dependencies: {
        '@dank074/discord-video-stream': '^5.1.0',
        '@lng2004/discord.js-selfbot-v13': '^3.2.0',
        dotenv: '^17.2.3',
      },
      devDependencies: {
        '@types/node': '^22.14.0',
        tsx: '^4.21.0',
        typescript: '^5.8.2',
      },
    },
    null,
    2
  );

  const dockerfile = `FROM node:22-bookworm-slim

# Installation de FFmpeg, Streamlink (pour Twitch) et yt-dlp (pour YouTube)
RUN apt-get update && apt-get install -y --no-install-recommends \\
    ffmpeg \\
    python3 \\
    python3-pip \\
    streamlink \\
    ca-certificates \\
    curl \\
    build-essential \\
    cmake \\
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \\
  && chmod a+rx /usr/local/bin/yt-dlp \\
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY src ./src

CMD ["npm", "start"]
`;

  const dockerCompose = `services:
  jlm-tv-bot:
    build: .
    container_name: jlm-tv-discord-h24
    restart: always
    env_file:
      - .env
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "3"
`;

  const botTs = `import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@lng2004/discord.js-selfbot-v13';
import { Streamer, prepareStream, playStream } from '@dank074/discord-video-stream';

const execFileAsync = promisify(execFile);

const DISCORD_TOKEN = process.env.DISCORD_USER_TOKEN || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '${guildDefault}';
const VOICE_CHANNEL_ID = process.env.DISCORD_VOICE_CHANNEL_ID || '${voiceDefault}';
const TEXT_CHANNEL_ID = process.env.DISCORD_TEXT_CHANNEL_ID || '${textDefault}';

const TWITCH_LOGIN = process.env.TWITCH_CHANNEL || '${config.twitchChannel}';
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || '${config.youtubeChannelId}';

const WIDTH = Number(process.env.STREAM_WIDTH) || ${dims.width};
const HEIGHT = Number(process.env.STREAM_HEIGHT) || ${dims.height};
const FPS = Number(process.env.STREAM_FPS) || ${dims.fps};
const BITRATE_KBPS = Number(process.env.STREAM_BITRATE_KBPS) || ${config.bitrateKbps};
const VIDEO_CODEC = (process.env.STREAM_CODEC === 'VP8' ? 'VP8' : 'H264') as 'H264' | 'VP8';
const PROBE_INTERVAL_MS = (Number(process.env.TWITCH_PROBE_INTERVAL_SEC) || ${config.probeIntervalSec}) * 1000;
const SHUFFLE_YOUTUBE = process.env.SHUFFLE_YOUTUBE === 'true';
const SYNC_WEB_REGIE = process.env.SYNC_WEB_REGIE === 'true';
const WEB_REGIE_URL = (process.env.WEB_REGIE_URL || '${config.webRegieUrl}').replace(/\\/$/, '');

if (!DISCORD_TOKEN) {
  console.error('[ERREUR] Renseignez DISCORD_USER_TOKEN dans votre fichier .env avant de lancer le bot.');
  process.exit(1);
}

interface YouTubeItem {
  id: string;
  title: string;
}

const client = new Client();
const streamer = new Streamer(client);

let forcedMode: 'auto' | 'twitch' | 'youtube' = 'auto';
let manualYoutubeQueue: string[] = [];
let playlistIndex = 0;
let activeAbortController: AbortController | null = null;

async function isTwitchChannelLive(): Promise<{ live: boolean; title: string }> {
  try {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: \`query { user(login: "\${TWITCH_LOGIN}") { stream { id title type } } }\`,
      }),
    });
    const json = (await res.json()) as {
      data?: { user?: { stream?: { type?: string; title?: string } | null } };
    };
    const stream = json?.data?.user?.stream;
    return {
      live: Boolean(stream && stream.type === 'live'),
      title: stream?.title || \`Direct Twitch \${TWITCH_LOGIN}\`,
    };
  } catch (err) {
    console.warn('[Twitch Check] Erreur réseau temporaire:', err);
    return { live: false, title: '' };
  }
}

async function fetchJeanLucMelenchonYoutubeVideos(): Promise<YouTubeItem[]> {
  try {
    const res = await fetch(
      \`https://www.youtube.com/feeds/videos.xml?channel_id=\${YOUTUBE_CHANNEL_ID}\`
    );
    const xml = await res.text();
    const entries = xml.split('<entry>').slice(1);
    const videos: YouTubeItem[] = [];

    for (const entry of entries) {
      const id = entry.match(/<yt:videoId>([^<]+)<\\/yt:videoId>/)?.[1]?.trim();
      const title = entry.match(/<title>([^<]+)<\\/title>/)?.[1]?.trim() || 'Vidéo JLM';
      const views = Number(entry.match(/<media:statistics\\s+views="(\\d+)"/)?.[1] || '0');
      if (id && views > 0) {
        videos.push({ id, title });
      }
    }
    return videos;
  } catch (err) {
    console.error('[YouTube RSS] Impossible de récupérer le flux RSS:', err);
    return [];
  }
}

async function resolveTwitchStreamUrl(): Promise<string> {
  const { stdout } = await execFileAsync('streamlink', [
    '--stream-url',
    '--twitch-disable-ads',
    \`https://www.twitch.tv/\${TWITCH_LOGIN}\`,
    '${dims.streamlinkQuality}',
  ]);
  const url = stdout.trim();
  if (!url.startsWith('http')) {
    throw new Error('Aucun flux HLS Twitch retourné par Streamlink');
  }
  return url;
}

async function resolveYoutubeDirectUrl(youtubeWatchUrl: string): Promise<string> {
  const { stdout } = await execFileAsync('yt-dlp', [
    '-f',
    'best[height<=${dims.ytdlpHeight}][ext=mp4]/best[height<=${dims.ytdlpHeight}]/best',
    '--no-playlist',
    '-g',
    youtubeWatchUrl,
  ]);
  const firstLine = stdout.trim().split('\\n')[0]?.trim() || '';
  if (!firstLine.startsWith('http')) {
    throw new Error('Aucune URL média retournée par yt-dlp');
  }
  return firstLine;
}

function interruptCurrentStream() {
  if (activeAbortController) {
    activeAbortController.abort();
  }
}

async function broadcastMediaUrl(mediaUrl: string, label: string, interruptOnTwitchLive: boolean) {
  activeAbortController = new AbortController();
  const { signal } = activeAbortController;

  console.log(\`[Antenne H24] Diffusion en partage d'écran : \${label}\`);
  client.user?.setActivity(label, { type: 'WATCHING' });

  const { command, output } = prepareStream(
    mediaUrl,
    {
      width: WIDTH,
      height: HEIGHT,
      frameRate: FPS,
      bitrateVideo: BITRATE_KBPS,
      bitrateVideoMax: Math.round(BITRATE_KBPS * 1.35),
      videoCodec: VIDEO_CODEC,
      includeAudio: true,
      hardwareAcceleratedDecoding: false,
      minimizeLatency: true,
    },
    signal
  );

  // Surveillance parallèle de Twitch pendant la lecture d'une vidéo YouTube :
  // Dès que Jean-Luc Mélenchon passe en direct sur Twitch, on coupe immédiatement
  // la rediffusion YouTube pour basculer le partage d'écran Discord sur le live Twitch !
  let probeTimer: NodeJS.Timeout | undefined;
  if (interruptOnTwitchLive) {
    probeTimer = setInterval(async () => {
      if (forcedMode === 'youtube') return;
      const status = await isTwitchChannelLive();
      if (status.live) {
        console.log('[Priorité Direct] Live Twitch détecté ! Bascule immédiate du salon vocal...');
        interruptCurrentStream();
      }
    }, PROBE_INTERVAL_MS);
  }

  try {
    await playStream(output, streamer, { type: 'go-live' }, signal);
  } catch (err) {
    if (!signal.aborted) {
      console.warn('[FFmpeg / WebRTC] Flux interrompu :', err);
    }
  } finally {
    if (probeTimer) clearInterval(probeTimer);
    try {
      command?.kill('SIGINT');
    } catch {
      // Déjà arrêté
    }
  }
}

async function run24x7TelevisionLoop() {
  console.log(\`[Salon Vocal] Connexion H24 au serveur \${GUILD_ID} / salon \${VOICE_CHANNEL_ID}...\`);
  await streamer.joinVoice(GUILD_ID, VOICE_CHANNEL_ID);
  await streamer.createStream();

  while (true) {
    try {
      // 1. Synchronisation optionnelle avec la Régie Web
      if (SYNC_WEB_REGIE && WEB_REGIE_URL) {
        try {
          const res = await fetch(\`\${WEB_REGIE_URL}/api/tv/bot-directive\`);
          if (res.ok) {
            const directive = (await res.json()) as {
              activeSource: 'twitch' | 'youtube';
              twitchUrl: string;
              twitchTitle: string;
              youtubeUrl: string | null;
              youtubeTitle: string | null;
            };
            if (directive.activeSource === 'twitch') {
              const hlsUrl = await resolveTwitchStreamUrl();
              await broadcastMediaUrl(hlsUrl, \`DIRECT TWITCH : \${directive.twitchTitle}\`, false);
              continue;
            } else if (directive.youtubeUrl) {
              const directYt = await resolveYoutubeDirectUrl(directive.youtubeUrl);
              await broadcastMediaUrl(directYt, \`YOUTUBE JLM : \${directive.youtubeTitle}\`, true);
              continue;
            }
          }
        } catch {
          // Repli autonome si la régie web est injoignable
        }
      }

      // 2. Priorité au Direct Twitch https://www.twitch.tv/jlmelenchon
      if (forcedMode !== 'youtube') {
        const twitch = await isTwitchChannelLive();
        if (twitch.live || forcedMode === 'twitch') {
          const hlsUrl = await resolveTwitchStreamUrl();
          await broadcastMediaUrl(hlsUrl, \`EN DIRECT : \${twitch.title}\`, false);
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
      }

      // 3. Relais automatique sur les vidéos YouTube de Jean-Luc Mélenchon
      if (manualYoutubeQueue.length > 0) {
        const customUrl = manualYoutubeQueue.shift()!;
        const directUrl = await resolveYoutubeDirectUrl(customUrl);
        await broadcastMediaUrl(directUrl, 'PROGRAMME SPÉCIAL YOUTUBE', true);
        continue;
      }

      const videos = await fetchJeanLucMelenchonYoutubeVideos();
      if (videos.length === 0) {
        console.warn('[Grille YouTube] Aucune vidéo trouvée, nouvelle tentative dans 15s...');
        await new Promise((r) => setTimeout(r, 15_000));
        continue;
      }

      if (SHUFFLE_YOUTUBE && videos.length > 1) {
        playlistIndex = Math.floor(Math.random() * videos.length);
      } else {
        playlistIndex = playlistIndex % videos.length;
      }

      const selected = videos[playlistIndex];
      playlistIndex = (playlistIndex + 1) % videos.length;

      const watchUrl = \`https://www.youtube.com/watch?v=\${selected.id}\`;
      const directVideoUrl = await resolveYoutubeDirectUrl(watchUrl);
      await broadcastMediaUrl(directVideoUrl, \`REDIFFUSION JLM : \${selected.title}\`, true);
    } catch (loopErr) {
      console.error('[Boucle H24] Incident récupéré, reconnexion dans 5 secondes :', loopErr);
      await new Promise((r) => setTimeout(r, 5000));
      try {
        await streamer.joinVoice(GUILD_ID, VOICE_CHANNEL_ID);
      } catch {
        // Ignoré si déjà connecté
      }
    }
  }
}

// Commandes de contrôle dans le salon texte Discord (!tv skip, !tv auto, !tv play <url>)
client.on('messageCreate', async (msg) => {
  if (TEXT_CHANNEL_ID && msg.channel.id !== TEXT_CHANNEL_ID) return;
  if (!msg.content.startsWith('!tv')) return;

  const args = msg.content.trim().split(/\\s+/);
  const sub = args[1]?.toLowerCase();

  if (sub === 'skip') {
    interruptCurrentStream();
    await msg.reply('Passage immédiat au programme suivant.');
  } else if (sub === 'play' && args[2]) {
    manualYoutubeQueue.unshift(args[2]);
    interruptCurrentStream();
    await msg.reply(\`Vidéo ajoutée en tête d'antenne : \${args[2]}\`);
  } else if (sub === 'twitch') {
    forcedMode = 'twitch';
    interruptCurrentStream();
    await msg.reply('Forçage sur le flux Twitch jlmelenchon activé.');
  } else if (sub === 'youtube') {
    forcedMode = 'youtube';
    interruptCurrentStream();
    await msg.reply('Forçage sur la grille YouTube Jean-Luc Mélenchon activé.');
  } else if (sub === 'auto') {
    forcedMode = 'auto';
    interruptCurrentStream();
    await msg.reply('Mode automatique H24 activé (Priorité Direct Twitch + Relais YouTube).');
  } else {
    await msg.reply(
      'Commandes JLM TV H24 : \`!tv skip\` · \`!tv play <url_youtube>\` · \`!tv auto\` · \`!tv twitch\` · \`!tv youtube\`'
    );
  }
});

client.on('ready', () => {
  console.log(\`[JLM TV H24] Connecté sur Discord en tant que \${client.user?.tag}\`);
  void run24x7TelevisionLoop();
});

client.login(DISCORD_TOKEN);
`;

  const installScript = `#!/usr/bin/env bash
set -e

mkdir -p jlm-tv-discord-bot/src
cd jlm-tv-discord-bot

cat << 'EOF_PKG' > package.json
${packageJson}
EOF_PKG

cat << 'EOF_ENV' > .env.example
${envExample}
EOF_ENV

if [ ! -f .env ]; then
  cp .env.example .env
fi

cat << 'EOF_DOCKER' > Dockerfile
${dockerfile}
EOF_DOCKER

cat << 'EOF_COMPOSE' > docker-compose.yml
${dockerCompose}
EOF_COMPOSE

cat << 'EOF_BOT' > src/bot.ts
${botTs}
EOF_BOT

echo "Projet créé dans ./jlm-tv-discord-bot"
echo "1. Éditez ./jlm-tv-discord-bot/.env pour renseigner DISCORD_USER_TOKEN"
echo "2. Lancez : cd jlm-tv-discord-bot && docker compose up -d --build"
`;

  return {
    botTs,
    dockerfile,
    dockerCompose,
    packageJson,
    envExample,
    installScript,
  };
}
