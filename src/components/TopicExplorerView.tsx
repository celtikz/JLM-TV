import { useMemo, useState } from 'react';
import {
  Play,
  Search,
  RefreshCw,
  ListPlus,
  ChevronDown,
  ChevronUp,
  X,
  BookOpen,
} from 'lucide-react';
import type { YouTubeVideoItem } from '../types/broadcast';
import { ProgramThumbnail } from './ProgramThumbnail';
import {
  formatTimecode,
  getThemeDefinition,
  isSyntheticChapterList,
} from '../utils/programMetadata';
import {
  DOCUMENTARY_TOPICS,
  QUICK_RESEARCH_KEYWORDS,
  buildTopicSegments,
  filterTopicSegments,
  formatSegmentSpan,
  getTopicSegmentCounts,
  type DocumentaryTopicId,
} from '../utils/topicExplorer';

interface TopicExplorerViewProps {
  playlist: YouTubeVideoItem[];
  currentVideoId: string | null;
  isPlayingYoutube: boolean;
  nextQueuedVideoId: string | null;
  queuedFeedbackId: string | null;
  selectedTopic: DocumentaryTopicId | 'all';
  onSelectTopic: (topic: DocumentaryTopicId | 'all') => void;
  isRefreshingChapters: boolean;
  onRefreshChapters: () => void;
  onPlaySegment: (videoId: string, startSeconds: number) => void;
  onQueueNext: (videoId: string) => void;
}

function formatCompactViews(views: number): string {
  if (!views) return 'Catalogue H24';
  if (views >= 1_000_000) {
    return `${(views / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M vues`;
  }
  if (views >= 1_000) {
    return `${Math.round(views / 1_000).toLocaleString('fr-FR')} k vues`;
  }
  return `${views.toLocaleString('fr-FR')} vues`;
}

