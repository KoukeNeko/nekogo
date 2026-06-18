import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Spacing } from "../../constants/theme";

interface AppBarProps {
  leftContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export function AppBar({ leftContent, centerContent, rightContent }: AppBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.floatingContainer, { paddingTop: Math.max(insets.top, Spacing.two) }]} pointerEvents="box-none">
      <LinearGradient
        colors={[
          Colors.dark.background,
          Colors.dark.background,
          `${Colors.dark.background}E6`,
          `${Colors.dark.background}B3`,
          `${Colors.dark.background}80`,
          `${Colors.dark.background}4D`,
          `${Colors.dark.background}00`
        ]}
        locations={[0, 0.4, 0.6, 0.75, 0.85, 0.95, 1]}
        style={[StyleSheet.absoluteFill, { bottom: -Spacing.four }]}
        pointerEvents="box-none"
      />
      <View style={[styles.header]} pointerEvents="auto">
        <View style={styles.topBar}>
          <View style={styles.leftArea}>{leftContent}</View>
          {centerContent && <View style={styles.centerArea}>{centerContent}</View>}
          <View style={styles.rightArea}>{rightContent}</View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  floatingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 36, // Reduced from 44
    marginBottom: Spacing.two, // Reduced from three
  },
  leftArea: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centerArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
});
