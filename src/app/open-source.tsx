import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Colors, Spacing, Fonts, BORDER_RADIUS } from '../constants/theme';
import { AppBar } from '../components/ui/AppBar';
import { BackButton } from '../components/ui/BackButton';
import { LibraryItem } from '../components/ui/LibraryItem';

export default function OpenSourceScreen() {
    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <AppBar
                leftContent={<BackButton />}
                centerContent={<Text style={styles.headerTitle}>オープンソースライブラリ</Text>}
                rightContent={
                    <View style={styles.iconButton} pointerEvents="none">
                        <ChevronLeft size={28} color="transparent" />
                    </View>
                }
            />

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>このプロジェクト</Text>
                    <View style={styles.divider} />
                    <LibraryItem 
                        name="Nekogo" 
                        license="MIT License" 
                        description="An open-source Japanese learning application. Copyright (c) 2024 KoukeNeko." 
                        url="https://github.com/KoukeNeko/nekogo" 
                    />
                </View>

                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Core Frameworks</Text>
                    <View style={styles.divider} />
                    <LibraryItem 
                        name="React & React Native" 
                        license="MIT License" 
                        description="Copyright (c) Meta Platforms, Inc. and affiliates." 
                        url="https://reactnative.dev/" 
                    />
                    <View style={styles.innerDivider} />
                    <LibraryItem 
                        name="Expo" 
                        license="MIT License" 
                        description="Copyright (c) 2015-present 650 Industries, Inc. (dba Expo)" 
                        url="https://expo.dev/" 
                    />
                </View>

                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Data & Algorithm</Text>
                    <View style={styles.divider} />
                    <LibraryItem 
                        name="OP-SQLite" 
                        license="MIT License" 
                        description="High performance React Native SQLite library. Copyright (c) 2021 Oscar Franco." 
                        url="https://github.com/OP-Engineering/op-sqlite" 
                    />
                    <View style={styles.innerDivider} />
                    <LibraryItem 
                        name="ts-fsrs" 
                        license="MIT License" 
                        description="Free Spaced Repetition Scheduler (FSRS) implementation. Copyright (c) 2023 open-spaced-repetition." 
                        url="https://github.com/open-spaced-repetition/ts-fsrs" 
                    />
                </View>

                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>UI & Animation</Text>
                    <View style={styles.divider} />
                    <LibraryItem 
                        name="React Native Reanimated" 
                        license="MIT License" 
                        description="Copyright (c) 2020 Software Mansion" 
                        url="https://github.com/software-mansion/react-native-reanimated" 
                    />
                    <View style={styles.innerDivider} />
                    <LibraryItem 
                        name="Lucide React Native" 
                        license="ISC License" 
                        description="Beautiful & consistent icons. Copyright (c) 2022 Lucide Contributors." 
                        url="https://lucide.dev/" 
                    />
                    <View style={styles.innerDivider} />
                    <LibraryItem 
                        name="React Native SVG" 
                        license="MIT License" 
                        description="SVG library for React Native. Copyright (c) 2015 Horcrux." 
                        url="https://github.com/software-mansion/react-native-svg" 
                    />
                    <View style={styles.innerDivider} />
                    <LibraryItem 
                        name="Gorhom Bottom Sheet" 
                        license="MIT License" 
                        description="A performant interactive bottom sheet with fully configurable options. Copyright (c) 2020 Mo Gorhom." 
                        url="https://github.com/gorhom/react-native-bottom-sheet" 
                    />
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.dark.background,
    },
    iconButton: {
        padding: Spacing.one,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: Colors.dark.text,
    },
    content: {
        paddingTop: 24,
        paddingHorizontal: Spacing.three,
        paddingBottom: Spacing.six,
        gap: Spacing.four,
    },
    card: {
        backgroundColor: '#16171B',
        borderRadius: BORDER_RADIUS.lg,
        padding: Spacing.four,
        borderWidth: 1,
        borderColor: '#2E3135',
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: Colors.dark.primaryOrange,
        fontFamily: Fonts?.sans,
        marginBottom: Spacing.three,
    },
    divider: {
        height: 1,
        backgroundColor: '#2E3135',
        marginBottom: Spacing.three,
    },
    innerDivider: {
        height: 1,
        backgroundColor: '#2E3135',
        marginVertical: Spacing.three,
        opacity: 0.5,
    }
});
