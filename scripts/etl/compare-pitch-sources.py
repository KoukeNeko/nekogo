"""
比對 Kanjium（目前採用）vs UniDic（BSD 乾淨授權）的音高重音資料，
針對 content.vocab 的實際詞彙，量化「換到 UniDic 會損失多少覆蓋率、改變多少顯示」。

Kanjium 已存於 content.vocab.pitch。UniDic 用 fugashi + unidic-lite 的 aType 取得：
- 單一詞素且表面一致 → 直接可比的辭書形重音。
- 多詞素（複合詞）→ UniDic 需連濁/複合下降規則才得citation accent，此處標為 compound。
"""

import sqlite3
import fugashi

DB_PATH = 'assets/db/kioku-content.db'
tagger = fugashi.Tagger()


def parse_accent(atype):
    if not atype or atype == '*':
        return None
    first = atype.split(',')[0].strip()
    try:
        return int(first)
    except ValueError:
        return None


def unidic_accent(expression):
    """回傳 (accent or None, is_compound)。單詞素且表面相符才給直接重音。"""
    tokens = list(tagger(expression))
    if len(tokens) == 1 and tokens[0].surface == expression:
        return parse_accent(getattr(tokens[0].feature, 'aType', None)), False
    return None, True


def main():
    con = sqlite3.connect(DB_PATH)
    rows = con.execute('SELECT expression, reading, pitch, jlpt FROM vocab').fetchall()

    total = len(rows)
    kanjium_have = 0
    unidic_single_have = 0
    compound = 0

    # 以「目前會顯示 pitch 的詞」(kanjium 有值) 為基準，看 UniDic 如何
    k_have_unidic_single_agree = 0
    k_have_unidic_single_disagree = 0
    k_have_compound = 0
    k_have_unidic_missing = 0
    disagreements = []

    # UniDic 單詞素能覆蓋、但 Kanjium 沒有的（UniDic 多補的）
    unidic_only = 0

    for expr, reading, kpitch, jlpt in rows:
        uacc, is_comp = unidic_accent(expr)
        if kpitch is not None:
            kanjium_have += 1
        if is_comp:
            compound += 1
        elif uacc is not None:
            unidic_single_have += 1

        if kpitch is not None:
            if is_comp:
                k_have_compound += 1
            elif uacc is None:
                k_have_unidic_missing += 1
            elif uacc == kpitch:
                k_have_unidic_single_agree += 1
            else:
                k_have_unidic_single_disagree += 1
                if len(disagreements) < 15:
                    disagreements.append(f'{expr}/{reading}: Kanjium={kpitch} UniDic={uacc}')
        else:
            if (not is_comp) and uacc is not None:
                unidic_only += 1

    def pct(n, d):
        return f'{n / d * 100:.1f}%' if d else 'n/a'

    print(f'=== 詞彙總數: {total} ===\n')
    print('--- 覆蓋率 ---')
    print(f'Kanjium 有重音:            {kanjium_have:6d} ({pct(kanjium_have, total)})')
    print(f'UniDic 單詞素可直接給重音:  {unidic_single_have:6d} ({pct(unidic_single_have, total)})')
    print(f'複合詞(UniDic需連濁規則):  {compound:6d} ({pct(compound, total)})')
    print()
    print(f'--- 以「目前有顯示 pitch 的 {kanjium_have} 詞」為基準，換 UniDic 會怎樣 ---')
    comparable = k_have_unidic_single_agree + k_have_unidic_single_disagree
    print(f'單詞素可直接比對:          {comparable:6d}')
    print(f'  其中 一致:               {k_have_unidic_single_agree:6d} ({pct(k_have_unidic_single_agree, comparable)} of comparable)')
    print(f'  其中 不一致:             {k_have_unidic_single_disagree:6d} ({pct(k_have_unidic_single_disagree, comparable)} of comparable)')
    print(f'複合詞(UniDic需另算規則):  {k_have_compound:6d} ({pct(k_have_compound, kanjium_have)})  ← 換 UniDic 的主要工作量/風險')
    print(f'UniDic 單詞素也無值(會掉):  {k_have_unidic_missing:6d} ({pct(k_have_unidic_missing, kanjium_have)})')
    print()
    print(f'UniDic 單詞素有、但 Kanjium 沒有(UniDic 多補): {unidic_only}')
    print()
    print('--- 不一致範例 ---')
    for d in disagreements:
        print(f'  {d}')

    con.close()


if __name__ == '__main__':
    main()
