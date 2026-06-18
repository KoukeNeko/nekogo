"""
內容庫後處理：填入「乾淨授權」的音高重音、詞頻、與新卡引入順序。

於 build-content-db.mjs 組好結構後執行：
  - pitch     : 主用 UniDic 單詞素辭書形重音（fugashi，辭書權威值）；UniDic 算不出的
                複合詞改用 pyopenjtalk（OpenJTalk 複合語重音推算）補。兩者皆乾淨授權（BSD），不碰 Kanjium。
  - freq_rank : wordfreq「純」詞頻全域排名（1 = 最高頻）；zipf 為 0（極罕用）者留 NULL。
  - intro_rank: 新卡引入順序 —— 以詞頻為底，把「不適合當第一張卡」的詞降權：
                  · 機能詞（接尾/接頭/助數/助詞/助動/接續，依 JMdict 詞性）
                  · 同形異讀只留一個「主詞條」，其餘降權（避免 人 じん/ひと/にん 連續出現）
                  · 單漢字詞排在多字詞之後（單漢字表面字串頻率被複合詞灌水）
"""

import re
import sqlite3
from collections import defaultdict

import fugashi
import pyopenjtalk
from wordfreq import zipf_frequency

DB_PATH = 'assets/db/kioku-content.db'
LANG = 'ja'
NO_ACCENT = '*'
ACCENT_PARTICLE = 'が'  # 接在詞後，靠助詞高低揭示「平板(0) vs 尾高(N)」
MORA_VOWELS = set('aiueoAIUEO')  # 母音（大寫=無聲化）；連同 N(撥音)、cl(促音) 視為一拍
BOUND_POS_KEYWORDS = ('suffix', 'prefix', 'counter', 'particle', 'auxiliary', 'conjunction')
INFINITY = float('inf')

tagger = fugashi.Tagger()
PHONEME_RE = re.compile(r'\-([^+]+)\+')
A_FIELD_RE = re.compile(r'/A:([0-9\-]+)\+(\d+)\+(\d+)')


# ---- 音高來源 1：UniDic 單詞素（辭書權威值；複合詞回 None）----

def parse_accent(accent_type):
    """UniDic aType 欄位 → 重音核心位置（int），無效則 None。"""
    if not accent_type or accent_type == NO_ACCENT:
        return None
    first = accent_type.split(',')[0].strip()
    try:
        return int(first)
    except ValueError:
        return None


def unidic_accent(expression):
    """單詞素且表面相符才給辭書形重音；複合詞回 None（交給 pyopenjtalk）。"""
    tokens = list(tagger(expression))
    if len(tokens) == 1 and tokens[0].surface == expression:
        return parse_accent(getattr(tokens[0].feature, 'aType', None))
    return None


# ---- 音高來源 2：pyopenjtalk（複合詞推算，補 UniDic 之不足）----

def extract_moras(text):
    """OpenJTalk full-context → [(a1, a2)]，只取「一拍」音素（母音/撥音/促音）。"""
    moras = []
    for label in pyopenjtalk.extract_fullcontext(text):
        phoneme_match = PHONEME_RE.search(label)
        phoneme = phoneme_match.group(1) if phoneme_match else ''
        if phoneme in ('sil', 'pau', ''):
            continue
        if not (phoneme in MORA_VOWELS or phoneme == 'N' or phoneme == 'cl'):
            continue
        a_match = A_FIELD_RE.search(label)
        if a_match:
            moras.append((int(a_match.group(1)), int(a_match.group(2))))
    return moras


def pyopenjtalk_accent(word):
    """以「詞+が」推算重音核：下降點 = a1==0 且後面仍有同句拍者；無則平板(0)。"""
    try:
        moras = extract_moras(word + ACCENT_PARTICLE)
    except Exception:
        return None
    if len(moras) <= 1:
        return None
    word_length = len(moras) - 1  # 扣掉助詞「が」那一拍
    accent = 0
    for index, (a1, a2) in enumerate(moras):
        if a1 == 0:
            has_follower = index + 1 < len(moras) and moras[index + 1][1] == a2 + 1
            accent = a2 if has_follower else 0
            break
    return 0 if accent > word_length else accent


def pitch_of(expression):
    """主用 UniDic（辭書權威）；UniDic 無值（複合詞）時退用 pyopenjtalk。回傳 (重音, 來源)。"""
    accent = unidic_accent(expression)
    if accent is not None:
        return accent, 'unidic'
    accent = pyopenjtalk_accent(expression)
    if accent is not None:
        return accent, 'pyopenjtalk'
    return None, None


# ---- 詞頻 ----

