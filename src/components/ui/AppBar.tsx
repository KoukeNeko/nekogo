import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Colors, Spacing } from "../../constants/theme";

interface AppBarProps {
  leftContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  centerMode?: 'absolute' | 'flex'; // 'absolute' guarantees strict screen-centering, 'flex' fills space evenly between left and right items. Defaults to 'absolute'.
}

export function AppBar({ leftContent, centerContent, rightContent, centerMode = 'absolute' }: AppBarProps) {
  return (
    <View style={[styles.header]}>
      <View style={styles.topBar}>
        <View style={styles.leftArea}>{leftContent}</View>
        {centerContent && (
          <View style={[styles.centerArea, centerMode === 'flex' && styles.centerAreaFlex]}>
            {centerContent}
          </View>
        )}
        <View style={styles.rightArea}>{rightContent}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: Spacing.two,
    gap: Spacing.three,
  },
  leftArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    zIndex: 1,
  },
  centerArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    paddingHorizontal: 70, // for absolute mode, prevent overlap with left/right icons
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
    pointerEvents: 'none',
  },
  centerAreaFlex: {
    position: 'relative',
    flex: 1,
    paddingHorizontal: 0, // In flex mode, leftArea and rightArea already provide natural constraints
    pointerEvents: 'auto', // Flex items can handle their own touches if needed
  },
  rightArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    zIndex: 1,
  },
});
