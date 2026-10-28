import type { ProgramTheme, VideoChapter, YouTubeVideoItem } from '../types/broadcast.ts';

export interface ThemeDefinition {
  id: ProgramTheme;
  label: string;
  shortLabel: string;
}

export const PROGRAM_THEMES: ThemeDefinition[] = [
  { id: 'entretiens', label: 'Entretiens & Plateaux TV', shortLabel: 'Entretien TV' },
  { id: 'meetings', label: 'Meetings & Grands Discours', shortLabel: 'Meeting' },
  { id: 'conferences', label: 'Conférences & Universités', shortLabel: 'Conférence' },
  { id: 'assemblee', label: 'Presse & Assemblée', shortLabel: 'Point presse' },
  { id: 'international', label: 'International & Géopolitique', shortLabel: 'International' },
];

export function getThemeDefinition(theme?: ProgramTheme): ThemeDefinition {
  return PROGRAM_THEMES.find((t) => t.id === theme) || PROGRAM_THEMES[2];
}

export function classifyProgramTheme(title: string, description = ''): ProgramTheme {
  const haystack = `${title} ${description.slice(0, 350)}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (
    /\b(conference de presse|point presse|assemblee|hemicycle|commission|coquerel|panot|bompard|trouve|groupe parlementaire|motion de censure|budget)\b/.test(
      haystack
    )
  ) {
    return 'assemblee';
  }

  if (
    /\b(international|geopolitique|diplomatie|onu|gaza|palestine|liban|ukraine|amerique latine|bresil|mexique|colombie|francophonie|paix dans le monde)\b/.test(
      haystack
    )
  ) {
    return 'international';
  }

  if (/\b(meeting|rassemblement|marche pour|place de la|clermont|marseille|toulouse|lille|lyon|nantes)\b/.test(haystack)) {
    return 'meetings';
  }

  if (
    /\b(entretien|interview|discussion|sans filtre|lenglet|tf1|bfm|lci|france 2|france inter|franceinfo|mediapart|blast|quotidien|face a|invite|20h|presidentielle)\b/.test(
      haystack
    )
  ) {
    return 'entretiens';
  }

  if (/\b(conference|hec|sciences po|universite|amphi|institut|debats|moment politique|lecon)\b/.test(haystack)) {
    return 'conferences';
  }

  return 'entretiens';
}

export const CURATED_VIDEO_CHAPTERS: Record<string, VideoChapter[]> = {
  '5qS3PZkpC64': [
    { startSeconds: 0, title: 'Ouverture & cadrage politique' },
    { startSeconds: 860, title: 'Pouvoir d’achat, salaires et partage de la valeur' },
    { startSeconds: 2200, title: 'Fiscalité, dette publique et bifurquer l’économie' },
    { startSeconds: 3495, title: 'Services publics, école, santé et planification écologique' },
    { startSeconds: 4920, title: 'Crises internationales, droit international et paix' },
    { startSeconds: 6510, title: 'Institutions, VIe République et cap 2027' },
    { startSeconds: 7800, title: 'Questions directes & conclusion' },
  ],
  'vod-2906055180': [
    { startSeconds: 0, title: 'Pré-générique antenne' },
    { startSeconds: 720, title: 'Introduction : analyse du moment politique' },
    { startSeconds: 1980, title: 'Rapport de force social et institutionnel' },
    { startSeconds: 3540, title: 'Perspectives économiques et écologiques' },
    { startSeconds: 4980, title: 'Mobilisation populaire & conclusion' },
  ],
  'vod-2900414335': [
    { startSeconds: 0, title: 'Mise en place de la conférence de presse' },
    { startSeconds: 720, title: 'Prise de parole liminaire sur le budget' },
    { startSeconds: 2040, title: 'Intervention d’Éric Coquerel — Finances publiques' },
    { startSeconds: 3360, title: 'Questions des journalistes & réponses' },
  ],
  'vod-2897888840': [
    { startSeconds: 0, title: 'Ambiance salle & avant-meeting à Clermont-Ferrand' },
    { startSeconds: 720, title: 'Entrée sur scène & salutations républicaines' },
    { startSeconds: 1860, title: 'Urgence sociale, salaires et services publics' },
    { startSeconds: 3480, title: 'Bifurcation écologique et souveraineté populaire' },
    { startSeconds: 4860, title: 'Appel à l’action citoyenne & Marseillaise' },
  ],
  'vod-2892736786': [
    { startSeconds: 0, title: 'Accueil par les étudiants d’HEC Débats' },
    { startSeconds: 720, title: 'Exposé liminaire de Jean-Luc Mélenchon' },
    { startSeconds: 2520, title: 'Économie, entreprise et planification écologique' },
    { startSeconds: 4560, title: 'Géopolitique, Europe et non-alignement' },
    { startSeconds: 6240, title: 'Questions-réponses avec l’amphithéâtre' },
  ],
  'vod-2889055110': [
    { startSeconds: 0, title: 'Ouverture du direct' },
    { startSeconds: 720, title: 'État des lieux de la situation politique' },
    { startSeconds: 2160, title: 'Enjeux parlementaires et sociaux' },
    { startSeconds: 3480, title: 'Synthèse et perspectives' },
  ],
};

export function parseDescriptionChapters(
  description: string,
  durationSeconds: number
): VideoChapter[] {
  if (!description) return [];
  const lines = description.split(/\r?\n/);
  const parsed: VideoChapter[] = [];
  const seenTimes = new Set<number>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(
      /^(?:[-•*]\s*)?(?:\[|\()?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\]|\))?\s*(?:[-–—:|]\s*|\s+)(.+)$/
    );
    if (!match) continue;

    const hasHours = match[3] !== undefined;
    const sec = hasHours
      ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      : Number(match[1]) * 60 + Number(match[2]);

    const cleanTitle = match[4].replace(/^[-–—:|•]+\s*/, '').trim();
    if (
      cleanTitle.length >= 2 &&
      sec >= 0 &&
      (durationSeconds <= 0 || sec < durationSeconds - 5) &&
      !seenTimes.has(sec)
    ) {
      seenTimes.add(sec);
      parsed.push({ startSeconds: sec, title: cleanTitle.slice(0, 90) });
    }
  }

  parsed.sort((a, b) => a.startSeconds - b.startSeconds);
  if (parsed.length >= 2) {
    if (parsed[0].startSeconds > 15) {
      parsed.unshift({ startSeconds: 0, title: 'Introduction' });
    } else {
      parsed[0].startSeconds = 0;
    }
    return parsed;
  }
  return [];
}

const THEME_FALLBACK_LABELS: Record<ProgramTheme, string[]> = {
  entretiens: [
    'Ouverture de l’entretien',
    'Situation politique & sociale',
    'Économie, travail et services publics',
    'Questions internationales & institutions',
    'Dernières questions & conclusion',
  ],
  meetings: [
    'Ouverture du meeting',
    'Diagnostic social et démocratique',
    'Programme économique et écologique',
    'Souveraineté, paix et international',
    'Conclusion & appel à la mobilisation',
  ],
  conferences: [
    'Introduction de la conférence',
    'Cadre théorique et historique',
    'Analyse des enjeux contemporains',
    'Échanges et approfondissements',
    'Synthèse finale',
  ],
  assemblee: [
    'Ouverture du point presse',
    'Présentation des propositions',
    'Analyse budgétaire et législative',
    'Questions de la presse & conclusion',
  ],
  international: [
    'Introduction géopolitique',
    'Droit international et diplomatie',
    'Non-alignement et coopération',
    'Perspectives pour la paix & conclusion',
  ],
};

export function ensureVideoChapters(opts: {
  id: string;
  title: string;
  durationSeconds: number;
  theme: ProgramTheme;
  twitchVodId?: string;
  rawChapters?: VideoChapter[];
  description?: string;
}): VideoChapter[] {
  const curated = CURATED_VIDEO_CHAPTERS[opts.id];
  if (curated && curated.length > 0) {
    return curated;
  }

  if (opts.rawChapters && opts.rawChapters.length >= 2) {
    const sorted = [...opts.rawChapters]
      .filter((c) => c.startSeconds >= 0 && c.title.trim().length > 0)
      .sort((a, b) => a.startSeconds - b.startSeconds);
    if (sorted.length >= 2) {
      if (sorted[0].startSeconds > 15) {
        sorted.unshift({ startSeconds: 0, title: 'Introduction' });
      } else {
        sorted[0] = { ...sorted[0], startSeconds: 0 };
      }
      return sorted;
    }
  }

  if (opts.description) {
    const fromDesc = parseDescriptionChapters(opts.description, opts.durationSeconds);
    if (fromDesc.length >= 2) return fromDesc;
  }

  const dur = Math.max(0, Math.round(opts.durationSeconds));
  if (dur < 360) {
    return [{ startSeconds: 0, title: opts.title.slice(0, 70) || 'Programme intégral' }];
  }

  const labels = THEME_FALLBACK_LABELS[opts.theme] || THEME_FALLBACK_LABELS.entretiens;
  const hasTwitchPreRoll = Boolean(opts.twitchVodId && dur >= 2400);
  const effectiveStart = hasTwitchPreRoll ? 720 : 0;
  const activeSpan = Math.max(300, dur - effectiveStart);

  const count = dur >= 3600 ? 5 : dur >= 1500 ? 4 : 3;
  const selectedLabels = labels.slice(0, count);
  const chapters: VideoChapter[] = [];

  if (hasTwitchPreRoll) {
    chapters.push({ startSeconds: 0, title: 'Carton d’attente antenne' });
  }

  for (let i = 0; i < selectedLabels.length; i += 1) {
    const startSec =
      i === 0
        ? effectiveStart
        : Math.round(effectiveStart + (activeSpan * i) / selectedLabels.length);
    chapters.push({
      startSeconds: startSec,
      title: selectedLabels[i],
    });
  }

  return chapters;
}

export function getActiveChapterInfo(
  chapters: VideoChapter[] | undefined,
  positionSeconds: number
): {
  index: number;
  total: number;
  current: VideoChapter;
  next: VideoChapter | null;
} | null {
  if (!chapters || chapters.length === 0) return null;
  let activeIdx = 0;
  for (let i = 0; i < chapters.length; i += 1) {
    if (positionSeconds >= chapters[i].startSeconds) {
      activeIdx = i;
    } else {
      break;
    }
  }
  return {
    index: activeIdx,
    total: chapters.length,
    current: chapters[activeIdx],
    next: chapters[activeIdx + 1] || null,
  };
}

export function getEffectiveOutroTrimSeconds(video: YouTubeVideoItem | null): number {
  if (!video) return 0;
  return video.twitchVodId && video.durationSeconds >= 1200 ? 90 : 0;
}

export function formatBroadcastHour(timestampMs: number): string {
  const d = new Date(timestampMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}H${mm}`;
}

export function formatTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
