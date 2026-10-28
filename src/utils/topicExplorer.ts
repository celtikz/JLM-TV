import type { VideoChapter, YouTubeVideoItem } from '../types/broadcast.ts';
import { isSyntheticChapterList } from './programMetadata.ts';

export type DocumentaryTopicId =
  | 'economie-salaires'
  | 'fiscalite-budget'
  | 'ecologie-energie'
  | 'services-publics'
  | 'institutions-democratie'
  | 'international-paix'
  | 'republique-luttes'
  | 'medias-culture';

export interface DocumentaryTopic {
  id: DocumentaryTopicId;
  label: string;
  shortLabel: string;
  description: string;
  keywords: string[];
}

export interface TopicVideoSegment {
  id: string;
  video: YouTubeVideoItem;
  chapter: VideoChapter;
  chapterIndex: number;
  endSeconds: number;
  segmentDurationSeconds: number;
  topics: DocumentaryTopicId[];
  isRealChapter: boolean;
}

export const DOCUMENTARY_TOPICS: DocumentaryTopic[] = [
  {
    id: 'economie-salaires',
    label: 'Salaires, Pouvoir d’achat & Retraites',
    shortLabel: 'Salaires & Retraites',
    description:
      'SMIC, partage de la valeur, retraites à 60-62 ans, blocage des prix, travail et protection sociale.',
    keywords: [
      'salaire',
      'smic',
      'pouvoir d achat',
      'vie chere',
      'retraite',
      'travail',
      'emploi',
      'chomage',
      'syndic',
      'intersyndicale',
      'manifestation',
      'secu',
      'securite sociale',
      'cotisation',
      'net contre le brut',
      'net et le brut',
      'medef',
      'offre',
      'carnet de commandes',
      'urgence sociale',
      'classes populaires',
      'classes travailleuses',
      'clouet',
    ],
  },
  {
    id: 'fiscalite-budget',
    label: 'Fiscalité, Budget & Économie',
    shortLabel: 'Budget & Fiscalité',
    description:
      'Impôt juste, taxation des superprofits, budget de l’État, dette publique, industrie et souveraineté économique.',
    keywords: [
      'budget',
      'contre-budget',
      'fiscalite',
      'impot',
      'taxer',
      'superprofit',
      'milliardaire',
      'dette',
      'deficit',
      'austerite',
      'recession',
      'depenses',
      'coquerel',
      'capitalisme',
      'economi',
      'guerre economique',
      'libre-echange',
      'protectionnisme',
      'industrie',
      'desindustrialisation',
      'entreprise',
      'tpe',
      'pme',
      'artisan',
      'programme l avenir en commun',
    ],
  },
  {
    id: 'ecologie-energie',
    label: 'Écologie, Énergie & Planification',
    shortLabel: 'Écologie & Énergie',
    description:
      'Bifurcation écologique, climat, cycle de l’eau, énergie, agriculture vivrière, biodiversité et science.',
    keywords: [
      'ecologi',
      'climat',
      'planification',
      'bifurcation',
      'energie',
      'energetique',
      'eau',
      'carburant',
      'electricite',
      'nucleaire',
      'agriculture',
      'paysannerie',
      'alimentaire',
      'abeille',
      'biodiversite',
      'ecosysteme',
      'productivisme',
      'science',
      'spatiale',
      'espace',
      'technique',
      'guette',
    ],
  },
  {
    id: 'services-publics',
    label: 'Services publics, Santé, École & Logement',
    shortLabel: 'Services publics',
    description:
      'Hôpital public, Éducation nationale, universités, jeunesse, transports, urbanisme et droit au logement.',
    keywords: [
      'service public',
      'services publics',
      'hopital',
      'sante',
      'ecole',
      'education',
      'universite',
      'etudiant',
      'hec',
      'essec',
      'jeunesse',
      'generation',
      'logement',
      'villes',
      'urbanisme',
      'metropolisation',
      'batiment',
      'outre-mer',
      'trouve',
    ],
  },
  {
    id: 'institutions-democratie',
    label: 'VIe République, Institutions & Stratégie',
    shortLabel: 'VIe République',
    description:
      'Assemblée constituante, VIe République, parlement, élections, abstention, révolutions citoyennes et gauche.',
    keywords: [
      'vie republique',
      '6e republique',
      'constituante',
      'assemblees citoyennes',
      'assemblee',
      'institution',
      'president',
      'election',
      'legislatives',
      'premier tour',
      'second tour',
      'abstention',
      'gauche',
      'france insoumise',
      'insoumission',
      'parti socialiste',
      'nouveau front populaire',
      'union populaire',
      'revolution',
      '1848',
      '49.3',
      'motion de censure',
      'macron',
      'larcher',
      'democratie',
      'separation des pouvoirs',
      'panot',
      'bompard',
    ],
  },
  {
    id: 'international-paix',
    label: 'Géopolitique, Gaza, Europe & Paix',
    shortLabel: 'Géopolitique & Paix',
    description:
      'Droit international, Palestine et Gaza, Ukraine et Russie, Union européenne, non-alignement, BRICS et ONU.',
    keywords: [
      'geopolitique',
      'international',
      'gaza',
      'palestine',
      'palestinien',
      'paix',
      'guerre',
      'bellig',
      'russie',
      'ukraine',
      'armenie',
      'onu',
      'diplomatie',
      'non-alignement',
      'non-alignee',
      'politique etrangere',
      'union europeenne',
      'europe',
      'etats-unis',
      'chine',
      'brics',
      'multipolaire',
      'imperialisme',
      'lula',
      'maroc',
      'francophonie',
    ],
  },
  {
    id: 'republique-luttes',
    label: 'Antiracisme, Libertés publiques & Société',
    shortLabel: 'Société & Libertés',
    description:
      'Lutte contre le racisme et l’islamophobie, laïcité, libertés publiques, justice, immigration et solidarités.',
    keywords: [
      'racisme',
      'raciste',
      'antiracisme',
      'islamophobie',
      'discriminations',
      'laicite',
      'universalisme',
      'immigration',
      'migratoire',
      'identite',
      'creolisation',
      'polarise',
      'haine',
      'extreme droite',
      'antifasciste',
      'repression',
      'libertes',
      'etat de droit',
      'justice',
      'morale',
      'ethique',
      'dignite',
      'demographie',
      'luttes de masse',
      'nouvelle france',
    ],
  },
  {
    id: 'medias-culture',
    label: 'Médias, Numérique, Histoire & Culture',
    shortLabel: 'Médias & Culture',
    description:
      'Critique des médias concentrés, réseaux sociaux, intelligence artificielle, histoire, marxisme et littérature.',
    keywords: [
      'media',
      'journaliste',
      'pluralisme',
      'reseaux sociaux',
      'intelligence artificielle',
      'ia ',
      'algorithme',
      'robotique',
      'vivatech',
      'numerique',
      'science-fiction',
      'blade runner',
      'litterature',
      'poesie',
      'poeme',
      'theatre',
      'avignon',
      'intermittent',
      'artistes',
      'humanisme',
      'marxisme',
      'materialisme',
      'histoire',
      'culture',
      'bataille culturelle',
      'education populaire',
      'coulisses',
      'hologramme',
      'testament',
    ],
  },
];

