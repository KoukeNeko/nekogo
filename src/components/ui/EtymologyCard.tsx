import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { ArrowDown, ExternalLink } from 'lucide-react-native';
import { Colors, Spacing, BORDER_RADIUS, Fonts } from '../../constants/theme';
import type { Etymology } from '../../db/repositories/etymologyRepository';

interface EtymologyCardProps {
    etymology: Etymology;
}

// 「定説」以外的信度以暖色徽章提示讀者：此為學說而非定論（值為日文，與 DB 枚舉一致）。
const TENTATIVE_CONFIDENCES = ['有力説', '一説', '俗説'];

const openSourceUrl = (url: string) => {
    Linking.openURL(url).catch((error) => console.error('開啟詞源出處連結失敗', error));
};

export const EtymologyCard: React.FC<EtymologyCardProps> = ({ etymology }) => {
    const isTentative = TENTATIVE_CONFIDENCES.includes(etymology.confidence);
    return (
        <View style={styles.container}>
            <View style={styles.badgeRow}>
                <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{etymology.originType}</Text>
                </View>
                <View style={[styles.confidenceBadge, isTentative && styles.confidenceBadgeTentative]}>
                    <Text style={[styles.confidenceBadgeText, isTentative && styles.confidenceBadgeTextTentative]}>
                        {etymology.confidence}
                    </Text>
                </View>
            </View>

            <View>
                {etymology.stages.map((stage, index) => (
                    <React.Fragment key={`${stage.form}-${index}`}>
                        {index > 0 && (
                            <View style={styles.arrowWrap}>
                                <ArrowDown size={16} color={Colors.dark.textSecondary} />
                            </View>
                        )}
                        <View style={styles.stageNode}>
                            <View style={styles.stageTopRow}>
                                <Text style={styles.stageForm}>{stage.form}</Text>
                                {stage.reading != null && stage.reading !== stage.form && (
                                    <Text style={styles.stageReading}>{stage.reading}</Text>
                                )}
                                <Text style={styles.stagePeriod}>{stage.period}</Text>
                            </View>
                            {stage.note != null && <Text style={styles.stageNote}>{stage.note}</Text>}
                        </View>
                    </React.Fragment>
                ))}
            </View>

            <Text style={styles.explanation}>{etymology.explanationZh}</Text>

            {etymology.source != null && (
                etymology.sourceUrl != null ? (
                    <TouchableOpacity
                        style={styles.sourceRow}
                        activeOpacity={0.7}
                        onPress={() => openSourceUrl(etymology.sourceUrl as string)}
                    >
                        <Text style={styles.sourceLinkText}>出典：{etymology.source}</Text>
                        <ExternalLink size={13} color={Colors.dark.primaryOrange} />
                    </TouchableOpacity>
                ) : (
                    <View style={styles.sourceRow}>
                        <Text style={styles.sourceText}>出典：{etymology.source}</Text>
                    </View>
                )
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        padding: Spacing.three,
        backgroundColor: '#16171B',
        borderRadius: BORDER_RADIUS.lg,
        width: '100%',
        borderWidth: 1,
        borderColor: '#2E3135',
    },
    badgeRow: {
        flexDirection: 'row',
        gap: Spacing.two,
        marginBottom: Spacing.three,
    },
    typeBadge: {
        backgroundColor: '#1C2939',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    typeBadgeText: {
        color: '#68A5FF',
        fontSize: 10,
        fontWeight: 'bold',
    },
    confidenceBadge: {
        backgroundColor: '#1D2B22',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    confidenceBadgeTentative: {
        backgroundColor: '#2E2418',
    },
    confidenceBadgeText: {
        color: '#7BC98F',
        fontSize: 10,
        fontWeight: 'bold',
    },
    confidenceBadgeTextTentative: {
        color: '#E0A458',
    },
    arrowWrap: {
        alignItems: 'center',
        paddingVertical: 2,
    },
    stageNode: {
        backgroundColor: '#1C1D22',
        borderRadius: BORDER_RADIUS.md,
        paddingHorizontal: Spacing.three,
        paddingVertical: Spacing.two,
    },
    stageTopRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.two,
    },
    stageForm: {
        color: Colors.dark.text,
        fontSize: 18,
        fontFamily: Fonts?.lineSeed,
        fontWeight: 'bold',
    },
    stageReading: {
        color: Colors.dark.textSecondary,
        fontSize: 12,
    },
    stagePeriod: {
        color: '#4F525A',
        fontSize: 10,
        marginLeft: 'auto',
    },
    stageNote: {
        color: Colors.dark.textSecondary,
        fontSize: 11,
        marginTop: 4,
    },
    explanation: {
        color: Colors.dark.text,
        fontSize: 14,
        lineHeight: 22,
        fontFamily: Fonts?.lineSeed,
        marginTop: Spacing.three,
    },
    sourceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: Spacing.three,
    },
    sourceText: {
        color: Colors.dark.textSecondary,
        fontSize: 12,
    },
    sourceLinkText: {
        color: Colors.dark.primaryOrange,
        fontSize: 12,
    },
});
