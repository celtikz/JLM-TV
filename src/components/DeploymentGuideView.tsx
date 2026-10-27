import { useState } from 'react';
import { Download, Check, Copy, Server, Tv } from 'lucide-react';

const HARDWARE_IMG = '/src/assets/images/bot_pipeline_hardware_1793131336473.jpg';

interface DeploymentGuideViewProps {
  appOrigin: string;
  onDownloadInstaller: () => void;
  onSwitchTab: (tab: 'regie' | 'bot') => void;
}

export function DeploymentGuideView({
  appOrigin,
  onDownloadInstaller,
  onSwitchTab,
}: DeploymentGuideViewProps) {
  const [imgError, setImgError] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCmd(id);
      window.setTimeout(() => setCopiedCmd(null), 1800);
    } catch {
      // Ignored
    }
  };

  const quickDeployCommands = `sh install-jlm-tv-bot.sh
nano jlm-tv-discord-bot/.env
cd jlm-tv-discord-bot && docker compose up -d --build`;

  return (
    <div className="space-y-12">
      {/* Hero Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch pb-10 border-b border-slate-800">
        <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Architecture H24</span>
              <span aria-hidden="true">·</span>
              <span>Twitch jlmelenchon & YouTube @JLMelenchon</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-white">
              Deux méthodes pour diffuser la chaîne H24 dans votre salon vocal Discord
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
              Vous disposez à la fois du worker autonome de partage d’écran Go Live (FFmpeg +
              Streamlink + yt-dlp sous Docker) et de cette application web compatible avec le SDK
              officiel des Discord Activities pour regarder le flux en 1080p60 sans encodage serveur.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onDownloadInstaller}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Télécharger install-jlm-tv-bot.sh</span>
            </button>
            <button
              type="button"
              onClick={() => onSwitchTab('bot')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Personnaliser les IDs Discord</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-xl overflow-hidden border border-slate-800 bg-slate-900 min-h-[220px] relative">
          {!imgError ? (
            <img
              src={HARDWARE_IMG}
              alt="Unité serveur Linux dédiée à la diffusion continue FFmpeg et WebRTC"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-900 p-8">
              <Server className="w-10 h-10 text-slate-600" />
            </div>
          )}
        </div>
      </div>

      {/* Two Deployment Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Option 1: Docker Go Live Bot */}
        <section className="border border-slate-800 bg-slate-900/50 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-rose-400 font-medium">
              <Server className="w-4 h-4 shrink-0" />
              <span>Méthode 1 · Vrai partage d’écran Go Live H24</span>
            </div>
            <h2 className="text-xl font-semibold text-white">
              01. Déploiement Docker sur VPS Linux (2 vCPU / 2 Go RAM)
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Le conteneur embarque Node.js 22, FFmpeg, Streamlink et yt-dlp. Un compte Discord
              dédié rejoint votre salon vocal 24h/24 et lance un partage d’écran Go Live continu.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">
                Commandes d’installation rapide (Ubuntu / Debian)
              </span>
              <button
                type="button"
                onClick={() => copyText('deploy', quickDeployCommands)}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                {copiedCmd === 'deploy' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copié</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copier</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
              <code>{quickDeployCommands}</code>
            </pre>
          </div>

          <div className="space-y-2.5 pt-2 border-t border-slate-800/80 text-xs text-slate-300">
            <div className="font-medium text-white">Commandes disponibles dans Discord :</div>
            <div className="grid grid-cols-1 gap-2 font-mono">
              <div className="flex items-center justify-between gap-4 py-1 border-b border-slate-800/60">
                <span className="text-rose-400">!tv auto</span>
                <span className="font-sans text-slate-400 text-right">
                  Priorité Direct Twitch + relais YouTube auto
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 py-1 border-b border-slate-800/60">
                <span className="text-rose-400">!tv skip</span>
                <span className="font-sans text-slate-400 text-right">
                  Passer immédiatement à la vidéo YouTube suivante
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 py-1 border-b border-slate-800/60">
                <span className="text-rose-400">!tv play &lt;url&gt;</span>
                <span className="font-sans text-slate-400 text-right">
                  Lancer une vidéo YouTube précise en direct
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 py-1">
                <span className="text-rose-400">!tv youtube</span>
                <span className="font-sans text-slate-400 text-right">
                  Forcer la grille YouTube de Jean-Luc Mélenchon
                </span>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Rappel de sécurité : utilisez toujours un compte Discord secondaire dédié uniquement à
            la diffusion, car l’automatisation d’un compte utilisateur pour le Go Live n’est pas
            couverte par l’API Bot officielle de Discord.
          </p>
        </section>

        {/* Option 2: Official Discord Activity */}
        <section className="border border-slate-800 bg-slate-900/50 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
              <Tv className="w-4 h-4 shrink-0" />
              <span>Méthode 2 · Discord Activity Officielle (100 % conforme CGU)</span>
            </div>
            <h2 className="text-xl font-semibold text-white">
              02. Intégrer cette Régie Web comme Activité Vocale 1080p60
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Cette application intègre déjà <span className="font-mono">@discord/embedded-app-sdk</span>.
              Vous pouvez l’ouvrir directement comme une activité de salon vocal officielle, sans
              VPS FFmpeg ni risque de bannissement.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="font-medium text-slate-200">
              Table des URL Mappings (Discord Developer Portal → Activities) :
            </div>
            <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3 font-medium">Préfixe</th>
                    <th className="py-2.5 px-3 font-medium">Cible (Target)</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-slate-200 divide-y divide-slate-800/70">
                  <tr>
                    <td className="py-2.5 px-3 text-emerald-400">/</td>
                    <td className="py-2.5 px-3 truncate max-w-[240px]">
                      {appOrigin.replace(/^https?:\/\//, '')}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-emerald-400">/twitch-player</td>
                    <td className="py-2.5 px-3">player.twitch.tv</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-emerald-400">/youtube-embed</td>
                    <td className="py-2.5 px-3">www.youtube.com</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-800/80 text-sm text-slate-300">
            <p className="text-xs text-slate-400 leading-relaxed">
              Tous les membres qui rejoignent l’activité dans le salon vocal sont synchronisés à la
              seconde près via WebSocket : même vidéo YouTube au même timecode, et bascule
              automatique dès que <span className="font-mono text-slate-200">jlmelenchon</span>{' '}
              lance un live Twitch.
            </p>
            <button
              type="button"
              onClick={() => onSwitchTab('regie')}
              className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Ouvrir le moniteur d’antenne en direct
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
