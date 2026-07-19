import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Colors, Spacing, Fonts } from "../constants/theme";
import { ChevronLeft } from "lucide-react-native";
import { AppBar } from "../components/ui/AppBar";
import { BackButton } from "../components/ui/BackButton";
import { SettingsCard, SettingsRow, SettingsDivider } from "../components/ui/SettingsCard";
import { useSettings, StrokeSpeed } from "../context/SettingsContext";
import { getReviewLogCount, optimizeParameters } from "../services/fsrsOptimizer";
import { MIN_REVIEWS_TO_OPTIMIZE } from "../services/fsrsTraining";
import {
  DAILY_NEW_LIMIT_OPTIONS,
  getDailyNewLimit,
  setDailyNewLimit,
  TARGET_RETENTION_OPTIONS,
  getTargetRetention,
  setTargetRetention,
  getTtsServerUrl,
  normalizeTtsServerUrl,
  setTtsServerUrl,
} from "../db/repositories/uiSettingsRepository";
import { applyStoredParameters } from "../services/fsrs";
import { cleanupContentAssetCaches, getContentAssetCacheBytes } from "../db/contentDb";
import {
  checkTtsServer,
  clearDictionaryAudioCache,
  getDictionaryAudioCacheBytes,
} from "../services/dictionaryAudio";

