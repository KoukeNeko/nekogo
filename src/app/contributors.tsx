import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Colors, Spacing, Fonts, BORDER_RADIUS } from '../constants/theme';
import { AppBar } from '../components/ui/AppBar';
import { BackButton } from '../components/ui/BackButton';

export default function ContributorsScreen() {
    const router = useRouter();
    const [contributors, setContributors] = useState<{ id: number, login: string, avatar_url: string, html_url: string, contributions: number }[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('https://api.github.com/repos/KoukeNeko/nekogo/contributors')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setContributors(data);
                }
            })
            .catch(e => console.log('Failed to fetch contributors:', e))
            .finally(() => setLoading(false));
    }, []);

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <AppBar
                leftContent={
                    <BackButton />
                }
                centerContent={
                    <Text style={styles.headerTitle}>開発者 / Contributors</Text>
                }
                rightContent={
                    <View style={styles.iconButton} pointerEvents="none">
                        <ChevronLeft size={28} color="transparent" />
                    </View>
                }
            />

            {loading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={Colors.dark.primaryOrange} />
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    {contributors.map((c) => (
                        <TouchableOpacity 
                            key={c.id} 
                            style={styles.card}
                            activeOpacity={0.7}
                            onPress={() => Linking.openURL(c.html_url)}
                        >
                            <View style={styles.row}>
                                <Image source={{ uri: c.avatar_url }} style={styles.avatar} />
                                <View style={styles.info}>
                                    <Text style={styles.name}>{c.login}</Text>
                                    <Text style={styles.commits}>{c.contributions} commits</Text>
                                </View>
                                <FontAwesome name="github" size={20} color={Colors.dark.textSecondary} />
                            </View>
                        </TouchableOpacity>
                    ))}

                    <View style={styles.footer}>
                        <TouchableOpacity 
                            style={styles.githubButton}
                            onPress={() => Linking.openURL('https://github.com/KoukeNeko/nekogo')}
                        >
                            <FontAwesome name="github" size={20} color={Colors.dark.text} />
                            <Text style={styles.githubButtonText}>リポジトリを見る</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            )}
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
        paddingTop: Spacing.four,
        paddingHorizontal: Spacing.three,
        paddingBottom: Spacing.six,
        gap: Spacing.three,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    card: {
        backgroundColor: '#16171B',
        borderRadius: BORDER_RADIUS.lg,
        padding: Spacing.three,
        borderWidth: 1,
        borderColor: '#2E3135',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        marginRight: Spacing.three,
    },
    info: {
        flex: 1,
        justifyContent: 'center',
    },
    name: {
        fontSize: 16,
        fontWeight: 'bold',
        color: Colors.dark.text,
        marginBottom: 4,
    },
    commits: {
        fontSize: 13,
        color: Colors.dark.textSecondary,
    },
    footer: {
        marginTop: Spacing.four,
        alignItems: 'center',
    },
    githubButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#2E3135',
        paddingHorizontal: Spacing.four,
        paddingVertical: 12,
        borderRadius: BORDER_RADIUS.round,
        gap: Spacing.two,
    },
    githubButtonText: {
        color: Colors.dark.text,
        fontSize: 15,
        fontWeight: 'bold',
    }
});