export const QUICK_RESEARCH_KEYWORDS: string[] = [
  'SMIC & salaires',
  'Retraites',
  'TPE-PME & fiscalité',
  'Budget & dette',
  'Planification écologique',
  'Gaza & paix',
  'VIe République',
  'Services publics',
  'Union européenne',
  'Médias',
  'Intelligence artificielle',
  'Coulisses & Vlogs',
];

function normalizeSearchText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STRUCTURAL_FILLER_TITLES = new Set<string>([
  'intro',
  'introduction',
  'conclusion',
  'fin',
  'zapping',
  'pre-generique antenne',
  'carton d attente antenne',
  'ouverture du direct',
  'mise en place de la conference de presse',
  'reponses aux questions',
  'questions directes conclusion',
]);

function isStructuralFillerChapter(title: string): boolean {
  const norm = normalizeSearchText(title);
  if (STRUCTURAL_FILLER_TITLES.has(norm)) return true;
  if (/^(intro|introduction|conclusion|avant-meeting|accueil par les)/.test(norm) && norm.length < 34) {
    return true;
  }
  return false;
}

export function classifySegmentTopics(
  chapterTitle: string,
  videoTitle: string,
  includeVideoContext = false
): DocumentaryTopicId[] {
  const normChapter = ` ${normalizeSearchText(chapterTitle)} `;
  const normVideo = ` ${normalizeSearchText(videoTitle)} `;
  const matched: Array<{ id: DocumentaryTopicId; score: number }> = [];

  for (const topic of DOCUMENTARY_TOPICS) {
    let score = 0;
    for (const kw of topic.keywords) {
      const normKw = normalizeSearchText(kw);
      if (!normKw) continue;
      if (normChapter.includes(normKw)) {
        score += 4;
      } else if (includeVideoContext && normVideo.includes(normKw)) {
        score += 1;
      }
    }
    if (score >= (includeVideoContext ? 1 : 4)) {
      matched.push({ id: topic.id, score });
    }
  }

  matched.sort((a, b) => b.score - a.score);
  return matched.map((m) => m.id);
}

/**
 * Indexes all substantive chapters across the entire video catalog into
 * individually playable timecoded documentary segments.
 */
