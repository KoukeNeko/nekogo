/**
 * 詞性標籤與活用變化（單字詳情「基本資訊」用）。
 *
 * 資料來源是 JMdict 的英文 pos 字串（如 "Godan verb with 'ru' ending, intransitive verb"），
 * 這裡做兩件事：1) 轉成日文短標籤（五段動詞・自動詞…）；2) 對可安全機械變位的類別
 * （五段／一段／する動詞／来る／い形容詞）產生常用活用形。特殊活用類（なさる等）寧缺勿錯，不產生。
 */

export interface ConjugationForm {
  label: string;
  /** 不變的語幹（詳情頁以原色顯示）。 */
  stem: string;
  /** 變化的語尾假名（詳情頁以豔色標示，如手寫筆記的假名標色）。 */
  ending: string;
}

// JMdict pos 片段 → 日文標籤（依子字串比對，先長後短避免誤中）。
const POS_LABEL_RULES: Array<[match: string, label: string]> = [
  ["Godan verb - Iku/Yuku special class", '五段動詞'],
  ['Godan verb', '五段動詞'],
  ['Ichidan verb', '一段動詞'],
  ['Kuru verb', 'カ変動詞'],
  ['suru verb', 'する動詞'],
  ['takes the aux. verb suru', 'する動詞'],
  // 「intransitive」包含「transitive」子字串，自動詞必須先比對。
  ['intransitive verb', '自動詞'],
  ['transitive verb', '他動詞'],
  ['adjectival nouns or quasi-adjectives', 'な形容詞'],
  ['adjective (keiyoushi)', 'い形容詞'],
  ['adverb taking the', '副詞（〜と）'],
  ['adverb', '副詞'],
  ['noun, used as a suffix', '接尾名詞'],
  ['noun (common)', '名詞'],
  ['pronoun', '代名詞'],
  ['interjection', '感動詞'],
  ['conjunction', '接続詞'],
  ['particle', '助詞'],
  ['auxiliary verb', '助動詞'],
  ['auxiliary adjective', '補助形容詞'],
  ['auxiliary', '助動詞'],
  ['prefix', '接頭語'],
  ['suffix', '接尾語'],
  ['counter', '助数詞'],
  ['expressions', '表現'],
  ['copula', '断定辞'],
];

/** JMdict pos 字串 → 日文標籤陣列（去重、保序；無法辨識的片段略過）。 */
export const parsePosLabels = (pos: string | null | undefined): string[] => {
  if (!pos) return [];
  const labels: string[] = [];
  for (const segment of pos.split(',').map((part) => part.trim()).filter(Boolean)) {
    const rule = POS_LABEL_RULES.find(([match]) => segment.toLowerCase().includes(match.toLowerCase()));
    if (rule && !labels.includes(rule[1])) {
      labels.push(rule[1]);
    }
  }
  return labels;
};

// 五段活用的假名行對照（語尾 う段 → 各段）。
const GODAN_ROWS: Record<string, { a: string; i: string; e: string; o: string }> = {
  う: { a: 'わ', i: 'い', e: 'え', o: 'お' },
  く: { a: 'か', i: 'き', e: 'け', o: 'こ' },
  ぐ: { a: 'が', i: 'ぎ', e: 'げ', o: 'ご' },
  す: { a: 'さ', i: 'し', e: 'せ', o: 'そ' },
  つ: { a: 'た', i: 'ち', e: 'て', o: 'と' },
  ぬ: { a: 'な', i: 'に', e: 'ね', o: 'の' },
  ぶ: { a: 'ば', i: 'び', e: 'べ', o: 'ぼ' },
  む: { a: 'ま', i: 'み', e: 'め', o: 'も' },
  る: { a: 'ら', i: 'り', e: 'れ', o: 'ろ' },
};

// 五段て形の音便：語尾 → て形字尾（た形同型，て→た／で→だ）。
const GODAN_TE_SUFFIX: Record<string, string> = {
  う: 'って', つ: 'って', る: 'って',
  く: 'いて', ぐ: 'いで',
  ぬ: 'んで', ぶ: 'んで', む: 'んで',
  す: 'して',
};

const teToTa = (teSuffix: string): string =>
  teSuffix.endsWith('で') ? `${teSuffix.slice(0, -1)}だ` : `${teSuffix.slice(0, -1)}た`;

const conjugateGodan = (expression: string): ConjugationForm[] | null => {
  const ending = expression.slice(-1);
  const stem = expression.slice(0, -1);
  const rows = GODAN_ROWS[ending];
  let teSuffix = GODAN_TE_SUFFIX[ending];
  if (!rows || !teSuffix) return null;
  // 行く／〜行く（ゆく）音便特例：行いて ✗ → 行って ✓
  if (ending === 'く' && (expression.endsWith('行く') || expression.endsWith('いく') || expression.endsWith('ゆく'))) {
    teSuffix = 'って';
  }
  return [
    { label: 'ます形', stem, ending: `${rows.i}ます` },
    { label: '中止形', stem, ending: rows.i },
    { label: 'て形', stem, ending: teSuffix },
    { label: 'た形', stem, ending: teToTa(teSuffix) },
    { label: 'ない形', stem, ending: `${rows.a}ない` },
    { label: '可能形', stem, ending: `${rows.e}る` },
    { label: '意向形', stem, ending: `${rows.o}う` },
    { label: '受身形', stem, ending: `${rows.a}れる` },
    { label: '使役形', stem, ending: `${rows.a}せる` },
    { label: '使役受身形', stem, ending: `${rows.a}せられる` },
    { label: '条件形', stem, ending: `${rows.e}ば` },
    { label: '命令形', stem, ending: rows.e },
    { label: '禁止形', stem: expression, ending: 'な' },
  ];
};

