import { useState, useMemo } from 'react';
import { Card, Rating, createNewCard, processAnswer, formatInterval, f } from '../services/fsrs';

// Define the shape of our mock vocabulary items
export interface VocabItem {
  id: string;
  kanji: { ruby: string; rt?: string }[];
  english: string;
  // This holds the FSRS state for this vocabulary word
  fsrsCard: Card;
}

const initialMockDeck: VocabItem[] = [
  { id: '1', kanji: [{ ruby: "図", rt: "としょ" }, { ruby: "館", rt: "かん" }], english: "library", fsrsCard: createNewCard() },
  { id: '2', kanji: [{ ruby: "経", rt: "けい" }, { ruby: "済", rt: "ざい" }], english: "economy", fsrsCard: createNewCard() },
  { id: '3', kanji: [{ ruby: "約", rt: "やく" }, { ruby: "束", rt: "そく" }], english: "promise", fsrsCard: createNewCard() },
  { id: '4', kanji: [{ ruby: "影", rt: "えい" }, { ruby: "響", rt: "きょう" }], english: "influence", fsrsCard: createNewCard() },
  { id: '5', kanji: [{ ruby: "騒", rt: "さわ" }, { ruby: "がしい" }], english: "noisy", fsrsCard: createNewCard() },
];

export const useReviewSession = () => {
  const [deck, setDeck] = useState<VocabItem[]>(initialMockDeck);
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentItem = deck[currentIndex] || null;
  const isFinished = currentIndex >= deck.length;

  // Calculate the upcoming intervals for the 4 rating buttons for the current card
  const upcomingIntervals = useMemo(() => {
    if (!currentItem) return null;
    
    const now = new Date();
    // Simulate what would happen for each rating without mutating state
    const schedulingCards = f.repeat(currentItem.fsrsCard, now);
    
    return {
      again: formatInterval((schedulingCards as any)[Rating.Again].card.due, now),
      hard: formatInterval((schedulingCards as any)[Rating.Hard].card.due, now),
      good: formatInterval((schedulingCards as any)[Rating.Good].card.due, now),
      easy: formatInterval((schedulingCards as any)[Rating.Easy].card.due, now),
    };
  }, [currentItem]);

  const handleRate = (rating: Rating) => {
    if (!currentItem) return;

    const now = new Date();
    // Process the answer
    const recordLog = processAnswer(currentItem.fsrsCard, rating, now);
    const newFsrsCard = recordLog.card;

    // In a real app, we would update the database here.
    // For now, update the mock deck in memory
    setDeck(prevDeck => {
      const newDeck = [...prevDeck];
      newDeck[currentIndex] = {
        ...newDeck[currentIndex],
        fsrsCard: newFsrsCard
      };
      return newDeck;
    });

    // Move to next card
    setCurrentIndex(prev => prev + 1);
  };

  const resetSession = () => {
    setCurrentIndex(0);
    // In a real app, you would fetch the next batch of due cards from SQLite
  };

  return {
    currentItem,
    currentIndex,
    totalCards: deck.length,
    isFinished,
    upcomingIntervals,
    handleRate,
    resetSession,
  };
};
