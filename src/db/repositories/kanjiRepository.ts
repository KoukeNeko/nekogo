import { fetchKanjiWords, fetchKanjiExamples, FuriganaChunk } from '../../api/contentApi';

export interface RelatedWord {
  id: string;
  expression: string;
  reading: string;
  furigana: FuriganaChunk[];
  gloss: string;
}

export interface RelatedExample {
  id: number;
  jp: string;
  en: string;
  furigana: FuriganaChunk[];
}

/** 取得包含該漢字的單字清單（向雲端）。 */
export const getKanjiWords = async (char: string, limit: number = 10): Promise<RelatedWord[]> => {
  const words = await fetchKanjiWords(char, limit);
  return words.map((vocab) => ({
    id: vocab.id,
    expression: vocab.expression,
    reading: vocab.reading,
    furigana: vocab.furigana ?? [{ ruby: vocab.expression }],
    gloss: vocab.gloss,
  }));
};

/** 取得包含該漢字的例句清單（向雲端）。 */
export const getKanjiExamples = async (char: string, limit: number = 10): Promise<RelatedExample[]> => {
  const examples = await fetchKanjiExamples(char, limit);
  return examples.map((example) => ({
    id: example.id,
    jp: example.jp,
    en: example.en,
    furigana: example.furigana ?? [{ ruby: example.jp }],
  }));
};
