import React from "react";
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Colors, Spacing, BORDER_RADIUS } from "../../constants/theme";
import { Settings, User, Flame } from "lucide-react-native";
import { AppBar } from "../../components/ui/AppBar";

export default function Home() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <AppBar 
        leftContent={
          <TouchableOpacity style={styles.iconButton}>
            <Settings size={24} color={Colors.dark.textSecondary} />
          </TouchableOpacity>
        }
        rightContent={
          <>
            <View style={styles.streakContainer}>
              <Flame size={20} color={Colors.dark.primaryOrange} />
              <Text style={styles.streakText}>12</Text>
            </View>
            <TouchableOpacity style={styles.avatarButton}>
              <User size={24} color={Colors.dark.textSecondary} />
            </TouchableOpacity>
          </>
        }
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* Goal Area (Simplified) */}
        <View style={styles.goalSection}>
          <Text style={styles.sectionTitle}>今日の目標</Text>
          <View style={styles.goalCard}>
            <Text style={styles.goalProgressText}>23 / 87</Text>
            <Text style={styles.goalSubText}>Card reviews remaining today</Text>
          </View>
        </View>

        {/* Decks Area */}
        <View style={styles.deckSection}>
          <Text style={styles.sectionTitle}>デッキ</Text>
          
          <TouchableOpacity 
            style={styles.deckCard} 
            onPress={() => router.push("/review")}
          >
            <View style={styles.deckInfo}>
              <Text style={styles.deckTitle}>JLPT N5</Text>
              <Text style={styles.deckSubtitle}>Basic Japanese Vocabulary</Text>
            </View>
            <View style={styles.deckStats}>
              <Text style={styles.dueText}>23 Due</Text>
              <View style={styles.actionButton}>
                <Text style={styles.actionButtonText}>復習する</Text>
              </View>
            </View>
          </TouchableOpacity>
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
  scrollContent: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
  },
  iconButton: {
    padding: Spacing.two,
  },
  streakContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1D22',
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.round,
    gap: 4,
  },
  streakText: {
    color: Colors.dark.primaryOrange,
    fontWeight: 'bold',
    fontSize: 16,
  },
  avatarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1C1D22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: Spacing.three,
  },
  goalSection: {
    marginBottom: Spacing.six,
  },
  goalCard: {
    backgroundColor: '#1C1D22',
    borderRadius: BORDER_RADIUS.lg,
    padding: Spacing.four,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2E3135',
  },
  goalProgressText: {
    color: Colors.dark.text,
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: Spacing.one,
  },
  goalSubText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  deckSection: {
    flex: 1,
  },
  deckCard: {
    backgroundColor: '#1C1D22',
    borderRadius: BORDER_RADIUS.lg,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: '#2E3135',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deckInfo: {
    flex: 1,
  },
  deckTitle: {
    color: Colors.dark.text,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: Spacing.one,
  },
  deckSubtitle: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  deckStats: {
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  dueText: {
    color: Colors.dark.primaryOrange,
    fontWeight: 'bold',
    fontSize: 14,
  },
  actionButton: {
    backgroundColor: Colors.dark.primaryOrange,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    borderRadius: BORDER_RADIUS.md,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  }
});