def word_zipf(expression, reading):
    """以表記查詞頻；查不到再退而用讀音。回傳 zipf（越大越常用，0 表未收錄）。"""
    zipf = zipf_frequency(expression, LANG)
    if zipf == 0 and reading and reading != expression:
        zipf = zipf_frequency(reading, LANG)
    return zipf


def build_freq_ranks(zipf_by_id):
    """zipf 由高到低 → 純詞頻全域排名（1 起算）；zipf 為 0 者不給排名。"""
    ranked_ids = sorted(
        (vocab_id for vocab_id, zipf in zipf_by_id.items() if zipf > 0),
        key=lambda vocab_id: zipf_by_id[vocab_id],
        reverse=True,
    )
    return {vocab_id: rank for rank, vocab_id in enumerate(ranked_ids, start=1)}


# ---- 引入順序 ----

def is_bound_pos(pos):
    """JMdict 詞性是否為機能詞/附屬語（接尾、接頭、助數詞、助詞、助動詞、接續詞）。"""
    if not pos:
        return False
    lowered = pos.lower()
    return any(keyword in lowered for keyword in BOUND_POS_KEYWORDS)


def pick_primary_per_expression(rows, pos_by_id, rank_by_id):
    """同一表記的多個讀音挑一個「主詞條」：優先 非機能詞 → 有詞性 → 頻率高 者。"""
    ids_by_expression = defaultdict(list)
    for vocab_id, expression, _reading in rows:
        ids_by_expression[expression].append(vocab_id)

    primary_ids = set()
    for ids in ids_by_expression.values():
        primary = min(ids, key=lambda vocab_id: (
            is_bound_pos(pos_by_id[vocab_id]),
            pos_by_id[vocab_id] is None,
            rank_by_id.get(vocab_id, INFINITY),
        ))
        primary_ids.add(primary)
    return primary_ids


def intro_tier(vocab_id, expression, pos_by_id, primary_ids):
    """引入分層：0=多字實詞、1=單漢字主詞條、2=機能詞/重複異讀/單漢字附屬讀。"""
    if is_bound_pos(pos_by_id[vocab_id]) or vocab_id not in primary_ids:
        return 2
    if len(expression) <= 1:
        return 1
    return 0


def build_intro_ranks(rows, pos_by_id, rank_by_id, primary_ids):
    """以 (引入分層, 純詞頻排名) 排序全部詞 → 引入順序排名（1 起算，全覆蓋）。"""
    ordered = sorted(
        rows,
        key=lambda row: (
            intro_tier(row[0], row[1], pos_by_id, primary_ids),
            rank_by_id.get(row[0], INFINITY),
        ),
    )
    return {row[0]: position for position, row in enumerate(ordered, start=1)}


def main():
    connection = sqlite3.connect(DB_PATH)
    rows = connection.execute('SELECT id, expression, reading FROM vocab').fetchall()
    pos_by_id = dict(connection.execute('SELECT id, pos FROM vocab').fetchall())

    pitch_by_id = {}
    zipf_by_id = {}
    source_counts = {'unidic': 0, 'pyopenjtalk': 0}
    for vocab_id, expression, reading in rows:
        accent, source = pitch_of(expression)
        pitch_by_id[vocab_id] = accent
        if source:
            source_counts[source] += 1
        zipf_by_id[vocab_id] = word_zipf(expression, reading)

    rank_by_id = build_freq_ranks(zipf_by_id)
    primary_ids = pick_primary_per_expression(rows, pos_by_id, rank_by_id)
    intro_by_id = build_intro_ranks(rows, pos_by_id, rank_by_id, primary_ids)

    connection.executemany(
        'UPDATE vocab SET pitch = ?, freq_rank = ?, intro_rank = ? WHERE id = ?',
        [(pitch_by_id[vocab_id], rank_by_id.get(vocab_id), intro_by_id[vocab_id], vocab_id)
         for vocab_id, _, _ in rows],
    )
    connection.commit()

    total = len(rows)
    pitch_filled = sum(1 for value in pitch_by_id.values() if value is not None)
    freq_filled = len(rank_by_id)
    print(f'pitch 合計:             {pitch_filled:6d}/{total} ({pitch_filled / total * 100:.1f}%)')
    print(f'  ├ UniDic 單詞素:      {source_counts["unidic"]:6d}')
    print(f'  └ pyopenjtalk 複合詞:  {source_counts["pyopenjtalk"]:6d}')
    print(f'freq_rank (wordfreq):   {freq_filled:6d}/{total} ({freq_filled / total * 100:.1f}%)')
    print(f'intro_rank (引入順序):  {total:6d}/{total} (100.0%)')

    connection.close()
    print('✅ 音高（UniDic + pyopenjtalk）+ 詞頻 + 引入順序已填入內容庫')


if __name__ == '__main__':
    main()
