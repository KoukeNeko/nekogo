import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts } from '../../constants/theme';

export interface FuriganaChunk {
    ruby: string;
    rt?: string;
}

interface FuriganaTextProps {
    chunks: FuriganaChunk[];
    fontSize?: number;
    color?: string;
    align?: 'center' | 'flex-start'; // 單字置中；例句等長文字靠左
    /** 功能詞（助詞・助動詞 chunk）的標色；不給則全部同色。內容詞假名不套用。 */
    kanaColor?: string;
}

// 功能性假名 chunk 白名單：助詞＋常用助動詞（句子骨架）。內容詞（すぐ、いつも等）不上色，
// 呼應手寫筆記「助詞標色、內容詞留白」的標色習慣。
const FUNCTIONAL_KANA = new Set([
    // 格助詞・係助詞・副助詞
    'は', 'が', 'を', 'に', 'で', 'と', 'へ', 'の', 'も', 'や', 'から', 'まで', 'より',
    'だけ', 'しか', 'ばかり', 'ほど', 'くらい', 'ぐらい', 'など', 'ずつ',
    // 複合助詞
    'には', 'では', 'とは', 'へは', 'にも', 'でも', 'からは', 'までは', 'について', 'として',
    // 接續助詞・終助詞
    'ば', 'ても', 'のに', 'ので', 'けど', 'けれど', 'たり', 'ながら', 'か', 'ね', 'よ', 'な', 'わ', 'ぞ', 'って',
    // 助動詞・繫辭
    'ます', 'ました', 'ません', 'ましょう', 'です', 'でした', 'だ', 'だった', 'では',
    'ない', 'なかった', 'たい', 'たかった', 'られる', 'れる', 'させる', 'せる',
]);

export const FuriganaText: React.FC<FuriganaTextProps> = ({
    chunks,
    fontSize = 32,
    color = Colors.dark.text,
    align = 'center',
    kanaColor
}) => {
    const rubySize = fontSize * 0.45; // Furigana is usually around 40-50% of base size

    return (
        <View style={[styles.container, { justifyContent: align }]}>
            {chunks.map((chunk, index) => (
                <View key={index} style={styles.chunk}>
                    {/* The reading (Furigana) */}
                    <Text 
                        style={[
                            styles.rt, 
                            { 
                                fontSize: rubySize, 
                                color: color,
                                // If no reading, we keep the space to maintain baseline alignment
                                opacity: chunk.rt ? 1 : 0,
                                marginBottom: -(fontSize * 0.15) // Use negative margin to pull it closer to the kanji
                            }
                        ]}
                        allowFontScaling={false}
                    >
                        {chunk.rt || ' '}
                    </Text>
                    {/* The base text (Kanji)；純假名 chunk 依 kanaColor 標色（呼應手寫筆記的假名標色） */}
                    <Text 
                        style={[
                            styles.ruby, 
                            {
                                fontSize: fontSize,
                                color: kanaColor && !chunk.rt && FUNCTIONAL_KANA.has(chunk.ruby)
                                    ? kanaColor
                                    : color,
                            }
                        ]}
                        allowFontScaling={false}
                    >
                        {chunk.ruby}
                    </Text>
                </View>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-end', // Align baseline of Kanji
        justifyContent: 'center',
        flexWrap: 'wrap',
    },
    chunk: {
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginHorizontal: 1, // Slight spacing between words if needed
    },
    rt: {
        fontFamily: Fonts?.serif,
        textAlign: 'center',
        includeFontPadding: false,
    },
    ruby: {
        fontFamily: Fonts?.serifBold,
        textAlign: 'center',
        includeFontPadding: false,
    }
});
