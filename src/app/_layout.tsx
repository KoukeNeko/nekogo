import { Stack } from "expo-router";
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { SettingsProvider } from '../context/SettingsContext';
import { initDB } from '../db/schema';
import { attachContentDb } from '../db/contentDb';
import { seedDatabaseIfEmpty } from '../db/seed';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);
  const [loaded, error] = useFonts({
    'SourceHanSerif-Regular': require('../../assets/fonts/SourceHanSerifJP-Regular.otf'),
    'SourceHanSerif-Bold': require('../../assets/fonts/SourceHanSerifJP-Bold.otf'),
  });

  // DB 初始化需先掛載唯讀內容庫（async 複製），再建主庫資料表與種子。
  useEffect(() => {
    (async () => {
      try {
        initDB();
        await attachContentDb();
        seedDatabaseIfEmpty();
      } catch (dbError) {
        console.error('❌ 資料庫初始化失敗:', dbError);
      } finally {
        setDbReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if ((loaded || error) && dbReady) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error, dbReady]);

  if ((!loaded && !error) || !dbReady) {
    return null;
  }

  return (
    <SettingsProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="review" />
        <Stack.Screen name="licenses" />
      </Stack>
    </SettingsProvider>
  );
}