export function buildTopicSegments(playlist: YouTubeVideoItem[]): TopicVideoSegment[] {
  const segments: TopicVideoSegment[] = [];

  for (const video of playlist) {
    if (video.twitchChannelLogin) continue; // Live Twitch relay has no fixed VOD timecode
    const chapters = video.chapters || [];
    if (chapters.length === 0) continue;

    const synthetic = isSyntheticChapterList(chapters);

    if (synthetic) {
      // For unchaptered videos, expose a single entry segment anchored on the video's own subject
      const entryChap =
        chapters.find((c) => c.title !== 'Carton d’attente antenne') || chapters[0];
      const videoTopics = classifySegmentTopics(video.title, video.title, true);
      if (videoTopics.length > 0) {
        const endSec = Math.max(entryChap.startSeconds + 60, video.durationSeconds);
        segments.push({
          id: `${video.id}@${entryChap.startSeconds}`,
          video,
          chapter: {
            startSeconds: entryChap.startSeconds,
            title: video.title,
          },
          chapterIndex: 0,
          endSeconds: endSec,
          segmentDurationSeconds: Math.max(60, endSec - entryChap.startSeconds),
          topics: videoTopics.slice(0, 2),
          isRealChapter: false,
        });
      }
      continue;
    }

    for (let i = 0; i < chapters.length; i += 1) {
      const chap = chapters[i];
      if (chapters.length > 1 && isStructuralFillerChapter(chap.title)) {
        continue;
      }

      const nextStart =
        i + 1 < chapters.length ? chapters[i + 1].startSeconds : video.durationSeconds;
      const endSec = Math.max(chap.startSeconds + 30, nextStart);
      const segDur = Math.max(30, endSec - chap.startSeconds);

      let topics = classifySegmentTopics(chap.title, video.title, false);
      if (topics.length === 0) {
        topics = classifySegmentTopics(chap.title, video.title, true).slice(0, 1);
      }

      segments.push({
        id: `${video.id}@${chap.startSeconds}`,
        video,
        chapter: chap,
        chapterIndex: i,
        endSeconds: endSec,
        segmentDurationSeconds: segDur,
        topics,
        isRealChapter: true,
      });
    }
  }

  return segments;
}

export function getTopicSegmentCounts(
  segments: TopicVideoSegment[]
): Record<DocumentaryTopicId, number> {
  const counts: Record<DocumentaryTopicId, number> = {
    'economie-salaires': 0,
    'fiscalite-budget': 0,
    'ecologie-energie': 0,
    'services-publics': 0,
    'institutions-democratie': 0,
    'international-paix': 0,
    'republique-luttes': 0,
    'medias-culture': 0,
  };

  for (const seg of segments) {
    for (const t of seg.topics) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }

  return counts;
}

export function filterTopicSegments(
  segments: TopicVideoSegment[],
  selectedTopic: DocumentaryTopicId | 'all',
  rawQuery: string
): TopicVideoSegment[] {
  const cleanQuery = normalizeSearchText(rawQuery.replace(/&/g, ' '));
  const queryTokens = cleanQuery
    .split(' ')
    .filter((tok) => tok.length >= 2 && !['les', 'des', 'sur', 'dans', 'pour', 'avec'].includes(tok));

  const scored: Array<{ seg: TopicVideoSegment; score: number }> = [];

  for (const seg of segments) {
    if (selectedTopic !== 'all' && !seg.topics.includes(selectedTopic)) {
      continue;
    }

    if (queryTokens.length === 0) {
      const baseScore =
        (seg.isRealChapter ? 100 : 10) + Math.min(40, Math.log10(Math.max(10, seg.video.views)) * 6);
      scored.push({ seg, score: baseScore });
      continue;
    }

    const normChap = normalizeSearchText(seg.chapter.title);
    const normVid = normalizeSearchText(seg.video.title);
    let tokenMatches = 0;
    let relevance = seg.isRealChapter ? 20 : 0;

    for (const tok of queryTokens) {
      if (normChap.includes(tok)) {
        tokenMatches += 1;
        relevance += 35;
      } else if (normVid.includes(tok)) {
        tokenMatches += 1;
        relevance += 10;
      }
    }

    // Require all tokens if 1-2 tokens, or majority when clicking compound quick chip like "SMIC & salaires"
    const minRequired = queryTokens.length <= 1 ? 1 : 1;
    if (tokenMatches >= minRequired) {
      // Bonus if all tokens matched
      if (tokenMatches === queryTokens.length) {
        relevance += 25;
      }
      scored.push({ seg, score: relevance });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.seg);
}

export function formatSegmentSpan(durationSeconds: number): string {
  const mins = Math.max(1, Math.round(durationSeconds / 60));
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${h} h ${rem} min` : `${h} h`;
  }
  return `${mins} min`;
}
