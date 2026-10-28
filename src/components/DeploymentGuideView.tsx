import { useState } from 'react';
import { Download, Check, Copy, Server, Tv, RefreshCw, Activity } from 'lucide-react';
import type { KeepAliveStats } from '../types/broadcast';

const HARDWARE_IMG = '/src/assets/images/bot_pipeline_hardware_1793131336473.jpg';

function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(rem).padStart(2, '0')}s`;
  return `${rem}s`;
}

interface DeploymentGuideViewProps {
  appOrigin: string;
  keepAlive: KeepAliveStats;
  isPingingKeepAlive: boolean;
  onPingKeepAlive: () => void;
  onDownloadInstaller: () => void;
  onSwitchTab: (tab: 'regie' | 'bot') => void;
}

export function DeploymentGuideView({
  appOrigin,
  keepAlive,
  isPingingKeepAlive,
  onPingKeepAlive,
  onDownloadInstaller,
  onSwitchTab,
}: DeploymentGuideViewProps) {
  const [imgError, setImgError] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const healthUrl = keepAlive.targetUrl || `${appOrigin.replace(/\/+$/, '')}/api/health`;

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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch pb-10 border-b border-neutral-800">
        <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span>Architecture H24</span>
              <span aria-hidden="true">·</span>
              <span>Anti-Veille Render Intégré</span>
              <span aria-hidden="true">·</span>
              <span>Discord Activity & Bot Go Live</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-white">
              Diffusion continue 24h/24 sur Render et Discord sans mise en veille
            </h1>
            <p className="text-sm sm:text-base text-neutral-300 leading-relaxed max-w-2xl">
              Votre serveur embarque désormais un module anti-veille automatique (watchdog interne
              toutes les 4 minutes + bot GitHub Actions toutes les 10 minutes sur{' '}
              <span className="font-mono text-white">/api/health</span>) pour empêcher Render de
              s’éteindre après 15 minutes d’inactivité.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onDownloadInstaller}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Télécharger install-jlm-tv-bot.sh</span>
            </button>
            <button
              type="button"
              onClick={() => onSwitchTab('bot')}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Personnaliser les IDs Discord</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl overflow-hidden border border-white/15 bg-neutral-950 min-h-[220px] relative">
          {!imgError ? (
            <img
              src={HARDWARE_IMG}
              alt="Unité serveur Linux dédiée à la diffusion continue FFmpeg et WebRTC"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover grayscale"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-neutral-950 p-8">
              <Server className="w-10 h-10 text-neutral-600" />
            </div>
          )}
        </div>
      </div>

      {/* Render Anti-Sleep Keep-Alive Control Section */}
      <section className="border border-white/15 bg-neutral-950 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-neutral-800">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <Activity className="w-4 h-4 text-white shrink-0" />
              <span>Protection Anti-Veille Render H24</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-neutral-200">
                Uptime continu : {formatUptime(keepAlive.uptimeSeconds)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-neutral-300">
                {keepAlive.pingCount} signaux d’activité envoyés
              </span>
            </div>
            <h2 className="text-xl font-semibold text-white">
              Maintien en ligne permanent sur Render (Zéro Cold-Start)
            </h2>
          </div>

          <button
            type="button"
            onClick={onPingKeepAlive}
            disabled={isPingingKeepAlive}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isPingingKeepAlive ? 'animate-spin' : ''}`} />
            <span>{isPingingKeepAlive ? 'Envoi...' : 'Simuler une activité maintenant'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-sm">
          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-white">
              1. Double Bot Anti-Veille déjà inclus dans votre projet
            </h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Le serveur interroge automatiquement sa propre URL publique toutes les{' '}
              <strong className="text-white font-mono">4 minutes</strong>, et le workflow{' '}
              <span className="font-mono text-neutral-200">
                .github/workflows/keep-alive-render.yml
              </span>{' '}
              envoie une requête externe depuis GitHub toutes les{' '}
              <strong className="text-white font-mono">10 minutes</strong> dès que vous poussez le
              code sur votre dépôt GitHub relié à Render.
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">
                2. URL de santé publique (compatible cron-job.org / UptimeRobot)
              </span>
              <button
                type="button"
                onClick={() => copyText('health', healthUrl)}
                className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {copiedCmd === 'health' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-white" />
                    <span>Copié</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copier l’URL</span>
                  </>
                )}
              </button>
            </div>
            <div className="px-4 py-2.5 rounded-xl bg-black border border-neutral-800 text-xs font-mono text-neutral-200 truncate">
              {healthUrl}
            </div>
            <p className="text-xs text-neutral-500">
              Pour une redondance maximale (100 % gratuit), collez aussi cette URL sur cron-job.org
              avec un intervalle de 5 minutes.
            </p>
          </div>
        </div>
      </section>

      {/* Two Deployment Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Option 1: Docker Go Live Bot */}
        <section className="border border-white/15 bg-neutral-950 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-neutral-300 font-medium">
              <Server className="w-4 h-4 shrink-0" />
              <span>Méthode 1 · Vrai partage d’écran Go Live H24</span>
            </div>
            <h2 className="text-xl font-semibold text-white">
              01. Déploiement Docker sur VPS Linux (2 vCPU / 2 Go RAM)
            </h2>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Le conteneur embarque Node.js 22, FFmpeg, Streamlink et yt-dlp. Un compte Discord
              dédié rejoint votre salon vocal 24h/24 et lance un partage d’écran Go Live continu.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-300">
                Commandes d’installation rapide (Ubuntu / Debian)
              </span>
              <button
                type="button"
                onClick={() => copyText('deploy', quickDeployCommands)}
                className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {copiedCmd === 'deploy' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-white" />
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
            <pre className="p-4 rounded-xl bg-black border border-neutral-800 text-xs font-mono text-neutral-200 overflow-x-auto leading-relaxed">
              <code>{quickDeployCommands}</code>
            </pre>
          </div>

          <div className="space-y-2.5 pt-2 border-t border-neutral-800 text-xs text-neutral-300">
            <div className="font-medium text-white">Commandes disponibles dans Discord :</div>
            <div className="grid grid-cols-1 gap-2 font-mono">
              <div className="flex items-center justify-between gap-4 py-1.5 border-b border-neutral-800/80">
                <span className="text-white font-semibold">!tv auto</span>
                <span className="font-sans text-neutral-400 text-right">
                  Priorité Direct Twitch + relais YouTube auto
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 py-1.5 border-b border-neutral-800/80">
                <span className="text-white font-semibold">!tv skip</span>
                <span className="font-sans text-neutral-400 text-right">
                  Passer immédiatement à la vidéo YouTube suivante
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 py-1.5 border-b border-neutral-800/80">
                <span className="text-white font-semibold">!tv play &lt;url&gt;</span>
                <span className="font-sans text-neutral-400 text-right">
                  Lancer une vidéo YouTube précise en direct
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 py-1.5">
                <span className="text-white font-semibold">!tv youtube</span>
                <span className="font-sans text-neutral-400 text-right">
                  Forcer la grille YouTube de Jean-Luc Mélenchon
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Option 2: Official Discord Activity */}
        <section className="border border-white/15 bg-neutral-950 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-neutral-300 font-medium">
              <Tv className="w-4 h-4 shrink-0" />
              <span>Méthode 2 · Discord Activity Officielle (100 % conforme CGU)</span>
            </div>
            <h2 className="text-xl font-semibold text-white">
              02. Intégrer cette Régie Web comme Activité Vocale 1080p60
            </h2>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Cette application intègre <span className="font-mono text-neutral-200">@discord/embedded-app-sdk</span>.
              Ouvrez-la directement comme activité de salon vocal officielle, avec chapitrage,
              bandeau TV toutes les 10 minutes et ajout de vidéos YouTube/Twitch en direct.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="font-medium text-neutral-200">
              Table des URL Mappings (Discord Developer Portal → Activities) :
            </div>
            <div className="border border-neutral-800 rounded-xl overflow-hidden bg-black">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-800 text-neutral-400">
                    <th className="py-2.5 px-3 font-medium">Préfixe</th>
                    <th className="py-2.5 px-3 font-medium">Cible (Target)</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-neutral-200 divide-y divide-neutral-800/80">
                  <tr>
                    <td className="py-2.5 px-3 text-white font-semibold">/</td>
                    <td className="py-2.5 px-3 truncate max-w-[240px]">
                      {appOrigin.replace(/^https?:\/\//, '')}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-white font-semibold">/twitch-player</td>
                    <td className="py-2.5 px-3">player.twitch.tv</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-white font-semibold">/youtube-embed</td>
                    <td className="py-2.5 px-3">www.youtube.com</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-neutral-800 text-sm text-neutral-300">
            <p className="text-xs text-neutral-400 leading-relaxed">
              Tous les membres qui rejoignent l’activité dans le salon vocal sont synchronisés à la
              seconde près via WebSocket : même vidéo au même timecode, chapitrage interactif et
              bascule automatique dès que <span className="font-mono text-white">jlmelenchon</span>{' '}
              lance un live Twitch.
            </p>
            <button
              type="button"
              onClick={() => onSwitchTab('regie')}
              className="px-4 py-2.5 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Ouvrir le moniteur d’antenne en direct
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
