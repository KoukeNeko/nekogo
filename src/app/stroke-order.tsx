import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, RotateCw } from 'lucide-react-native';
import { Colors, Spacing, Fonts, BORDER_RADIUS } from '../constants/theme';
import { AppBar } from '../components/ui/AppBar';
import { KanjiStrokeBoard } from '../components/ui/KanjiStrokeBoard';
import kanjiData from '../data/kanjiData.json';

const DEFAULT_KANJI = '木';

interface KanjiEntry {
    strokes: string[];
    strokeCount: number | null;
    grade: number | null;
    jlpt: number | null;
    frequency: number | null;
    on: string[];
    kun: string[];
    meanings: string[];
}

const KANJI_BY_CHAR = kanjiData.kanji as Record<string, KanjiEntry>;

// 讀音行：訓讀在前、音讀在後，以「•」分隔（如「き、こ-  •  ボク、モク」）。
const formatReading = (entry: KanjiEntry): string =>
    [entry.kun.join('、'), entry.on.join('、')].filter(Boolean).join('  •  ');

// 字義行：英文字義 + 筆畫數（如「tree, wood  •  4画」）。
const formatMeaning = (entry: KanjiEntry, strokeCount: number): string =>
    [entry.meanings.slice(0, 2).join(', '), `${entry.strokeCount ?? strokeCount}画`]
        .filter(Boolean)
        .join('  •  ');

export default function StrokeOrder() {
    const router = useRouter();
    const { kanji: kanjiParam } = useLocalSearchParams<{ kanji?: string }>();

    // 路由參數可為整個詞；取第一個漢字，預設顯示「木」。
    const kanjiChar =
        typeof kanjiParam === 'string' && kanjiParam.length > 0 ? [...kanjiParam][0] : DEFAULT_KANJI;
    const entry = KANJI_BY_CHAR[kanjiChar] ?? KANJI_BY_CHAR[DEFAULT_KANJI];
    const paths = entry?.strokes ?? [];

    const [trigger, setTrigger] = useState(0);
    const [activeStroke, setActiveStroke] = useState(0);

    const handleReplay = () => {
        setActiveStroke(0);
        setTrigger(prev => prev + 1);
    };

    const handleSelectStroke = (index: number) => {
        if (activeStroke === index) {
            // Deselect and replay all
            handleReplay();
        } else {
            setActiveStroke(index);
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <AppBar 
                leftContent={
                    <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
                        <ChevronLeft size={28} color={Colors.dark.text} />
                    </TouchableOpacity>
                }
                centerContent={
                    <Text style={styles.headerTitle}>筆順</Text>
                }
                rightContent={
                    <Text style={styles.headerRight}>KanjiVG</Text>
                }
            />

            <View style={styles.content}>
                
                {/* Info Text */}
                <View style={styles.infoArea}>
                    <Text style={styles.kanjiChar}>{kanjiChar}</Text>
                    <Text style={styles.readingText}>{formatReading(entry)}</Text>
                    <Text style={styles.meaningText}>{formatMeaning(entry, paths.length)}</Text>
                </View>

                {/* Animated Board */}
                <KanjiStrokeBoard
                    paths={paths}
                    trigger={trigger}
                    activeStroke={activeStroke}
                />

                {/* Controls */}
                <View style={styles.controlsArea}>
                    
                    {/* Stroke Numbers */}
                    <View style={styles.strokeNumbersRow}>
                        {paths.map((_, index) => {
                            const strokeNum = index + 1;
                            const isActive = activeStroke === strokeNum;
                            return (
                                <TouchableOpacity 
                                    key={strokeNum} 
                                    style={[
                                        styles.strokeBtn, 
                                        isActive && styles.strokeBtnActive
                                    ]}
                                    onPress={() => handleSelectStroke(strokeNum)}
                                >
                                    <Text style={[
                                        styles.strokeBtnText,
                                        isActive && styles.strokeBtnTextActive
                                    ]}>
                                        {strokeNum}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {/* Replay Button */}
                    <TouchableOpacity style={styles.replayButton} onPress={handleReplay}>
                        <RotateCw size={18} color={Colors.dark.primaryOrange} />
                        <Text style={styles.replayButtonText}>もう一度</Text>
                    </TouchableOpacity>

                </View>

                {/* Footer */}
                <View style={styles.footer}>
                    <Text style={styles.footerText}>KanjiVG  •  CC BY-SA 3.0</Text>
                </View>

            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.dark.background,
    },
    iconButton: {
        padding: Spacing.two,
        marginLeft: -Spacing.two,
    },
    headerTitle: {
        color: Colors.dark.text,
        fontSize: 18,
        fontWeight: 'bold',
        fontFamily: Fonts?.sans,
    },
    headerRight: {
        color: Colors.dark.textSecondary,
        fontSize: 14,
        fontFamily: Fonts?.mono,
    },
    content: {
        flex: 1,
        paddingTop: Spacing.four,
    },
    infoArea: {
        alignItems: 'center',
        marginBottom: Spacing.six,
        gap: Spacing.two,
    },
    kanjiChar: {
        color: Colors.dark.text,
        fontSize: 40,
        fontWeight: 'bold',
        fontFamily: Fonts?.serif,
    },
    readingText: {
        color: Colors.dark.textSecondary,
        fontSize: 16,
        letterSpacing: 2,
    },
    meaningText: {
        color: Colors.dark.textSecondary,
        fontSize: 14,
        letterSpacing: 1,
    },
    controlsArea: {
        alignItems: 'center',
        marginTop: Spacing.six,
        gap: Spacing.five,
    },
    strokeNumbersRow: {
        flexDirection: 'row',
        gap: Spacing.three,
        flexWrap: 'wrap',
        justifyContent: 'center',
    },
    strokeBtn: {
        width: 44,
        height: 44,
        borderRadius: BORDER_RADIUS.sm,
        borderWidth: 1,
        borderColor: '#2E3135',
        backgroundColor: '#121316',
        alignItems: 'center',
        justifyContent: 'center',
    },
    strokeBtnActive: {
        borderColor: Colors.dark.primaryOrange,
        backgroundColor: '#1C1D22',
    },
    strokeBtnText: {
        color: Colors.dark.primaryOrange,
        fontSize: 16,
        fontFamily: Fonts?.mono,
    },
    strokeBtnTextActive: {
        fontWeight: 'bold',
    },
    replayButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.two,
        paddingHorizontal: Spacing.five,
        paddingVertical: 14,
        borderRadius: BORDER_RADIUS.md,
        borderWidth: 1,
        borderColor: '#2E3135',
        backgroundColor: '#121316',
    },
    replayButtonText: {
        color: Colors.dark.text,
        fontSize: 16,
        fontWeight: 'bold',
    },
    footer: {
        marginTop: 'auto',
        marginBottom: Spacing.six,
        alignItems: 'center',
    },
    footerText: {
        color: '#4F525A', // subtle gray
        fontSize: 11,
        letterSpacing: 1,
        fontFamily: Fonts?.mono,
    }
});
