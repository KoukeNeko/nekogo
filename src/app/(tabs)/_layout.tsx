import { Tabs } from "expo-router";
import { Colors } from "../../constants/theme";
import { Home, Layers, BarChart2, User } from "lucide-react-native";
import { StyleSheet, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import React, { useEffect } from "react";

// M3 Expressive 的彈簧參數：低阻尼讓藥丸展開帶一點過衝（bouncy）。
const PILL_SPRING = { damping: 14, stiffness: 220 };
// 藥丸底色：品牌橘的低透明 tonal（對應 M3 secondaryContainer 角色）。
const PILL_COLOR = 'rgba(255, 107, 53, 0.22)';

/**
 * Material 3 Expressive 的分頁圖示：聚焦時圖示後方展開藥丸形 active indicator。
 * 僅 Android 套用（iOS 維持原本樣式，直接回傳圖示）。
 */
function ExpressiveIcon({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  const progress = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(focused ? 1 : 0, PILL_SPRING);
  }, [focused, progress]);
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: 0.6 + 0.4 * progress.value }],
    opacity: progress.value,
  }));

  if (Platform.OS !== 'android') {
    return <>{children}</>;
  }
  return (
    <View style={styles.iconWrap}>
      <Animated.View style={[styles.pill, pillStyle]} />
      {children}
    </View>
  );
}

export default function TabLayout() {
  // Android 手勢導覽（edge-to-edge）的系統列 inset：bar 高度與底部 padding 都要加上，標籤才不會被手勢條蓋住。
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Android：M3 Expressive nav bar（surface container 底、無頂線、藥丸 indicator、標籤在下）。
        // iOS：維持原本實色 + 頂線樣式。
        tabBarStyle: Platform.OS === 'android'
          ? {
              backgroundColor: Colors.dark.backgroundElement,
              borderTopWidth: 0,
              elevation: 0,
              height: 80 + insets.bottom,
              paddingBottom: 12 + insets.bottom,
              paddingTop: 12,
            }
          : {
              backgroundColor: Colors.dark.background,
              borderTopColor: '#2E3135',
              borderTopWidth: 1,
              height: 85,
              paddingBottom: 16,
              paddingTop: 10,
            },
        // Android 移除預設的圓形 ripple 按壓效果（改用普通 Pressable，無回饋；選中狀態已有藥丸 indicator）。
        tabBarButton: Platform.OS === 'android'
          ? (props) => <Pressable {...(props as any)} android_ripple={undefined} />
          : undefined,
        tabBarActiveTintColor: Colors.dark.primaryOrange,
        tabBarInactiveTintColor: Colors.dark.textSecondary,
        tabBarLabelStyle: Platform.OS === 'android'
          ? {
              fontSize: 12,
              fontWeight: '600',
              marginTop: 4,
            }
          : {
              fontSize: 10,
              fontWeight: '500',
            },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "ホーム",
          tabBarIcon: ({ color, focused }) => (
            <ExpressiveIcon focused={focused}>
              <Home size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
            </ExpressiveIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="decks"
        options={{
          title: "デッキ",
          tabBarIcon: ({ color, focused }) => (
            <ExpressiveIcon focused={focused}>
              <Layers size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
            </ExpressiveIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: "統計",
          tabBarIcon: ({ color, focused }) => (
            <ExpressiveIcon focused={focused}>
              <BarChart2 size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
            </ExpressiveIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "マイページ",
          tabBarIcon: ({ color, focused }) => (
            <ExpressiveIcon focused={focused}>
              <User size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
            </ExpressiveIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="deck"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // M3 藥丸 active indicator：64×32 膠囊，包住 24dp 圖示。
  iconWrap: {
    width: 64,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    backgroundColor: PILL_COLOR,
  },
});
