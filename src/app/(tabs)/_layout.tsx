import { Tabs } from "expo-router";
import { Colors } from "../../constants/theme";
import { Home, Layers, BarChart2, User } from "lucide-react-native";
import { BlurView } from "expo-blur";
import { StyleSheet, Platform } from "react-native";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarBackground: () => (
          <BlurView 
            tint="dark" 
            intensity={80} 
            style={StyleSheet.absoluteFill} 
          />
        ),
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: Platform.OS === 'android' ? 'rgba(18, 19, 22, 0.9)' : 'rgba(18, 19, 22, 0.5)',
          borderTopWidth: 0,
          elevation: 0,
          height: 85,
          paddingBottom: 16,
          paddingTop: 10,
        },
        tabBarActiveTintColor: Colors.dark.primaryOrange,
        tabBarInactiveTintColor: Colors.dark.textSecondary,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
        }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "ホーム",
          tabBarIcon: ({ color }) => <Home size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="decks"
        options={{
          title: "デッキ",
          tabBarIcon: ({ color }) => <Layers size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: "統計",
          tabBarIcon: ({ color }) => <BarChart2 size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "マイページ",
          tabBarIcon: ({ color }) => <User size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
