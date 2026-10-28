import { useMemo, useState } from 'react';
import { Copy, Check, Download, Terminal } from 'lucide-react';
import type { BotConfigOptions } from '../types/broadcast';
import { generateDiscordBotFiles } from '../utils/botGenerator';

interface BotBuilderViewProps {
  config: BotConfigOptions;
  onChangeConfig: (next: BotConfigOptions) => void;
  onDownloadInstaller: () => void;
}

type CodeTab = 'botTs' | 'dockerfile' | 'dockerCompose' | 'envExample' | 'packageJson';

export function BotBuilderView({
  config,
  onChangeConfig,
  onDownloadInstaller,
}: BotBuilderViewProps) {
  const [activeFile, setActiveFile] = useState<CodeTab>('botTs');
  const [copied, setCopied] = useState<boolean>(false);

  const files = useMemo(() => generateDiscordBotFiles(config), [config]);

  const fileMeta: Record<CodeTab, { filename: string; content: string }> = {
    botTs: { filename: 'src/bot.ts', content: files.botTs },
    dockerfile: { filename: 'Dockerfile', content: files.dockerfile },
    dockerCompose: { filename: 'docker-compose.yml', content: files.dockerCompose },
    envExample: { filename: '.env.example', content: files.envExample },
    packageJson: { filename: 'package.json', content: files.packageJson },
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fileMeta[activeFile].content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored
    }
  };

  const handleDownloadSingleFile = () => {
    const current = fileMeta[activeFile];
    const blob = new Blob([current.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = current.filename.replace('/', '-');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-neutral-800">
        <div className="space-y-1.5 max-w-2xl">
          <h1 className="text-2xl sm:text-3xl font-semibold text-white">
            Configurateur du Bot Vocal Discord H24 (Go Live)
          </h1>
          <p className="text-sm text-neutral-400 leading-relaxed">
            Générez le worker Node.js + FFmpeg complet pour diffuser un partage d’écran continu dans
            votre salon vocal : bascule immédiate sur{' '}
            <span className="text-white font-mono">twitch.tv/jlmelenchon</span> dès qu’un live
            commence, et rotation automatique sur la grille vidéo le reste du temps.
          </p>
        </div>
        <button
          type="button"
          onClick={onDownloadInstaller}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>Télécharger le script d’installation H24 (.sh)</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Parameters Column */}
        <div className="lg:col-span-5 border border-white/15 bg-neutral-950 rounded-2xl p-6 space-y-6">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-white">Paramètres du salon & encodage</h2>
            <p className="text-xs text-neutral-400">
              Aucun jeton secret n’est demandé ici : vous renseignerez le token uniquement dans le
              fichier <span className="font-mono text-neutral-200">.env</span> sur votre serveur.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                ID du Serveur Discord (Guild ID)
              </label>
              <input
                type="text"
                value={config.guildId}
                onChange={(e) => onChangeConfig({ ...config, guildId: e.target.value })}
                placeholder="Ex. 108452910384756123"
                className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-black border border-neutral-800 rounded-xl text-white placeholder:text-neutral-600 focus:outline-none focus:border-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                ID du Salon Vocal TV H24 (Voice Channel ID)
              </label>
              <input
                type="text"
                value={config.voiceChannelId}
                onChange={(e) => onChangeConfig({ ...config, voiceChannelId: e.target.value })}
                placeholder="Ex. 108452910992837451"
                className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-black border border-neutral-800 rounded-xl text-white placeholder:text-neutral-600 focus:outline-none focus:border-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                ID du Salon Texte pour les commandes !tv (optionnel)
              </label>
              <input
                type="text"
                value={config.textChannelId}
                onChange={(e) => onChangeConfig({ ...config, textChannelId: e.target.value })}
                placeholder="Laisser vide pour écouter tous les salons"
                className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-black border border-neutral-800 rounded-xl text-white placeholder:text-neutral-600 focus:outline-none focus:border-white"
              />
            </div>

            <div className="pt-2 border-t border-neutral-800">
              <label className="block text-xs font-medium text-neutral-300 mb-2">
                Profil de résolution & fluidité Go Live
              </label>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-black border border-neutral-800 rounded-xl">
                {(
                  [
                    { id: '720p30', label: '720p · 30 fps' },
                    { id: '720p60', label: '720p · 60 fps' },
                    { id: '1080p60', label: '1080p · 60 fps' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      const nextBitrate =
                        preset.id === '1080p60' ? 6500 : preset.id === '720p60' ? 4500 : 3000;
                      onChangeConfig({
                        ...config,
                        resolutionPreset: preset.id,
                        bitrateKbps: nextBitrate,
                      });
                    }}
                    className={`px-2.5 py-2 text-xs font-mono tabular-nums rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      config.resolutionPreset === preset.id
                        ? 'bg-white text-black font-semibold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-neutral-500">
                720p · 30 fps fonctionne sur un compte standard sans abonnement Nitro. Les modes 60
                fps et 1080p requièrent Nitro sur le compte diffuseur.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                  Codec WebRTC
                </label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-black border border-neutral-800 rounded-xl">
                  {(['H264', 'VP8'] as const).map((codec) => (
                    <button
                      key={codec}
                      type="button"
                      onClick={() => onChangeConfig({ ...config, videoCodec: codec })}
                      className={`py-1.5 text-xs font-mono rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                        config.videoCodec === codec
                          ? 'bg-white text-black font-semibold'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {codec}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                  Débit vidéo (kbps)
                </label>
                <input
                  type="number"
                  min={1000}
                  max={9000}
                  step={500}
                  value={config.bitrateKbps}
                  onChange={(e) =>
                    onChangeConfig({
                      ...config,
                      bitrateKbps: Math.max(1000, Math.min(9000, Number(e.target.value) || 3000)),
                    })
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-black border border-neutral-800 rounded-xl text-white focus:outline-none focus:border-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                  Scan direct Twitch (sec)
                </label>
                <input
                  type="number"
                  min={15}
                  max={180}
                  step={5}
                  value={config.probeIntervalSec}
                  onChange={(e) =>
                    onChangeConfig({
                      ...config,
                      probeIntervalSec: Math.max(
                        15,
                        Math.min(180, Number(e.target.value) || 30)
                      ),
                    })
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-black border border-neutral-800 rounded-xl text-white focus:outline-none focus:border-white"
                />
              </div>

              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2.5 cursor-pointer py-2">
                  <input
                    type="checkbox"
                    checked={config.shuffleFallback}
                    onChange={(e) =>
                      onChangeConfig({ ...config, shuffleFallback: e.target.checked })
                    }
                    className="w-4 h-4 accent-white rounded"
                  />
                  <span className="text-xs text-neutral-300">Lecture aléatoire YouTube</span>
                </label>
              </div>
            </div>

            <div className="pt-3 border-t border-neutral-800 space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.syncWithWebRegie}
                  onChange={(e) =>
                    onChangeConfig({ ...config, syncWithWebRegie: e.target.checked })
                  }
                  className="w-4 h-4 accent-white rounded"
                />
                <span className="text-xs font-medium text-neutral-200">
                  Piloter le bot vocal depuis cette Régie Web en temps réel
                </span>
              </label>
              <p className="text-xs text-neutral-500 leading-relaxed">
                Lorsque cette option est activée, le bot interroge l’endpoint{' '}
                <span className="font-mono text-neutral-300">/api/tv/bot-directive</span> (ce qui
                maintient également l’instance Render active 24h/24).
              </p>
            </div>
          </div>
        </div>

        {/* Right Code Viewer Column */}
        <div className="lg:col-span-7 border border-white/15 bg-neutral-950 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-3 bg-black">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: 'botTs', label: 'src/bot.ts' },
                  { id: 'dockerfile', label: 'Dockerfile' },
                  { id: 'dockerCompose', label: 'docker-compose.yml' },
                  { id: 'envExample', label: '.env.example' },
                  { id: 'packageJson', label: 'package.json' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFile(tab.id)}
                  className={`px-3 py-1.5 text-xs font-mono rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeFile === tab.id
                      ? 'bg-white text-black font-semibold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-white shrink-0" />
                    <span>Copié</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 shrink-0" />
                    <span>Copier</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownloadSingleFile}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>Télécharger ce fichier</span>
              </button>
            </div>
          </div>

          <div className="p-6 bg-black overflow-x-auto max-h-[600px] overflow-y-auto">
            <pre className="text-xs font-mono text-neutral-200 leading-relaxed tabular-nums">
              <code>{fileMeta[activeFile].content}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
