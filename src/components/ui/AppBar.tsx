import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Colors, Spacing } from "../../constants/theme";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface AppBarProps {
  leftContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export function AppBar({ leftContent, centerContent, rightContent }: AppBarProps) {
  const insets = useSafeAreaInsets();
  
  return (
    <BlurView 
      intensity={80} 
      tint="dark" 
      style={[
        styles.header, 
        { paddingTop: Math.max(insets.top, 12) + Spacing.one } // Reduced padding
      ]}
    >
      <View style={styles.topBar}>
        <View style={styles.leftArea}>{leftContent}</View>
        {centerContent && <View style={styles.centerArea}>{centerContent}</View>}
        <View style={styles.rightArea}>{rightContent}</View>
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: Spacing.four,
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
