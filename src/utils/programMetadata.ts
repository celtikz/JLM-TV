import type { ProgramTheme, VideoChapter, YouTubeVideoItem } from '../types/broadcast.ts';

export interface ThemeDefinition {
  id: ProgramTheme;
  label: string;
  shortLabel: string;
}

export const PROGRAM_THEMES: ThemeDefinition[] = [
  { id: 'entretiens', label: 'Entretiens & Plateaux TV', shortLabel: 'Entretien TV' },
  { id: 'conferences', label: 'Conférences & Universités', shortLabel: 'Conférence' },
  { id: 'vlogs', label: 'Vlogs & Coulisses', shortLabel: 'Vlog' },
  { id: 'meetings', label: 'Meetings & Grands Discours', shortLabel: 'Meeting' },
  { id: 'assemblee', label: 'Presse & Assemblée', shortLabel: 'Point presse' },
  { id: 'international', label: 'International & Géopolitique', shortLabel: 'International' },
];

export function getThemeDefinition(theme?: ProgramTheme): ThemeDefinition {
  return PROGRAM_THEMES.find((t) => t.id === theme) || PROGRAM_THEMES[1];
}

export function classifyProgramTheme(title: string, description = ''): ProgramTheme {
  const haystack = `${title} ${description.slice(0, 350)}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (
    /\b(vlog|coulisses|chemin de la victoire|nos pas ouvrent le chemin|jusqu'a la victoire|documentaire au coeur|vivatech|festival d'avignon)\b/.test(
      haystack
    ) ||
    /^ep\.?\s*\d+/i.test(title.trim())
  ) {
    return 'vlogs';
  }

  if (
    /\b(conference de presse|point presse|assemblee|hemicycle|commission|coquerel|panot|bompard|trouve|guette|clouet|groupe parlementaire|motion de censure|budget|programme l'avenir en commun)\b/.test(
      haystack
    )
  ) {
    return 'assemblee';
  }

  if (
    /\b(international|geopolitique|diplomatie|onu|gaza|palestine|liban|ukraine|russie|amerique latine|bresil|lula|mexique|colombie|francophonie|hasanabi|paix dans le monde|nouvelle donne internationale)\b/.test(
      haystack
    )
  ) {
    return 'international';
  }

  if (
    /\b(meeting|rassemblement|marche pour|place de la|clermont|marseille|toulouse|lille|braderie|fete de l'humanite|manifestation|intersyndicale|lyon|nantes)\b/.test(
      haystack
    )
  ) {
    return 'meetings';
  }

  if (
    /\b(conference|hec|essec|sciences po|universite|amphi|institut|debats|moment politique|penser le xxie|lecon|capitalisme peut-il|tpe-pme|faire peuple|monde en guerre)\b/.test(
      haystack
    )
  ) {
    return 'conferences';
  }

  if (
    /\b(entretien|interview|discussion|sans filtre|lenglet|thinkerview|elucid|tf1|bfm|lci|france 2|france inter|franceinfo|mediapart|blast|quotidien|face a|invite|20h|presidentielle|debat)\b/.test(
      haystack
    )
  ) {
    return 'entretiens';
  }

  return 'conferences';
}

/**
 * Verified YouTube chapter markers (exact startSeconds & titles from YouTube)
 * + structured timestamps for key JLM broadcasts.
 */
export const CURATED_VIDEO_CHAPTERS: Record<string, VideoChapter[]> = {
  // TF1 INFO / LCI — Discussion sans filtre avec François Lenglet (10 chapitres officiels YouTube)
  '5qS3PZkpC64': [
    { startSeconds: 0, title: 'Intro' },
    { startSeconds: 65, title: 'La France est-elle au bord d’une révolution ?' },
    { startSeconds: 1320, title: 'Réseaux sociaux et transformation de la vie politique' },
    { startSeconds: 1598, title: 'Comment rassembler les Français dans une société polarisée ?' },
    { startSeconds: 1835, title: 'Jean-Luc Mélenchon répond aux accusations de haine' },
    { startSeconds: 2617, title: 'Quel modèle de société, salaires, fiscalité et services publics ?' },
    { startSeconds: 5068, title: 'Quand est-ce que Jean-Luc Mélenchon a été le plus heureux ?' },
    { startSeconds: 6659, title: 'Jean-Luc Mélenchon peut-il être un président moderne (VIe République) ?' },
    { startSeconds: 7475, title: 'Les critiques qui ont pu le blesser' },
    { startSeconds: 8007, title: 'La Russie, l’Ukraine et la paix : la Russie est-elle l’ennemie de la France ?' },
  ],

  // JEAN-LUC MÉLENCHON — 3 heures pour penser le XXIe siècle (20 chapitres officiels YouTube)
  JJUpHvEunoA: [
    { startSeconds: 0, title: 'Introduction' },
    { startSeconds: 23, title: 'Enfance au Maroc et racines méditerranéennes' },
    { startSeconds: 604, title: 'Identité nationale et créolisation républicaine' },
    { startSeconds: 1448, title: 'Début de la politisation et jeunesse militante' },
    { startSeconds: 2063, title: 'Marxisme, matérialisme historique et ère du peuple' },
    { startSeconds: 2141, title: 'L’histoire des luttes de masse et du mouvement social' },
    { startSeconds: 2514, title: 'Parcours à gauche : du Parti Socialiste à l’insoumission' },
    { startSeconds: 3999, title: 'Science-fiction, imaginaire technologique et progrès humain' },
    { startSeconds: 4275, title: 'Démographie mondiale et transitions du XXIe siècle' },
    { startSeconds: 4690, title: 'Immigration, accueil digne et réalités migratoires' },
    { startSeconds: 4925, title: 'Villes, métropolisation, logement et urbanisme populaire' },
    { startSeconds: 5627, title: 'Changement climatique et planification écologique' },
    { startSeconds: 6663, title: 'La politique au quotidien et l’engagement citoyen' },
    { startSeconds: 6938, title: 'Le rôle de la morale et de l’éthique républicaine' },
    { startSeconds: 7512, title: 'Les révolutions de 1848 et l’histoire républicaine française' },
    { startSeconds: 7821, title: 'Assemblées citoyennes, Constituante et VIe République' },
    { startSeconds: 8157, title: 'Répression étatique, maintien de l’ordre et libertés publiques' },
    { startSeconds: 8588, title: 'Lutte contre l’islamophobie, le racisme et les discriminations' },
    { startSeconds: 9269, title: 'Géopolitique, non-alignement et nouvel ordre mondial' },
    { startSeconds: 10381, title: 'Culture anglophone, francophonie et bataille culturelle' },
  ],

  // JEAN-LUC MÉLENCHON — Présentation du programme L'Avenir en commun (8 chapitres officiels YouTube)
  '25lLr3vUlws': [
    { startSeconds: 0, title: 'Introduction de Jean-Luc Mélenchon : cap politique de L’Avenir en commun' },
    { startSeconds: 1277, title: 'Clémence Guetté — Planification écologique et bifurcation énergétique' },
    { startSeconds: 1882, title: 'Éric Coquerel — Chiffrage budgétaire, fiscalité juste et partage des richesses' },
    { startSeconds: 2290, title: 'Mathilde Panot — Urgence démocratique, libertés et VIe République' },
    { startSeconds: 2537, title: 'Hadrien Clouet — Travail, salaires, SMIC et retraite à 60 ans' },
    { startSeconds: 2850, title: 'Aurélie Trouvé — Services publics, école, santé, logement et vie chère' },
    { startSeconds: 3172, title: 'Manuel Bompard — Stratégie d’union populaire, paix et souveraineté' },
    { startSeconds: 3540, title: 'Réponses aux questions des journalistes sur le programme' },
  ],

  // Thinkerview — Bataille de civilisation dans un monde en ruine ? Jean-Luc Mélenchon (18 chapitres officiels YouTube)
  FzzQgJntbqQ: [
    { startSeconds: 0, title: 'Qui est Jean-Luc Mélenchon ? Ouverture de l’entretien' },
    { startSeconds: 51, title: 'Transmission politique : est-ce un testament intellectuel ?' },
    { startSeconds: 115, title: 'Un optimiste sur la science, la recherche et la raison' },
    { startSeconds: 566, title: 'Littérature, poésie et humanisme politique' },
    { startSeconds: 775, title: 'L’intelligence artificielle, le numérique et le travail humain' },
    { startSeconds: 995, title: 'Les contradictions du productivisme contemporain' },
    { startSeconds: 1130, title: 'Les abeilles, l’effondrement de la biodiversité et les écosystèmes' },
    { startSeconds: 1205, title: 'La technique, l’énergie et la maîtrise démocratique du progrès' },
    { startSeconds: 1370, title: 'L’espace-temps capitaliste et l’accélération financière' },
    { startSeconds: 1510, title: 'Le cycle de l’eau, le climat et le renversement écologique' },
    { startSeconds: 1585, title: 'Bilan social du capitalisme et inégalités mondiales' },
    { startSeconds: 1675, title: 'L’agriculture vivrière, la paysannerie et la souveraineté alimentaire' },
    { startSeconds: 1825, title: 'Libre-échange, exportation agricole et traités commerciaux' },
    { startSeconds: 1895, title: 'Guerre économique, souveraineté industrielle et protectionnisme solidaire' },
    { startSeconds: 2410, title: 'Souffrance sociale, santé publique et aliénation contemporaine' },
    { startSeconds: 2560, title: 'Compétition néolibérale contre entraide et solidarité républicaine' },
    { startSeconds: 3086, title: 'La morale civique et la dignité humaine' },
    { startSeconds: 3296, title: 'Géopolitique : Arménie, droit international, ONU et paix mondiale' },
  ],

  // JEAN-LUC MÉLENCHON — Discussion internationale avec HasanAbi (16 chapitres officiels YouTube)
  RZTCInRezZU: [
    { startSeconds: 0, title: 'Présentation de La France insoumise et du mouvement populaire' },
    { startSeconds: 296, title: 'Bilan des élections législatives et blocage institutionnel d’Emmanuel Macron' },
    { startSeconds: 517, title: 'Débats stratégiques à gauche : rupture contre social-libéralisme' },
    { startSeconds: 791, title: 'Mobilisation des quartiers populaires, de la jeunesse et des abstentionnistes' },
    { startSeconds: 1054, title: 'Montée de l’extrême droite dans le monde et riposte antifasciste' },
    { startSeconds: 1396, title: 'Pourquoi la gauche libérale échoue face aux crises économiques' },
    { startSeconds: 1724, title: 'Crise des services publics en France : hôpital, école et austérité' },
    { startSeconds: 2023, title: 'Médias des milliardaires et bataille culturelle contre l’extrême droite' },
    { startSeconds: 2221, title: 'Regards croisés France / États-Unis et impérialisme' },
    { startSeconds: 2476, title: 'Gaza, Palestine, droit international et éducation populaire pour la paix' },
    { startSeconds: 2847, title: 'Politique étrangère d’Emmanuel Macron et recul diplomatique français' },
    { startSeconds: 3340, title: 'Relations États-Unis / Chine, BRICS et monde multipolaire' },
    { startSeconds: 3908, title: 'Droits sociaux, syndicalisme et protection sociale comparée' },
    { startSeconds: 4275, title: 'Liens culturels internationaux et solidarité des peuples' },
    { startSeconds: 4443, title: 'Appel à l’organisation citoyenne et à l’espoir politique' },
    { startSeconds: 4751, title: 'Réflexions finales sur l’internationalisme au XXIe siècle' },
  ],

  // BLAST — Les médias contre Mélenchon : 15 ans à diaboliser la gauche (14 chapitres officiels YouTube)
  NrWl84bQRPY: [
    { startSeconds: 0, title: 'Introduction : 15 ans de traitement médiatique de la gauche de rupture' },
    { startSeconds: 397, title: 'I. L’accusation d’extrémisme contre le programme social et écologique' },
    { startSeconds: 471, title: 'La rhétorique du « fer à cheval » et le faux renvoi dos à dos des extrêmes' },
    { startSeconds: 1182, title: 'Élections et union de la gauche : qui rassemble l’électorat populaire ?' },
    { startSeconds: 1633, title: 'Économie, SMIC et fiscalité : décryptage de la prétendue « folie budgétaire »' },
    { startSeconds: 2155, title: 'II. Polémiques médiatiques autour de la laïcité et de l’antiracisme' },
    { startSeconds: 2203, title: 'Immigration, sécurité et justice : déconstruire les caricatures' },
    { startSeconds: 2771, title: 'Lutte contre l’islamophobie et défense de l’universalisme républicain' },
    { startSeconds: 3348, title: 'Gaza, Palestine et droit international : le tournant médiatique' },
    { startSeconds: 4464, title: 'III. Assemblée nationale et conflictualité démocratique' },
    { startSeconds: 4511, title: 'Débat parlementaire sur les retraites et opposition au 49.3' },
    { startSeconds: 5076, title: 'Institutions, VIe République et défense de l’État de droit' },
    { startSeconds: 5595, title: 'Concentration des médias aux mains des milliardaires et pluralisme' },
    { startSeconds: 6702, title: 'Conclusion : médias indépendants et éducation populaire' },
  ],

  // Mediapart — Présidentielle, abstention et stratégie électorale (13 chapitres officiels YouTube)
  '4-dfHYMfSjI': [
    { startSeconds: 0, title: 'Introduction du débat sociologique et politique' },
    { startSeconds: 74, title: 'Présentation des travaux de sociologie électorale' },
    { startSeconds: 195, title: 'Sociologie des classes populaires et fractures territoriales' },
    { startSeconds: 392, title: 'La dynamique présidentielle autour de Jean-Luc Mélenchon' },
    { startSeconds: 626, title: 'Conditions de victoire et mobilisation du bloc populaire' },
    { startSeconds: 1153, title: 'Accès au second tour et recomposition de la gauche française' },
    { startSeconds: 1476, title: 'La stratégie de la « Nouvelle France », jeunesse et quartiers populaires' },
    { startSeconds: 1887, title: 'Abstention et classes travailleuses : convaincre les non-inscrits' },
    { startSeconds: 2215, title: 'Pouvoir d’achat et salaires : transformer la majorité sociale en majorité politique' },
    { startSeconds: 2704, title: 'Concentration médiatique et campagne présidentielle' },
    { startSeconds: 3096, title: 'Rapport aux institutions, Constituante et VIe République' },
    { startSeconds: 3477, title: 'Séparation des pouvoirs et parlementarisme sous une VIe République' },
    { startSeconds: 3756, title: 'Conclusion sur l’échéance présidentielle' },
  ],

  // Débat économique — Salaires, retraites, fiscalité et UE (11 chapitres officiels YouTube)
  xbe3Gnv9YV8: [
    { startSeconds: 0, title: 'Introduction : face au MEDEF, deux projets économiques opposés' },
    { startSeconds: 180, title: '1. Bilan économique du macronisme : déficit, désindustrialisation et dette' },
    { startSeconds: 325, title: '2. Politique de l’offre contre relance par le carnet de commandes populaire' },
    { startSeconds: 562, title: '3. Pourquoi l’austérité budgétaire et la baisse des dépenses créent la récession' },
    { startSeconds: 845, title: '4. Fiscalité : taxer les superprofits et soutenir les PME et artisans' },
    { startSeconds: 945, title: '5. Cotisations sociales et Sécurité sociale : le piège du « net contre le brut »' },
    { startSeconds: 1075, title: '6. Pouvoir d’achat : augmenter le SMIC et les salaires plutôt que les subventions' },
    { startSeconds: 1177, title: '7. Retraites : contre la retraite à 70 ans, le financement du retour à 60-62 ans' },
    { startSeconds: 1250, title: '8. Union européenne, traités budgétaires, énergie et souveraineté économique' },
    { startSeconds: 1634, title: '9. Synthèse comparative du programme économique insoumis' },
    { startSeconds: 1983, title: 'Conclusion : pluralisme économique dans les médias' },
  ],

  // Twitch VODs récents de Jean-Luc Mélenchon
  'vod-2906055180': [
    { startSeconds: 0, title: 'Pré-générique antenne' },
    { startSeconds: 720, title: 'Analyse du moment politique et crise du régime présidentiel' },
    { startSeconds: 1980, title: 'Rapport de force social, salaires et mobilisation syndicale' },
    { startSeconds: 3540, title: 'Bifurcation économique, budget et planification écologique' },
    { startSeconds: 4980, title: 'VIe République, Constituante et appel à l’action populaire' },
  ],
  'vod-2900414335': [
    { startSeconds: 0, title: 'Mise en place de la conférence de presse' },
    { startSeconds: 720, title: 'Jean-Luc Mélenchon : alerte sur le budget d’austérité et les services publics' },
    { startSeconds: 2040, title: 'Éric Coquerel : contre-budget, fiscalité des milliardaires et dette publique' },
    { startSeconds: 3360, title: 'Questions de la presse : motion de censure, Assemblée et retraites' },
  ],
  'vod-2897888840': [
    { startSeconds: 0, title: 'Avant-meeting à Clermont-Ferrand' },
    { startSeconds: 720, title: 'Ouverture républicaine : dignité populaire et résistance sociale' },
    { startSeconds: 1860, title: 'Urgence sociale : SMIC, blocage des prix, hôpital et école publique' },
    { startSeconds: 3480, title: 'Planification écologique, eau, agriculture et souveraineté énergétique' },
    { startSeconds: 4860, title: 'Paix internationale, Gaza, VIe République et Marseillaise' },
  ],
  'vod-2892736786': [
    { startSeconds: 0, title: 'Accueil par les étudiants d’HEC Débats' },
    { startSeconds: 720, title: 'Exposé liminaire : capitalisme financier et crise écologique mondiale' },
    { startSeconds: 2520, title: 'Entreprises, partage de la valeur, salaires et planification écologique' },
    { startSeconds: 4560, title: 'Géopolitique, Union européenne, BRICS et non-alignement de la France' },
    { startSeconds: 6240, title: 'Questions-réponses avec les étudiants : impôts, dette, IA et institutions' },
  ],
  'vod-2889055110': [
    { startSeconds: 0, title: 'Ouverture du direct' },
    { startSeconds: 720, title: 'Situation politique, Assemblée nationale et illégitimité macroniste' },
    { startSeconds: 2160, title: 'Urgence sociale, pouvoir d’achat et défense des services publics' },
    { startSeconds: 3480, title: 'Droit international, paix et perspectives pour 2027' },
  ],
  'vod-2887121305': [
    {
      startSeconds: 90,
      title: 'Prise de parole à la manifestation intersyndicale : salaires, retraites et abrogation',
    },
  ],
  'vod-2872187434': [
    { startSeconds: 360, title: 'Discours à la Fête de l’Humanité : unité populaire et rupture avec l’austérité' },
    { startSeconds: 980, title: 'Salaires, services publics et abrogation de la retraite à 64 ans' },
    { startSeconds: 1450, title: 'Paix mondiale, solidarité avec Gaza et VIe République' },
  ],
  'vod-2871315252': [
    { startSeconds: 0, title: 'Carton d’attente antenne' },
    { startSeconds: 720, title: 'Face à la rédaction de l’Humanité : stratégie de la gauche et Nouveau Front Populaire' },
    { startSeconds: 1580, title: 'Budget, fiscalité, salaires et défense de la Sécurité sociale' },
    { startSeconds: 2380, title: 'International, Gaza, Ukraine et crise des institutions de la Ve République' },
  ],
  'vod-2865974516': [
    { startSeconds: 0, title: 'Carton d’attente antenne' },
    { startSeconds: 720, title: 'Discours à la Braderie de Lille : démocratie bafouée et souveraineté du vote' },
    { startSeconds: 1850, title: 'Vie chère, SMIC à 1600€, services publics et industrie dans le Nord' },
    { startSeconds: 2920, title: 'Écologie populaire, jeunesse et appel à la mobilisation citoyenne' },
  ],
  'vod-2863427446': [
    { startSeconds: 0, title: 'Carton d’attente antenne' },
    { startSeconds: 720, title: 'Conférence sur le moment politique : crise institutionnelle de la Ve République' },
    { startSeconds: 2340, title: 'Contre-offensive sociale : budget, salaires, école et hôpital public' },
    { startSeconds: 4120, title: 'Géopolitique, droit international, Gaza et diplomatie non-alignée' },
    { startSeconds: 5340, title: 'Vers une Assemblée constituante et la VIe République' },
  ],

  // Vlogs & Coulisses officiels Jean-Luc Mélenchon
  Xq8a165QzvQ: [
    { startSeconds: 0, title: 'Ouverture : dans les coulisses de la campagne présidentielle' },
    { startSeconds: 780, title: 'Construction du programme L’Avenir en commun et stratégie d’Union populaire' },
    { startSeconds: 1860, title: 'Grands meetings populaires, logistique militante et mobilisation de la jeunesse' },
    { startSeconds: 3120, title: 'Plateaux télévisés, débats économiques et riposte face aux médias' },
    { startSeconds: 4200, title: 'Dernière ligne droite vers le premier tour et leçon politique collective' },
  ],
  '8xUoG4BRkqU': [
    { startSeconds: 0, title: 'Arrivée au salon VivaTech : souveraineté numérique française' },
    { startSeconds: 310, title: 'Intelligence artificielle, algorithmes et impact sur le travail et les salaires' },
    { startSeconds: 740, title: 'Robotique industrielle, recherche publique et formation des ingénieurs' },
    { startSeconds: 1060, title: 'Aventure spatiale, sciences et bifurcation écologique' },
  ],
  rLDEasxPkic: [
    { startSeconds: 0, title: 'Vlog au Festival d’Avignon : culture, théâtre public et éducation populaire' },
    { startSeconds: 540, title: 'Rencontre avec les intermittents du spectacle, artistes et travailleurs culturels' },
    { startSeconds: 1260, title: 'Débat public sur la liberté de création, le service public culturel et le budget' },
    { startSeconds: 1780, title: 'Échanges avec les citoyens dans les rues d’Avignon' },
  ],
  '5sJ6EWMmFf8': [
    { startSeconds: 0, title: 'Jusqu’à la victoire ! Genèse d’une campagne populaire et citoyenne' },
    { startSeconds: 1320, title: 'Porte-à-porte dans les quartiers populaires et lutte contre l’abstention' },
    { startSeconds: 2880, title: 'Meetings en hologramme, innovations numériques et VIe République' },
    { startSeconds: 4440, title: 'Urgence sociale, planification écologique et espoir collectif' },
  ],

  // Playlist officielle des Conférences de Jean-Luc Mélenchon (PLnAm9o_Xn_3CC7Oeg5-6clIrUzJE_qI1o)
  aMjTZqpZk9I: [
    { startSeconds: 0, title: 'Introduction : écologie politique et multiplication des conflits armés' },
    { startSeconds: 960, title: 'Guerre pour les ressources, eau, énergie et impasse du productivisme' },
    { startSeconds: 2280, title: 'Planification écologique, non-alignement et diplomatie de la paix' },
    { startSeconds: 3540, title: 'Débat avec Cyrielle Chatelain et Claire Lejeune sur la bifurcation écologique' },
  ],
  cYOr1xEbnLw: [
    { startSeconds: 0, title: 'Ouverture : le capitalisme peut-il avoir une fin au XXIe siècle ?' },
    { startSeconds: 1080, title: 'Crise financière, limites planétaires et marchandisation des services publics' },
    { startSeconds: 2400, title: 'Propriété sociale, sécurité sociale intégrale, logement et salaires' },
    { startSeconds: 3660, title: 'Échanges avec Stéphane Peu et Aurélie Trouvé sur l’alternative économique' },
  ],
  '7F8wvt4QxoE': [
    { startSeconds: 0, title: 'Introduction : basculement du monde et déclin de l’hégémonie occidentale' },
    { startSeconds: 840, title: 'Droit international, ONU, Gaza, Ukraine et refus du deux poids deux mesures' },
    { startSeconds: 1860, title: 'Union européenne, souveraineté française et doctrine du non-alignement' },
  ],
  'JMZD9kEpo-c': [
    { startSeconds: 0, title: 'La nouvelle donne internationale : comprendre le monde multipolaire' },
    { startSeconds: 1140, title: 'BRICS, Sud global, Amérique latine et nouvelles alliances diplomatiques' },
    { startSeconds: 2460, title: 'Guerre économique, traités de libre-échange et souveraineté industrielle' },
    { startSeconds: 3600, title: 'Pour une diplomatie française indépendante au service de la paix' },
  ],
  'S-lY5RmTels': [
    { startSeconds: 0, title: 'Diagnostic : pourquoi le néolibéralisme étouffe les TPE, PME et artisans' },
    { startSeconds: 920, title: 'Carnet de commandes par la hausse du SMIC et des salaires' },
    { startSeconds: 1980, title: 'Fiscalité progressive, impôt sur les sociétés juste et tarifs publics de l’énergie' },
  ],
  '71O08Ssj9eE': [
    { startSeconds: 0, title: 'Introduction : TPE-PME face aux multinationales et à la rente financière' },
    { startSeconds: 780, title: 'Factures d’électricité, loyers commerciaux et protectionnisme écologique' },
    { startSeconds: 1620, title: 'Crédit public, cotisations justes et relocalisation productive' },
  ],
  msIb2rNDSTA: [
    { startSeconds: 0, title: 'Conférence à l’ESSEC : crise démocratique et économique contemporaine' },
    { startSeconds: 1200, title: 'Planification écologique, bifurcation énergétique et partage des richesses' },
    { startSeconds: 2640, title: 'Géopolitique, Europe et place de la France dans le monde' },
    { startSeconds: 3960, title: 'Questions-réponses avec les étudiants de l’ESSEC (fiscalité, salaires, VIe République)' },
  ],
  SJ1BhZdb8sI: [
    { startSeconds: 0, title: 'Conférence sur le moment politique : destitution, censure et blocage macroniste' },
    { startSeconds: 1440, title: 'Budget d’austérité, dette publique, salaires et abrogation de la retraite à 64 ans' },
    { startSeconds: 3120, title: 'Services publics, école, hôpital et urgence écologique' },
    { startSeconds: 4560, title: 'Droit international, Gaza, Liban et issue constituante vers la VIe République' },
  ],
};

const THEME_FALLBACK_LABELS: Record<ProgramTheme, string[]> = {
  entretiens: [
    'Ouverture de l’entretien',
    'Situation politique & sociale',
    'Économie, travail et services publics',
    'Questions internationales & institutions',
    'Dernières questions & conclusion',
  ],
  conferences: [
    'Introduction de la conférence',
    'Cadre théorique et historique',
    'Analyse des enjeux contemporains',
    'Échanges et approfondissements',
    'Synthèse finale',
  ],
  vlogs: [
    'Ouverture du vlog & coulisses',
    'Rencontres de terrain et échanges citoyens',
    'Décryptage politique en coulisses',
    'Bilan de la séquence & perspectives',
  ],
  meetings: [
    'Ouverture du meeting',
    'Diagnostic social et démocratique',
    'Programme économique et écologique',
    'Souveraineté, paix et international',
    'Conclusion & appel à la mobilisation',
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

const SYNTHETIC_FALLBACK_SET = new Set<string>([
  'Carton d’attente antenne',
  'Programme en cours',
  'Programme intégral',
  ...Object.values(THEME_FALLBACK_LABELS).flat(),
]);

export function isSyntheticChapterList(chapters?: VideoChapter[]): boolean {
  if (!chapters || chapters.length === 0) return true;
  if (chapters.length === 1) {
    return SYNTHETIC_FALLBACK_SET.has(chapters[0].title);
  }
  const nonWait = chapters.filter((c) => c.title !== 'Carton d’attente antenne');
  if (nonWait.length === 0) return true;
  return nonWait.every((c) => SYNTHETIC_FALLBACK_SET.has(c.title));
}

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

    // Pattern 1: Timestamp at start: "00:00 - Titre", "[1:02:15] Titre", "12:30 : Titre"
    const startMatch = line.match(
      /^(?:[-•*]\s*)?(?:\[|\()?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\]|\))?\s*(?:[-–—:|•]\s*|\s+)(.+)$/
    );
    // Pattern 2: Timestamp at end: "Titre (12:30)" or "Titre - 01:15:00"
    const endMatch = !startMatch
      ? line.match(/^(.+?)\s*(?:[-–—:|]\s*|\(|\[)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\)|\])?$/)
      : null;

    let sec = -1;
    let cleanTitle = '';

    if (startMatch) {
      const hasHours = startMatch[3] !== undefined;
      sec = hasHours
        ? Number(startMatch[1]) * 3600 + Number(startMatch[2]) * 60 + Number(startMatch[3])
        : Number(startMatch[1]) * 60 + Number(startMatch[2]);
      cleanTitle = startMatch[4].replace(/^[-–—:|•]+\s*/, '').trim();
    } else if (endMatch) {
      const hasHours = endMatch[4] !== undefined;
      sec = hasHours
        ? Number(endMatch[2]) * 3600 + Number(endMatch[3]) * 60 + Number(endMatch[4])
        : Number(endMatch[2]) * 60 + Number(endMatch[3]);
      cleanTitle = endMatch[1].replace(/[-–—:|•]+\s*$/, '').trim();
    }

    const enforceUpperBound =
      durationSeconds > 0 && durationSeconds !== 1800 && durationSeconds !== 3600;

    if (
      cleanTitle.length >= 2 &&
      !/^https?:\/\//i.test(cleanTitle) &&
      sec >= 0 &&
      (!enforceUpperBound || sec < durationSeconds - 3) &&
      !seenTimes.has(sec)
    ) {
      seenTimes.add(sec);
      parsed.push({ startSeconds: sec, title: cleanTitle.slice(0, 110) });
    }
  }

  parsed.sort((a, b) => a.startSeconds - b.startSeconds);
  if (parsed.length >= 2) {
    if (parsed[0].startSeconds > 20) {
      parsed.unshift({ startSeconds: 0, title: 'Introduction' });
    } else {
      parsed[0] = { ...parsed[0], startSeconds: 0 };
    }
    return parsed;
  }
  return [];
}

export function ensureVideoChapters(opts: {
  id: string;
  title: string;
  durationSeconds: number;
  theme: ProgramTheme;
  twitchVodId?: string;
  rawChapters?: VideoChapter[];
  description?: string;
}): VideoChapter[] {
  // 1. Curated verified chapters for known flagship IDs (exact YouTube timestamps & French titles)
  const curated = CURATED_VIDEO_CHAPTERS[opts.id];
  if (curated && curated.length > 0) {
    return curated;
  }

  // 2. Real chapters extracted dynamically from YouTube / Piped (ignoring synthetic fallback lists)
  if (
    opts.rawChapters &&
    opts.rawChapters.length >= 2 &&
    !isSyntheticChapterList(opts.rawChapters)
  ) {
    const seen = new Set<number>();
    const sorted = [...opts.rawChapters]
      .filter((c) => {
        if (c.startSeconds < 0 || c.title.trim().length === 0) return false;
        if (opts.durationSeconds > 60 && c.startSeconds >= opts.durationSeconds - 2) {
          return false;
        }
        const rounded = Math.round(c.startSeconds);
        if (seen.has(rounded)) return false;
        seen.add(rounded);
        return true;
      })
      .map((c) => ({ startSeconds: Math.round(c.startSeconds), title: c.title.trim() }))
      .sort((a, b) => a.startSeconds - b.startSeconds);

    if (sorted.length >= 2) {
      if (sorted[0].startSeconds > 20) {
        sorted.unshift({ startSeconds: 0, title: 'Introduction' });
      } else {
        sorted[0] = { ...sorted[0], startSeconds: 0 };
      }
      return sorted;
    }
  }

  // 3. Description timestamp parsing
  if (opts.description) {
    const fromDesc = parseDescriptionChapters(opts.description, opts.durationSeconds);
    if (fromDesc.length >= 2) return fromDesc;
  }

  // 4. Short / single-subject interventions (< 12 min): keep exact video title as focused chapter
  const dur = Math.max(0, Math.round(opts.durationSeconds));
  if (dur < 720) {
    const startSec = opts.twitchVodId && dur >= 480 ? 90 : 0;
    return [{ startSeconds: startSec, title: opts.title.slice(0, 100) || 'Intervention' }];
  }

  // 5. Long unchaptered broadcast fallback
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
