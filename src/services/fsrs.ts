import { fsrs, createEmptyCard, Rating, State, Card, RecordLogItem, FSRS } from 'ts-fsrs';

// Initialize the FSRS algorithm with default parameters
export const f: FSRS = fsrs();

// Re-export useful Enums and Types
export { Rating, State, type Card, type RecordLogItem };

/**
 * Creates a brand new empty card for scheduling.
 */
export const createNewCard = (): Card => {
  return createEmptyCard();
};

/**
 * Given a card and its rating, process the answer and return the new card state
 * and scheduling record log.
 */
export const processAnswer = (card: Card, rating: Rating, now: Date = new Date()): RecordLogItem => {
  const schedulingCards = f.repeat(card, now);
  // @ts-ignore - The index typing of schedulingCards requires string/number coercion based on ts-fsrs version
  const recordLog = schedulingCards[rating];
  return recordLog;
};

/**
 * Utility to format the interval into a human-readable string (e.g., 10m, 4d)
 */
export const formatInterval = (dueTime: Date, nowTime: Date = new Date()): string => {
  const diffMs = dueTime.getTime() - nowTime.getTime();
  const diffMinutes = Math.round(diffMs / 1000 / 60);
  
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }
  
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }
  
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}d`;
  }
  
  const diffMonths = Math.round(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths}mo`;
  }
  
  const diffYears = Math.round(diffMonths / 12);
  return `${diffYears}y`;
};
