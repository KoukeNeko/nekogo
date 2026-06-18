import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Colors, Spacing, BORDER_RADIUS, Fonts } from '../../constants/theme';
import { AppBar } from '../../components/ui/AppBar';
import { getDailyMetrics } from '../../db/repositories/cardRepository';
import { getAllDecksWithMetrics, Deck } from '../../db/repositories/deckRepository';

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [deck, setDeck] = useState<Deck | null>(null);

  useFocusEffect(
    useCallback(() => {
      try {
        const decks = getAllDecksWithMetrics();
        const found = decks.find(d => d.id === id);
        if (found) {
          setDeck(found);
        }
      } catch (e) {
        console.error('Failed to load deck stats', e);
      }
    }, [id])
  );

  if (!deck) {
    return (
      <View style={styles.container}>
        <AppBar
          leftContent={
            <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
              <ChevronLeft size={28} color={Colors.dark.text} />
            </TouchableOpacity>
          }
          centerContent={<Text style={styles.headerTitle}>Loading...</Text>}
        />
      </View>
    );
  }

  const displayDue = Math.min(deck.metrics.newCards, 20) + deck.metrics.learningCards + deck.metrics.reviewCards;
  const isCompleted = displayDue === 0;

  return (
    <View style={styles.container}>
      <AppBar
        leftContent={
          <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
            <ChevronLeft size={28} color={Colors.dark.text} />
          </TouchableOpacity>
        }
        centerContent={<Text style={styles.headerTitle}>{deck.name}</Text>}
        rightContent={
          <View style={styles.iconButton} pointerEvents="none">
            <ChevronLeft size={28} color="transparent" />
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + Spacing.four }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerArea}>
          {deck.tags && deck.tags.length > 0 && (
            <View style={[styles.tagBadge, { backgroundColor: '#1C2939' }]}>
              <Text style={[styles.tagText, { color: '#68A5FF' }]}>{deck.tags[0]}</Text>
            </View>
          )}
          <Text style={styles.title}>{deck.name}</Text>
          <Text style={styles.description}>{deck.description}</Text>
        </View>

        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>今日予定</Text>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{Math.min(deck.metrics.newCards, 20)}</Text>
              <Text style={styles.statLabel}>新規</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{deck.metrics.learningCards}</Text>
              <Text style={styles.statLabel}>学習中</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{deck.metrics.reviewCards}</Text>
              <Text style={styles.statLabel}>復習</Text>
            </View>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>収録カード総数</Text>
            <Text style={styles.totalNumber}>{deck.metrics.totalCards}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.mainButton, isCompleted && { backgroundColor: '#2E3135' }]}
          onPress={() => {
            if (!isCompleted) {
              router.push({ pathname: "/review", params: { deckId: deck.id } });
            }
          }}
          activeOpacity={isCompleted ? 1 : 0.7}
        >
          <Text style={[styles.mainButtonText, isCompleted && { color: '#8E8F94' }]}>
            {isCompleted ? '今日の目標達成！ 🎉' : 'このデッキを復習する'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
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
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  content: {
    paddingTop: 24,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  headerArea: {
    alignItems: 'center',
    marginBottom: Spacing.two,
    gap: Spacing.two,
  },
  tagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.dark.text,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.one,
  },
  statsCard: {
    backgroundColor: '#121316',
    borderRadius: BORDER_RADIUS.lg,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: '#2E3135',
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: Spacing.four,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.four,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    fontFamily: Fonts?.mono,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#2E3135',
    paddingTop: Spacing.three,
  },
  totalLabel: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  totalNumber: {
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: Fonts?.mono,
    color: Colors.dark.text,
  },
  mainButton: {
    backgroundColor: Colors.dark.primaryOrange,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  mainButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