export function TopicExplorerView({
  playlist,
  currentVideoId,
  isPlayingYoutube,
  nextQueuedVideoId,
  queuedFeedbackId,
  selectedTopic,
  onSelectTopic,
  isRefreshingChapters,
  onRefreshChapters,
  onPlaySegment,
  onQueueNext,
}: TopicExplorerViewProps) {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [visibleLimit, setVisibleLimit] = useState<number>(24);
  const [expandedSegmentId, setExpandedSegmentId] = useState<string | null>(null);

  const allSegments = useMemo(() => buildTopicSegments(playlist), [playlist]);

  const realChapterVideoCount = useMemo(
    () =>
      playlist.filter(
        (v) => !v.twitchChannelLogin && v.chapters && !isSyntheticChapterList(v.chapters)
      ).length,
    [playlist]
  );

  const topicCounts = useMemo(
    () => getTopicSegmentCounts(allSegments),
    [allSegments]
  );

  const filteredSegments = useMemo(
    () => filterTopicSegments(allSegments, selectedTopic, searchQuery),
    [allSegments, selectedTopic, searchQuery]
  );

  const activeTopicDef = useMemo(
    () => DOCUMENTARY_TOPICS.find((t) => t.id === selectedTopic) || null,
    [selectedTopic]
  );

  const visibleSegments = useMemo(
    () => filteredSegments.slice(0, visibleLimit),
    [filteredSegments, visibleLimit]
  );

  const handleSelectTopicCard = (topicId: DocumentaryTopicId | 'all') => {
    onSelectTopic(topicId);
    setVisibleLimit(24);
  };

  const handleToggleQuickKeyword = (kw: string) => {
    setVisibleLimit(24);
    if (searchQuery.trim().toLowerCase() === kw.toLowerCase()) {
      setSearchQuery('');
    } else {
      setSearchQuery(kw);
      if (selectedTopic !== 'all') {
        onSelectTopic('all');
      }
    }
  };

  return (
    <div className="space-y-8">
      {/* Editorial Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 pb-6 border-b border-neutral-800">
        <div className="space-y-2 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
            <BookOpen className="w-3.5 h-3.5 text-white shrink-0" />
            <span className="text-white font-medium">Index documentaire chapitré</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-neutral-300">
              {allSegments.length} séquences indexées
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-neutral-300">
              {realChapterVideoCount} vidéos chapitrées
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-white">
            S’informer par Sujets & Timecodes
          </h1>
          <p className="text-sm text-neutral-400 leading-relaxed">
            Sélectionnez une thématique ou recherchez un point précis pour accéder directement aux
            conférences, entretiens et vlogs au bon timecode, sans couper le direct en cours dans
            le mini-lecteur.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onRefreshChapters}
            disabled={isRefreshingChapters}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-neutral-200 bg-neutral-950 hover:bg-neutral-900 border border-neutral-800 rounded-xl transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 shrink-0 ${isRefreshingChapters ? 'animate-spin' : ''}`}
            />
            <span>
              {isRefreshingChapters
                ? 'Récupération des chapitres...'
                : 'Actualiser tous les chapitrages'}
            </span>
          </button>
        </div>
      </div>

      {/* Interactive 8-Subject Selector Grid */}
      <section className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">
            Choisir un sujet pour afficher les passages vidéo correspondants
          </h2>
          <button
            type="button"
            onClick={() => handleSelectTopicCard('all')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-xl border transition-colors cursor-pointer whitespace-nowrap ${
              selectedTopic === 'all'
                ? 'bg-white text-black border-white font-semibold'
                : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:bg-neutral-900 hover:text-white'
            }`}
          >
            Tous les sujets ({allSegments.length})
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {DOCUMENTARY_TOPICS.map((topic) => {
            const isSelected = selectedTopic === topic.id;
            const count = topicCounts[topic.id] || 0;

            return (
              <button
                key={topic.id}
                type="button"
                onClick={() =>
                  handleSelectTopicCard(isSelected ? 'all' : topic.id)
                }
                className={`text-left p-4 rounded-2xl border transition-colors cursor-pointer flex flex-col justify-between gap-2.5 ${
                  isSelected
                    ? 'bg-white text-black border-white'
                    : 'bg-neutral-950 hover:bg-neutral-900/90 text-neutral-100 border-neutral-800/90 hover:border-white/30'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`text-sm font-semibold leading-snug ${
                      isSelected ? 'text-black' : 'text-white'
                    }`}
                  >
                    {topic.label}
                  </span>
                  <span
                    className={`text-xs font-mono tabular-nums shrink-0 pt-0.5 ${
                      isSelected ? 'text-neutral-800 font-bold' : 'text-neutral-400'
                    }`}
                  >
                    {count}
                  </span>
                </div>
                <p
                  className={`text-xs leading-relaxed line-clamp-2 ${
                    isSelected ? 'text-neutral-700' : 'text-neutral-400'
                  }`}
                >
                  {topic.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Instant Chapter Search + Quick Research Keywords */}
      <section className="border border-white/15 bg-neutral-950 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-neutral-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleLimit(24);
              }}
              placeholder="Rechercher un sujet précis dans les chapitres (ex : SMIC, Gaza, 6e République, nucléaire, TPE-PME, IA, eau)..."
              className="w-full pl-11 pr-10 py-2.5 text-sm bg-black border border-neutral-800 rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:border-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setVisibleLimit(24);
                }}
                aria-label="Effacer la recherche"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {(selectedTopic !== 'all' || searchQuery.trim()) && (
            <button
              type="button"
              onClick={() => {
                onSelectTopic('all');
                setSearchQuery('');
                setVisibleLimit(24);
              }}
              className="px-4 py-2.5 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>

        {/* Clickable Quick Research Chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-400 mr-1">Recherches fréquentes :</span>
          {QUICK_RESEARCH_KEYWORDS.map((kw) => {
            const active = searchQuery.trim().toLowerCase() === kw.toLowerCase();
            return (
              <button
                key={kw}
                type="button"
                onClick={() => handleToggleQuickKeyword(kw)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-white text-black border-white font-semibold'
                    : 'bg-black text-neutral-300 border-neutral-800 hover:border-white/30 hover:text-white'
                }`}
              >
                {kw}
              </button>
            );
          })}
        </div>
      </section>

      {/* Results Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-white">
            {activeTopicDef ? activeTopicDef.label : 'Toutes les séquences documentaires'}
            {searchQuery.trim() ? ` — « ${searchQuery.trim()} »` : ''}
          </h2>
          <p className="text-xs text-neutral-400 font-mono tabular-nums">
            {filteredSegments.length}{' '}
            {filteredSegments.length > 1
              ? 'passages vidéo trouvés au timecode exact'
              : 'passage vidéo trouvé au timecode exact'}
          </p>
        </div>
      </div>

      {/* Timecoded Video Segments Grid */}
      {filteredSegments.length === 0 ? (
        <div className="border border-white/15 bg-neutral-950 rounded-2xl p-12 text-center space-y-4">
          <p className="text-sm text-neutral-300">
            Aucun chapitre indexé ne correspond simultanément à ce filtre et à cette recherche.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {selectedTopic !== 'all' && searchQuery.trim() && (
              <button
                type="button"
                onClick={() => onSelectTopic('all')}
                className="px-4 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors cursor-pointer"
              >
                Chercher « {searchQuery.trim()} » dans tous les sujets
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onSelectTopic('all');
                setSearchQuery('');
              }}
              className="px-4 py-2 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors cursor-pointer"
            >
              Afficher toutes les séquences ({allSegments.length})
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleSegments.map((seg) => {
              const isCurrentVideo =
                isPlayingYoutube && currentVideoId === seg.video.id;
              const isQueuedNext =
                !isCurrentVideo && nextQueuedVideoId === seg.video.id;
              const justQueued = queuedFeedbackId === seg.video.id;
              const themeDef = getThemeDefinition(seg.video.theme);
              const chaptersExpanded = expandedSegmentId === seg.id;
              const timecodeLabel = formatTimecode(seg.chapter.startSeconds);

              return (
                <article
                  key={seg.id}
                  className={`group rounded-2xl border overflow-hidden flex flex-col transition-colors ${
                    isCurrentVideo
                      ? 'bg-neutral-900/90 border-white/45'
                      : 'bg-neutral-950 border-neutral-800/90 hover:border-white/30'
                  }`}
                >
                  {/* 16:9 Thumbnail Anchored at Exact Chapter Timecode */}
                  <button
                    type="button"
                    onClick={() =>
                      onPlaySegment(seg.video.id, seg.chapter.startSeconds)
                    }
                    className="w-full text-left cursor-pointer"
                    title={`Lancer « ${seg.chapter.title} » à ${timecodeLabel}`}
                  >
                    <ProgramThumbnail
                      videoId={
                        !seg.video.twitchVodId && !seg.video.twitchChannelLogin
                          ? seg.video.id
                          : undefined
                      }
                      thumbnailUrl={seg.video.thumbnailUrl}
                      title={seg.chapter.title}
                      durationSeconds={seg.video.durationSeconds}
                      startTimecodeSeconds={seg.chapter.startSeconds}
                      isCurrent={false}
                      isQueuedNext={isQueuedNext}
                    />
                  </button>

                  {/* Card Body: Exact Chapter Heading + Unboxed Source Video Metadata */}
                  <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                    <div className="space-y-2">
                      {/* Unboxed Timecode & Segment Span */}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400 font-mono tabular-nums">
                        <span className="text-white font-semibold">
                          Début à {timecodeLabel}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans">
                          Séquence ~{formatSegmentSpan(seg.segmentDurationSeconds)}
                        </span>
                        {isCurrentVideo && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-sans text-white font-medium">
                              Vidéo à l’antenne
                            </span>
                          </>
                        )}
                      </div>

                      {/* Exact Chapter Subject Title */}
                      <button
                        type="button"
                        onClick={() =>
                          onPlaySegment(seg.video.id, seg.chapter.startSeconds)
                        }
                        className="text-left w-full cursor-pointer"
                      >
                        <h3 className="text-sm sm:text-[15px] font-semibold text-white line-clamp-2 leading-snug group-hover:underline">
                          {seg.chapter.title}
                        </h3>
                      </button>

                      {/* Parent Video Title & Unboxed Context (Zero Static Pills) */}
                      <div className="space-y-1 pt-0.5">
                        <p className="text-xs text-neutral-300 line-clamp-1">
                          {seg.video.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500 font-mono tabular-nums">
                          <span className="font-sans text-neutral-400">
                            {themeDef.label}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-sans">
                            {formatCompactViews(seg.video.views)}
                          </span>
                          {seg.video.chapters && seg.video.chapters.length > 1 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-sans">
                                Chapitre {seg.chapterIndex + 1}/{seg.video.chapters.length}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Interactive Actions */}
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onPlaySegment(seg.video.id, seg.chapter.startSeconds)
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                          <span className="font-mono tabular-nums">
                            Lancer à {timecodeLabel}
                          </span>
                        </button>

                        {!isCurrentVideo && (
                          <button
                            type="button"
                            onClick={() => onQueueNext(seg.video.id)}
                            title="Programmer cette vidéo juste après la diffusion actuelle sans la couper"
                            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border transition-colors cursor-pointer whitespace-nowrap ${
                              justQueued || isQueuedNext
                                ? 'bg-neutral-200 text-black border-white font-semibold'
                                : 'bg-neutral-900 text-neutral-200 border-neutral-800 hover:bg-neutral-800 hover:text-white'
                            }`}
                          >
                            <ListPlus className="w-3.5 h-3.5 shrink-0" />
                            <span>{justQueued ? 'À suivre !' : 'À suivre'}</span>
                          </button>
                        )}

                        {seg.video.chapters && seg.video.chapters.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSegmentId((prev) =>
                                prev === seg.id ? null : seg.id
                              )
                            }
                            title="Voir le chapitrage complet de cette vidéo sans couper le direct"
                            className="p-2 text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors cursor-pointer shrink-0"
                          >
                            {chaptersExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>

                      {/* Expandable Full Video Chapters */}
                      {chaptersExpanded &&
                        seg.video.chapters &&
                        seg.video.chapters.length > 1 && (
                          <div className="pt-2.5 border-t border-neutral-800 space-y-1 max-h-48 overflow-y-auto">
                            <p className="text-[11px] text-neutral-400 px-1 pb-0.5">
                              Tous les chapitres de cette vidéo ({seg.video.chapters.length}) :
                            </p>
                            {seg.video.chapters.map((ch, idx) => {
                              const isHighlightedChap =
                                ch.startSeconds === seg.chapter.startSeconds;
                              return (
                                <button
                                  key={`${ch.startSeconds}-${idx}`}
                                  type="button"
                                  onClick={() =>
                                    onPlaySegment(seg.video.id, ch.startSeconds)
                                  }
                                  className={`w-full text-left px-2 py-1.5 rounded-lg flex items-start gap-2 text-xs transition-colors cursor-pointer ${
                                    isHighlightedChap
                                      ? 'bg-white text-black font-semibold'
                                      : 'hover:bg-neutral-900 text-neutral-200'
                                  }`}
                                >
                                  <span
                                    className={`font-mono tabular-nums shrink-0 ${
                                      isHighlightedChap
                                        ? 'text-neutral-800 font-bold'
                                        : 'text-neutral-400'
                                    }`}
                                  >
                                    {formatTimecode(ch.startSeconds)}
                                  </span>
                                  <span className="line-clamp-1">{ch.title}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {filteredSegments.length > visibleLimit && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => setVisibleLimit((prev) => prev + 24)}
                className="px-6 py-2.5 text-xs font-semibold text-white bg-neutral-950 hover:bg-neutral-900 border border-white/20 rounded-xl transition-colors cursor-pointer font-mono tabular-nums"
              >
                Afficher plus de séquences ({filteredSegments.length - visibleLimit} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
