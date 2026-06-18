import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing, BORDER_RADIUS, Fonts } from '../../constants/theme';
import { Rating } from 'ts-fsrs';

interface RatingButtonProps {
    rating: Rating;
    intervalLabel: string;
    onPress: (rating: Rating) => void;
}

interface RatingButtonsProps {
    onRating: (rating: Rating) => void;
    intervals?: {
        again: string;
        hard: string;
        good: string;
        easy: string;
    } | null;
}

export const RatingButtons: React.FC<RatingButtonsProps> = ({ onRating, intervals }) => {
    
    const buttons = [
        { rating: Rating.Again, label: 'もう一度', interval: intervals?.again || '<1m', color: Colors.dark.ratingAgain },
        { rating: Rating.Hard, label: '難しい', interval: intervals?.hard || '8m', color: Colors.dark.ratingHard },
        { rating: Rating.Good, label: '普通', interval: intervals?.good || '4d', color: Colors.dark.ratingGood },
        { rating: Rating.Easy, label: '簡単', interval: intervals?.easy || '9d', color: Colors.dark.ratingEasy },
    ];

    return (
        <View style={styles.wrapper}>
            <View style={styles.container}>
                {buttons.map((btn) => (
                    <TouchableOpacity 
                        key={btn.rating} 
                        style={[
                            styles.button, 
                            { borderTopColor: btn.color }
                        ]} 
                        onPress={() => onRating(btn.rating)}
                    >
                        <Text style={[styles.intervalText, { color: btn.color }]}>{btn.interval}</Text>
                        <Text style={styles.labelText}>{btn.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            <Text style={styles.footerText}>FSRS-6  •  目標定着率 90%</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        alignItems: 'center',
        paddingHorizontal: Spacing.four,
        paddingBottom: Spacing.two,
        width: '100%',
    },
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        gap: Spacing.two, // Modern React Native supports gap
        marginBottom: Spacing.four,
    },
    button: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#2E3135',
        borderTopWidth: 3,
        borderRadius: BORDER_RADIUS.md,
        height: 64,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#121316',
    },
    intervalText: {
        fontFamily: Fonts?.mono,
        fontSize: 14,
        fontWeight: 'bold',
        marginBottom: 2,
    },
    labelText: {
        color: Colors.dark.textSecondary,
        fontSize: 12,
    },
    footerText: {
        color: Colors.dark.textSecondary,
        fontSize: 10,
        letterSpacing: 1,
        marginTop: 6,
        height: 14,
    }
});