const conjugateIchidan = (expression: string): ConjugationForm[] | null => {
  if (!expression.endsWith('る')) return null;
  const stem = expression.slice(0, -1);
  return [
    { label: 'ます形', stem, ending: 'ます' },
    { label: '中止形', stem, ending: '' },
    { label: 'て形', stem, ending: 'て' },
    { label: 'た形', stem, ending: 'た' },
    { label: 'ない形', stem, ending: 'ない' },
    { label: '可能形', stem, ending: 'られる' },
    { label: '意向形', stem, ending: 'よう' },
    { label: '受身形', stem, ending: 'られる' },
    { label: '使役形', stem, ending: 'させる' },
    { label: '使役受身形', stem, ending: 'させられる' },
    { label: '条件形', stem, ending: 'れば' },
    { label: '命令形', stem, ending: 'ろ' },
    { label: '禁止形', stem: expression, ending: 'な' },
  ];
};

const conjugateSuruNoun = (expression: string): ConjugationForm[] => [
  { label: 'ます形', stem: expression, ending: 'します' },
  { label: '中止形', stem: expression, ending: 'し' },
  { label: 'て形', stem: expression, ending: 'して' },
  { label: 'た形', stem: expression, ending: 'した' },
  { label: 'ない形', stem: expression, ending: 'しない' },
  { label: '可能形', stem: expression, ending: 'できる' },
  { label: '意向形', stem: expression, ending: 'しよう' },
  { label: '受身形', stem: expression, ending: 'される' },
  { label: '使役形', stem: expression, ending: 'させる' },
  { label: '使役受身形', stem: expression, ending: 'させられる' },
  { label: '条件形', stem: expression, ending: 'すれば' },
  { label: '命令形', stem: expression, ending: 'しろ' },
  { label: '禁止形', stem: expression, ending: 'するな' },
];

const conjugateKuru = (expression: string): ConjugationForm[] => {
  const isKanji = expression.endsWith('来る');
  const stem = expression.slice(0, -(isKanji ? 2 : 2)); // 来る／くる 皆兩字
  const entry = (label: string, kanjiEnding: string, kanaForm: string): ConjugationForm =>
    isKanji
      ? { label, stem: `${stem}来`, ending: kanjiEnding }
      : { label, stem, ending: kanaForm };
  return [
    entry('ます形', 'ます', 'きます'),
    entry('中止形', '', 'き'),
    entry('て形', 'て', 'きて'),
    entry('た形', 'た', 'きた'),
    entry('ない形', 'ない', 'こない'),
    entry('可能形', 'られる', 'こられる'),
    entry('意向形', 'よう', 'こよう'),
    entry('受身形', 'られる', 'こられる'),
    entry('使役形', 'させる', 'こさせる'),
    entry('使役受身形', 'させられる', 'こさせられる'),
    entry('条件形', 'れば', 'くれば'),
    entry('命令形', 'い', 'こい'),
    entry('禁止形', 'るな', 'くるな'),
  ];
};

const conjugateIAdjective = (expression: string): ConjugationForm[] | null => {
  if (!expression.endsWith('い')) return null;
  // いい（良い口語形）活用回到 よ 系。
  const stem = expression.endsWith('いい')
    ? `${expression.slice(0, -2)}よ`
    : expression.slice(0, -1);
  return [
    { label: '否定形', stem, ending: 'くない' },
    { label: '過去形', stem, ending: 'かった' },
    { label: 'て形', stem, ending: 'くて' },
    { label: '副詞形', stem, ending: 'く' },
    { label: '条件形', stem, ending: 'ければ' },
  ];
};

/**
 * 依 pos 產生常用活用形；非用言或特殊活用類（special class 等）回傳 null（詳情頁隱藏區塊）。
 */
export const buildConjugations = (
  expression: string,
  pos: string | null | undefined,
): ConjugationForm[] | null => {
  if (!pos || !expression) return null;
  const posLower = pos.toLowerCase();

  // 特殊活用類（なさる・くださる等）機械變位會出錯，寧缺勿錯；行く／来る特例另有處理。
  if (
    posLower.includes('special class') &&
    !posLower.includes('iku/yuku') &&
    !posLower.includes('kuru verb')
  ) return null;
  // ずる動詞（感ずる→感じます）與不規則五段（ある→ない）不走一般規則，同樣寧缺勿錯。
  if (posLower.includes('zuru verb') || posLower.includes('irregular')) return null;

  if (posLower.includes('ichidan verb')) return conjugateIchidan(expression);
  if (posLower.includes('godan verb')) return conjugateGodan(expression);
  if (posLower.includes('kuru verb')) return conjugateKuru(expression);
  if (posLower.includes('takes the aux. verb suru')) return conjugateSuruNoun(expression);
  if (posLower.includes('suru verb')) return conjugateSuruNoun(expression.replace(/する$/, ''));
  if (posLower.includes('adjective (keiyoushi)')) return conjugateIAdjective(expression);
  return null;
};
