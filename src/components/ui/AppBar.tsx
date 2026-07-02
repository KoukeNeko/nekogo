import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Colors, Spacing } from "../../constants/theme";

interface AppBarProps {
  leftContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export function AppBar({ leftContent, centerContent, rightContent }: AppBarProps) {
  return (
    <View style={[styles.header]}>
      <View style={styles.topBar}>
        <View style={styles.leftArea}>{leftContent}</View>
        {centerContent && <View style={styles.centerArea}>{centerContent}</View>}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
    pointerEvents: 'none',
  },
  rightArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    zIndex: 1,
  },
});
