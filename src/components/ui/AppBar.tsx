import React from "react";
import { View, StyleSheet } from "react-native";
import { Colors, Spacing } from "../../constants/theme";

interface AppBarProps {
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export function AppBar({ leftContent, rightContent }: AppBarProps) {
  return (
    <View style={styles.header}>
      <View style={styles.topBar}>
        <View style={styles.leftArea}>{leftContent}</View>
        <View style={styles.rightArea}>{rightContent}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 44,
    marginBottom: Spacing.three,
  },
  leftArea: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rightArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
});