export default function SettingsScreen() {
  const router = useRouter();

  const [dailyNewLimit, setDailyNewLimitState] = useState<number>(() => getDailyNewLimit());
  const [targetRetention, setTargetRetentionState] = useState<number>(() => getTargetRetention());
  const [contentCacheBytes, setContentCacheBytes] = useState<number | null>(null);
  const [ttsCacheBytes, setTtsCacheBytes] = useState<number>(() => getDictionaryAudioCacheBytes());
  const [savedTtsServerUrl, setSavedTtsServerUrl] = useState(() => getTtsServerUrl());
  const [ttsServerUrlInput, setTtsServerUrlInput] = useState(savedTtsServerUrl);
  const [testingTtsServer, setTestingTtsServer] = useState(false);

  const { strokeSpeed, setStrokeSpeed, translationLanguage, setTranslationLanguage } = useSettings();

  // FSRS 參數最適化（用本機複習歷史訓練）。
  const [reviewCount, setReviewCount] = useState(0);
  const [optimizing, setOptimizing] = useState(false);

  useEffect(() => {
    try {
      setReviewCount(getReviewLogCount());
    } catch (error) {
      console.error('讀取複習筆數失敗', error);
    }
    getContentAssetCacheBytes().then(setContentCacheBytes).catch(() => setContentCacheBytes(0));
  }, []);

  const handleClearCache = async () => {
    await cleanupContentAssetCaches();
    const remainingBytes = await getContentAssetCacheBytes().catch(() => 0);
    setContentCacheBytes(remainingBytes);
    Alert.alert('キャッシュを削除', 'コンテンツキャッシュを削除しました');
  };

  const handleSaveTtsServer = () => {
    try {
      const normalized = setTtsServerUrl(ttsServerUrlInput);
      if (normalized !== savedTtsServerUrl) {
        clearDictionaryAudioCache();
        setTtsCacheBytes(0);
      }
      setSavedTtsServerUrl(normalized);
      setTtsServerUrlInput(normalized);
      Alert.alert('音声サーバー', normalized ? 'サーバー URL を保存しました' : 'オンライン音声を無効にしました');
    } catch (error) {
      Alert.alert('音声サーバー', error instanceof Error ? error.message : 'URL が正しくありません');
    }
  };

  const handleTestTtsServer = async () => {
    if (testingTtsServer) return;
    try {
      const normalized = normalizeTtsServerUrl(ttsServerUrlInput);
      if (!normalized) {
        Alert.alert('接続確認', '先に音声サーバー URL を入力してください');
        return;
      }
      setTestingTtsServer(true);
      const result = await checkTtsServer(normalized);
      Alert.alert('接続確認', `接続できました\n${result.audioProfile}`);
    } catch (error) {
      Alert.alert('接続確認', `接続できませんでした\n${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      setTestingTtsServer(false);
    }
  };

  const handleClearTtsCache = () => {
    clearDictionaryAudioCache();
    setTtsCacheBytes(0);
    Alert.alert('音声キャッシュ', 'ダウンロード済み音声を削除しました');
  };

  const handleOptimize = async () => {
    if (optimizing) return;
    setOptimizing(true);
    try {
      const outcome = await optimizeParameters();
      setReviewCount(outcome.reviewCount);
      Alert.alert('パラメータ最適化', outcome.message);
    } catch (error) {
      console.error('最適化エラー', error);
      Alert.alert('パラメータ最適化', '予期せぬエラーが発生しました');
    } finally {
      setOptimizing(false);
    }
  };

  const getSpeedLabel = (speed: StrokeSpeed) => {
    switch (speed) {
      case StrokeSpeed.Slow: return '遅い';
      case StrokeSpeed.Normal: return '標準';
      case StrokeSpeed.Fast: return '速い';
    }
  };

  const getSpeedValueFromLabel = (label: string): StrokeSpeed => {
    switch (label) {
      case '遅い': return StrokeSpeed.Slow;
      case '標準': return StrokeSpeed.Normal;
      case '速い': return StrokeSpeed.Fast;
      default: return StrokeSpeed.Normal;
    }
  };

  const renderSegment = (options: string[], active: string, onChange: (value: string) => void) => (
    <View style={styles.segmentControl}>
      {options.map((opt) => {
        const isActive = active === opt;

        return (
          <TouchableOpacity
            key={opt}
            style={[styles.segmentButton, isActive && styles.segmentButtonActive]}
            onPress={() => onChange(opt)}
          >
            <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppBar
        leftContent={
          <BackButton />
        }
        centerContent={
          <Text style={styles.headerTitle}>設定</Text>
        }
        rightContent={
          <View style={styles.iconButton} pointerEvents="none">
            <ChevronLeft size={28} color="transparent" />
          </View>
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Section 1: Engine */}
        <View style={styles.sectionHeader}>
          <View style={styles.redDot} />
          <Text style={styles.sectionTitle}>学習エンジン ・ FSRS-6</Text>
        </View>

        <SettingsCard>
          <SettingsRow label="目標定着率">
            {renderSegment(
              TARGET_RETENTION_OPTIONS.map((r) => `${Math.round(r * 100)}%`),
              `${Math.round(targetRetention * 100)}%`,
              (val: string) => {
                const retention = Number(val.replace('%', '')) / 100;
                setTargetRetentionState(retention);
                setTargetRetention(retention);
                applyStoredParameters(); // 立即以新定着率重建排程器
              },
            )}
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow label="1日の新規カード上限">
            {renderSegment(
              DAILY_NEW_LIMIT_OPTIONS.map(String),
              String(dailyNewLimit),
              (val: string) => {
                const limit = Number(val);
                setDailyNewLimitState(limit);
                setDailyNewLimit(limit);
              },
            )}
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow
            label="パラメータ最適化"
            subLabel={
              reviewCount >= MIN_REVIEWS_TO_OPTIMIZE
                ? `${reviewCount.toLocaleString()}件のログで再学習`
                : `あと${(MIN_REVIEWS_TO_OPTIMIZE - reviewCount).toLocaleString()}件で利用可能（${reviewCount.toLocaleString()}/${MIN_REVIEWS_TO_OPTIMIZE.toLocaleString()}）`
            }
            paddingVertical={12}
          >
            <TouchableOpacity
              style={[
                styles.actionButton,
                (optimizing || reviewCount < MIN_REVIEWS_TO_OPTIMIZE) && { opacity: 0.4 },
              ]}
              onPress={handleOptimize}
              disabled={optimizing || reviewCount < MIN_REVIEWS_TO_OPTIMIZE}
            >
              <Text style={styles.actionButtonText}>{optimizing ? '実行中…' : '実行'}</Text>
            </TouchableOpacity>
          </SettingsRow>
        </SettingsCard>

        {/* Section 2: Display */}
        <Text style={styles.sectionHeaderLabel}>表示</Text>
        <SettingsCard>
          <SettingsRow label="翻訳の言語" subLabel="語義と例文の表示言語">
            {renderSegment(
              ['繁體中文', 'English'],
              translationLanguage === 'zh' ? '繁體中文' : 'English',
              (val: string) => setTranslationLanguage(val === '繁體中文' ? 'zh' : 'en'),
            )}
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow label="筆順アニメ速度">
            {renderSegment(['遅い', '標準', '速い'], getSpeedLabel(strokeSpeed), (val) => setStrokeSpeed(getSpeedValueFromLabel(val)))}
          </SettingsRow>
        </SettingsCard>

        {/* Section 3: Audio */}
        <Text style={styles.sectionHeaderLabel}>音声</Text>
        <SettingsCard>
          <View style={styles.serverEditor}>
            <Text style={styles.serverEditorLabel}>音声サーバー</Text>
            <Text style={styles.serverEditorSubLabel}>空欄にすると端末の読み上げのみを使用します</Text>
            <TextInput
              value={ttsServerUrlInput}
              onChangeText={setTtsServerUrlInput}
              placeholder="http://192.168.50.169:8090"
              placeholderTextColor="#555861"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.serverInput}
            />
            <View style={styles.serverActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => void handleTestTtsServer()} disabled={testingTtsServer}>
                <Text style={styles.secondaryButtonText}>{testingTtsServer ? '確認中…' : '接続確認'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleSaveTtsServer}>
                <Text style={styles.saveButtonText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
          <SettingsDivider />
          <SettingsRow
            label="音声キャッシュを削除"
            valueText={`${(ttsCacheBytes / (1024 * 1024)).toFixed(1)} MB`}
            onPress={handleClearTtsCache}
          />
        </SettingsCard>

        {/* Section 4: Data */}
        <Text style={styles.sectionHeaderLabel}>データ</Text>
        <SettingsCard>
          <SettingsRow
            label="キャッシュを削除"
            valueText={contentCacheBytes == null ? '…' : `${(contentCacheBytes / (1024 * 1024)).toFixed(1)} MB`}
            onPress={handleClearCache}
          />
        </SettingsCard>

        {/* Section 5: About / Legal */}
        <Text style={styles.sectionHeaderLabel}>情報</Text>
        <SettingsCard>
          <SettingsRow
            label="ライセンス"
            showChevron
            onPress={() => router.push('/licenses')}
          />
          <SettingsDivider />
          <SettingsRow
            label="オープンソース"
            showChevron
            onPress={() => router.push('/open-source')}
          />
          <SettingsDivider />
          <SettingsRow
            label="コントリビューター"
            showChevron
            onPress={() => router.push('/contributors')}
          />
        </SettingsCard>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Kioku v1.0.0 (1024)</Text>
          <Text style={styles.footerText}>Made with ❤️ for Japanese Learners</Text>
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
  iconButton: {
    padding: Spacing.one,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  scrollContent: {
    paddingTop: 24,
    padding: Spacing.three,
    paddingBottom: Spacing.five,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  redDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.dark.primaryOrange,
    marginRight: Spacing.two,
  },
  sectionTitle: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
  },
  sectionHeaderLabel: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  segmentControl: {
    flexDirection: 'row',
    backgroundColor: '#0F1014',
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: '#1C1D22',
  },
  segmentButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#202636',
  },
  segmentText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  segmentTextActive: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  actionButton: {
    backgroundColor: Colors.dark.primaryOrange,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  serverEditor: {
    paddingVertical: 14,
  },
  serverEditorLabel: {
    color: Colors.dark.text,
    fontSize: 15,
  },
  serverEditorSubLabel: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    marginTop: Spacing.one,
  },
  serverInput: {
    marginTop: Spacing.three,
    borderWidth: 1,
    borderColor: '#2E3135',
    borderRadius: 8,
    backgroundColor: '#0F1014',
    color: Colors.dark.text,
    fontFamily: Fonts?.mono,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  serverActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#2E3135',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: Colors.dark.primaryOrange,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  footer: {
    alignItems: 'center',
    marginTop: Spacing.five,
    gap: Spacing.one,
  },
  footerText: {
    color: Colors.dark.textSecondary,
    fontSize: 11,
    fontFamily: Fonts?.mono,
  }
});
