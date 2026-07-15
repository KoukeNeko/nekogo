import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItem,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react-native';
import { Colors, Spacing, BORDER_RADIUS, Fonts } from '../../constants/theme';
import { AppBar } from '../../components/ui/AppBar';
import { BackButton } from '../../components/ui/BackButton';
import { getDailyMetrics } from '../../db/repositories/cardRepository';
import { getAllDecksWithMetrics, Deck } from '../../db/repositories/deckRepository';
import { ensureSelectedDeckCards } from '../../db/seed';
import {
  ApiVocab,
  getDeckVocabCount,
  searchDeckVocab,
} from '../../api/contentApi';

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 250;

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [studyLoading, setStudyLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [vocabs, setVocabs] = useState<ApiVocab[]>([]);
  const [vocabCount, setVocabCount] = useState(0);
  const [vocabLoading, setVocabLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [vocabError, setVocabError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getAllDecksWithMetrics()
        .then((decks) => {
          if (cancelled) return;
          const found = decks.find((candidate) => candidate.id === id);
          if (found) setDeck(found);
        })
        .catch((error) => console.error('Failed to load deck stats', error));
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!id) return;

    const requestId = ++requestIdRef.current;
    loadingMoreRef.current = false;
    setVocabLoading(true);
    setLoadingMore(false);
    setVocabError(null);
    setVocabs([]);

    const loadFirstPage = async () => {
      try {
        const [items, total] = await Promise.all([
          searchDeckVocab(id, debouncedQuery, PAGE_SIZE, 0),
          getDeckVocabCount(id, debouncedQuery),
        ]);
        if (requestId !== requestIdRef.current) return;
        setVocabs(items);
        setVocabCount(total);
        setHasMore(items.length < total);
      } catch (error) {
        console.error('Failed to load deck vocabulary', error);
        if (requestId !== requestIdRef.current) return;
        setVocabs([]);
        setVocabCount(0);
        setHasMore(false);
        setVocabError('カードを読み込めませんでした');
      } finally {
        if (requestId === requestIdRef.current) setVocabLoading(false);
      }
    };

    loadFirstPage();
  }, [debouncedQuery, id, reloadKey]);

  const dailyMetrics = useMemo(
    () => (deck ? getDailyMetrics(deck.id) : { newCards: 0, learningCards: 0, reviewCards: 0 }),
    [deck],
  );

  const isUnsubscribed = deck?.metrics.totalCards === 0;
  const displayDue = dailyMetrics.newCards + dailyMetrics.learningCards + dailyMetrics.reviewCards;
  const isCompleted = Boolean(deck && !isUnsubscribed && displayDue === 0);

  const handleStudy = async () => {
    if (!deck || studyLoading || isCompleted) return;

    if (isUnsubscribed) {
      try {
        setProgress(null);
        setStudyLoading(true);
        await ensureSelectedDeckCards([deck.id], (done, total) => setProgress({ done, total }));
        const decks = await getAllDecksWithMetrics();
        const found = decks.find((candidate) => candidate.id === deck.id);
        if (found) setDeck(found);
        router.push({ pathname: '/review', params: { deckId: deck.id } });
      } catch (error) {
        console.error('Failed to prepare deck', error);
      } finally {
        setStudyLoading(false);
        setProgress(null);
      }
      return;
    }

    router.push({ pathname: '/review', params: { deckId: deck.id } });
  };

  const getStudyButtonText = () => {
    if (studyLoading) {
      if (progress && progress.total > 0) {
        const percentage = Math.round((progress.done / progress.total) * 100);
        return `カードを準備中… ${percentage}%`;
      }
      return 'カードを準備中…';
    }
    if (isCompleted) return '今日の学習は完了';
    return 'このデッキを学習する';
  };

  const loadMore = useCallback(async () => {
    if (!id || vocabLoading || !hasMore || loadingMoreRef.current) return;

    const requestId = requestIdRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = await searchDeckVocab(id, debouncedQuery, PAGE_SIZE, vocabs.length);
      if (requestId !== requestIdRef.current) return;
      setVocabs((current) => [...current, ...nextPage]);
      setHasMore(vocabs.length + nextPage.length < vocabCount);
    } catch (error) {
      console.error('Failed to load more deck vocabulary', error);
    } finally {
      loadingMoreRef.current = false;
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [debouncedQuery, hasMore, id, vocabCount, vocabLoading, vocabs.length]);

  const renderVocab: ListRenderItem<ApiVocab> = useCallback(
    ({ item }) => (
      <TouchableOpacity
        style={styles.vocabCard}
        activeOpacity={0.72}
        onPress={() => router.push({ pathname: '/review', params: { vocabId: item.id } })}
      >
        <View style={styles.vocabContent}>
          <Text style={styles.reading} numberOfLines={1}>{item.reading}</Text>
          <View style={styles.expressionRow}>
            <Text style={styles.expression} numberOfLines={1}>{item.expression}</Text>
            {item.jlpt && (
              <View style={styles.jlptBadge}>
                <Text style={styles.jlptText}>N{item.jlpt}</Text>
              </View>
            )}
          </View>
          <Text style={styles.gloss} numberOfLines={2}>{item.gloss}</Text>
        </View>
        <ChevronRight size={18} color={Colors.dark.textSecondary} />
      </TouchableOpacity>
    ),
    [router],
  );

  if (!deck) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <AppBar
          leftContent={<BackButton />}
          centerContent={<Text style={styles.headerTitle}>読み込み中…</Text>}
        />
        <View style={styles.centerState}>
          <ActivityIndicator color={Colors.dark.primaryOrange} />
        </View>
      </SafeAreaView>
    );
  }

  const listHeader = (
    <View>
      <View style={styles.summaryCard}>
        <View style={styles.summaryTopRow}>
          {deck.tags.length > 0 ? (
            <View style={[styles.tagBadge, { backgroundColor: `${deck.color || '#68A5FF'}1A` }]}>
              <Text style={[styles.tagText, { color: deck.color || '#68A5FF' }]}>{deck.tags[0]}</Text>
            </View>
          ) : <View />}
          <Text style={styles.summaryCount}>{deck.count.toLocaleString()} 語</Text>
        </View>

        <Text style={styles.summaryTitle}>{deck.name}</Text>
        {deck.description ? <Text style={styles.summaryDescription}>{deck.description}</Text> : null}

        <View style={styles.summaryDivider} />
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, styles.newColor]}>{dailyMetrics.newCards}</Text>
            <Text style={styles.statLabel}>新規</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, styles.learningColor]}>{dailyMetrics.learningCards}</Text>
            <Text style={styles.statLabel}>学習中</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, styles.reviewColor]}>{dailyMetrics.reviewCards}</Text>
            <Text style={styles.statLabel}>復習</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.studyButton, (studyLoading || isCompleted) && styles.studyButtonDisabled]}
        onPress={handleStudy}
        disabled={studyLoading || isCompleted}
        activeOpacity={0.76}
      >
        {studyLoading && <ActivityIndicator size="small" color={Colors.dark.textSecondary} />}
        <Text style={[styles.studyButtonText, (studyLoading || isCompleted) && styles.studyButtonTextDisabled]}>
          {getStudyButtonText()}
        </Text>
      </TouchableOpacity>

      <View style={styles.searchBar}>
        <Search size={18} color={Colors.dark.textSecondary} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="このデッキ内を検索"
          placeholderTextColor={Colors.dark.textSecondary}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="never"
        />
        {query.length > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => setQuery('')}
            accessibilityLabel="検索をクリア"
          >
            <X size={16} color={Colors.dark.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.listHeading}>
        <Text style={styles.listTitle}>{debouncedQuery ? '検索結果' : 'カード一覧'}</Text>
        <Text style={styles.listCount}>{vocabCount.toLocaleString()} 語</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppBar
        leftContent={<BackButton />}
        centerContent={<Text style={styles.headerTitle} numberOfLines={1}>{deck.name}</Text>}
        rightContent={
          <View style={styles.iconButton} pointerEvents="none">
            <ChevronLeft size={28} color="transparent" />
          </View>
        }
      />

      <FlatList
        data={vocabs}
        renderItem={renderVocab}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {vocabLoading ? (
              <ActivityIndicator color={Colors.dark.primaryOrange} />
            ) : vocabError ? (
              <>
                <Text style={styles.emptyText}>{vocabError}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => setReloadKey((value) => value + 1)}>
                  <Text style={styles.retryText}>再試行</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.emptyText}>該当するカードはありません</Text>
            )}
          </View>
        }
        ListFooterComponent={
          <View style={[styles.listFooter, { paddingBottom: insets.bottom + Spacing.four }]}>
            {loadingMore && <ActivityIndicator color={Colors.dark.primaryOrange} />}
          </View>
        }
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onEndReached={loadMore}
        onEndReachedThreshold={0.45}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        windowSize={9}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  iconButton: {
    padding: Spacing.one,
  },
  headerTitle: {
    maxWidth: 240,
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    fontFamily: Fonts?.lineSeedJPBold,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  summaryCard: {
    backgroundColor: '#16171B',
    borderRadius: BORDER_RADIUS.xl,
    borderWidth: 1,
    borderColor: '#2E3135',
    padding: Spacing.three,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  tagBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
  },
  tagText: {
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: Fonts?.lineSeedJPBold,
  },
  summaryCount: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    fontFamily: Fonts?.mono,
  },
  summaryTitle: {
    color: Colors.dark.text,
    fontSize: 27,
    lineHeight: 36,
    fontFamily: Fonts?.serifBold,
  },
  summaryDescription: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: Spacing.one,
    fontFamily: Fonts?.lineSeedJP,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#2E3135',
    marginVertical: Spacing.three,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#2E3135',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: Fonts?.mono,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    fontFamily: Fonts?.lineSeedJP,
  },
  newColor: {
    color: Colors.dark.primaryOrange,
  },
  learningColor: {
    color: '#F0A944',
  },
  reviewColor: {
    color: '#66D283',
  },
  studyButton: {
    minHeight: 54,
    marginTop: Spacing.three,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: Colors.dark.primaryOrange,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
  },
  studyButtonDisabled: {
    backgroundColor: Colors.dark.backgroundSelected,
  },
  studyButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: Fonts?.lineSeedJPBold,
  },
  studyButtonTextDisabled: {
    color: Colors.dark.textSecondary,
  },
  searchBar: {
    height: 48,
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: '#2E3135',
    backgroundColor: '#16171B',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    color: Colors.dark.text,
    fontSize: 15,
    fontFamily: Fonts?.lineSeedJP,
    paddingVertical: 0,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: BORDER_RADIUS.round,
    backgroundColor: Colors.dark.backgroundSelected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listHeading: {
    marginTop: Spacing.four,
    marginBottom: Spacing.three,
    paddingHorizontal: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listTitle: {
    color: Colors.dark.text,
    fontSize: 17,
    fontWeight: 'bold',
    fontFamily: Fonts?.lineSeedJPBold,
  },
  listCount: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    fontFamily: Fonts?.mono,
  },
  vocabCard: {
    minHeight: 94,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: '#2E3135',
    backgroundColor: '#121316',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  vocabContent: {
    flex: 1,
    minWidth: 0,
  },
  reading: {
    color: Colors.dark.primaryOrange,
    fontSize: 12,
    marginBottom: 2,
    fontFamily: Fonts?.lineSeedJP,
  },
  expressionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  expression: {
    flexShrink: 1,
    color: Colors.dark.text,
    fontSize: 22,
    lineHeight: 29,
    fontFamily: Fonts?.lineSeedJPBold,
  },
  jlptBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: '#1C2939',
  },
  jlptText: {
    color: '#68A5FF',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: Fonts?.mono,
  },
  gloss: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
    fontFamily: Fonts?.lineSeedJP,
  },
  emptyState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  emptyText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    fontFamily: Fonts?.lineSeedJP,
  },
  retryButton: {
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: '#2E3135',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  retryText: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  listFooter: {
    minHeight: 80,
    paddingTop: Spacing.three,
    alignItems: 'center',
  },
});
