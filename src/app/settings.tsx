import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, PermissionsAndroid, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Colors, Spacing, Fonts } from "../constants/theme";
import { ChevronLeft, Download, Pause, Play, RefreshCw, Trash2 } from "lucide-react-native";
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
  type DictionaryAudioManifestSummary,
  getDictionaryAudioCacheBytes,
  getDictionaryAudioManifestSummary,
} from "../services/dictionaryAudio";
import {
  clearDictionaryAudioSync,
  getDictionaryAudioSyncStatus,
  pauseDictionaryAudioSync,
  resumeDictionaryAudioSync,
  startDictionaryAudioSync,
  subscribeToDictionaryAudioSync,
  type DictionaryAudioSyncStatus,
} from "../services/dictionaryAudioSync";

const EMPTY_AUDIO_SYNC_STATUS: DictionaryAudioSyncStatus = {
  state: 'idle',
  profileId: null,
  format: null,
  readyCount: 0,
  expectedCount: 0,
  downloadedCount: 0,
  failedCount: 0,
  totalBytes: 0,
  downloadedBytes: 0,
  lastError: null,
  allowCellular: false,
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gib = bytes / (1024 ** 3);
  return gib >= 1 ? `${gib.toFixed(2)} GB` : `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
};

const percentage = (value: number, total: number): string =>
  total > 0 ? `${(value / total * 100).toFixed(value >= total ? 0 : 2)}%` : '0%';

const syncStateLabel = (state: DictionaryAudioSyncStatus['state']): string => ({
  idle: '未ダウンロード',
  preparing: '準備中',
  downloading: 'ダウンロード中',
  paused: '一時停止',
  completed: '同期済み',
  completed_with_errors: '一部失敗',
  failed: '失敗',
})[state];

export default function SettingsScreen() {
  const router = useRouter();

  const [dailyNewLimit, setDailyNewLimitState] = useState<number>(() => getDailyNewLimit());
  const [targetRetention, setTargetRetentionState] = useState<number>(() => getTargetRetention());
  const [contentCacheBytes, setContentCacheBytes] = useState<number | null>(null);
  const [ttsCacheBytes, setTtsCacheBytes] = useState<number>(() => getDictionaryAudioCacheBytes());
  const [savedTtsServerUrl, setSavedTtsServerUrl] = useState(() => getTtsServerUrl());
  const [ttsServerUrlInput, setTtsServerUrlInput] = useState(savedTtsServerUrl);
  const [testingTtsServer, setTestingTtsServer] = useState(false);
  const [audioManifest, setAudioManifest] = useState<DictionaryAudioManifestSummary | null>(null);
  const [audioSyncStatus, setAudioSyncStatus] = useState<DictionaryAudioSyncStatus>(EMPTY_AUDIO_SYNC_STATUS);
  const [audioSyncBusy, setAudioSyncBusy] = useState(false);

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
    void getDictionaryAudioSyncStatus().then(setAudioSyncStatus).catch((error) => {
      console.warn('高品質音声の状態を取得できませんでした', error);
    });
    const subscription = subscribeToDictionaryAudioSync(setAudioSyncStatus);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!savedTtsServerUrl) {
      setAudioManifest(null);
      return;
    }
    void getDictionaryAudioManifestSummary(savedTtsServerUrl).then(setAudioManifest).catch(() => setAudioManifest(null));
  }, [savedTtsServerUrl]);

  useEffect(() => {
    if (!['preparing', 'downloading'].includes(audioSyncStatus.state)) return;
    const timer = setInterval(() => {
      void getDictionaryAudioSyncStatus().then(setAudioSyncStatus).catch(() => undefined);
    }, 2_000);
    return () => clearInterval(timer);
  }, [audioSyncStatus.state]);

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
      const manifest = await getDictionaryAudioManifestSummary(normalized);
      setAudioManifest(manifest);
      Alert.alert('接続確認', `接続できました\n${result.audioProfile}`);
    } catch (error) {
      Alert.alert('接続確認', `接続できませんでした\n${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      setTestingTtsServer(false);
    }
  };

  const runAudioSync = async (allowCellular: boolean) => {
    if (audioSyncBusy) return;
    setAudioSyncBusy(true);
    try {
      const normalizedInput = normalizeTtsServerUrl(ttsServerUrlInput);
      if (!savedTtsServerUrl || normalizedInput !== savedTtsServerUrl) {
        Alert.alert('高品質音声', '先に音声サーバー URL を保存してください');
        return;
      }
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      const status = await startDictionaryAudioSync(savedTtsServerUrl, allowCellular);
      setAudioSyncStatus(status);
    } catch (error) {
      Alert.alert('高品質音声を開始できませんでした', error instanceof Error ? error.message : '不明なエラー');
    } finally {
      setAudioSyncBusy(false);
    }
  };

  const confirmMobileAudioSync = () => {
    Alert.alert(
      'モバイル通信を使用しますか？',
      '音声データは大容量です。通信量が発生する可能性があります。',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'モバイル通信を許可', style: 'destructive', onPress: () => void runAudioSync(true) },
      ],
    );
  };

  const confirmInitialAudioSync = async () => {
    if (audioSyncBusy) return;
    setAudioSyncBusy(true);
    let manifest = audioManifest;
    try {
      const normalizedInput = normalizeTtsServerUrl(ttsServerUrlInput);
      if (!savedTtsServerUrl || normalizedInput !== savedTtsServerUrl) {
        Alert.alert('高品質音声', '先に音声サーバー URL を保存してください');
        return;
      }
      manifest = await getDictionaryAudioManifestSummary(savedTtsServerUrl);
      setAudioManifest(manifest);
    } catch (error) {
      Alert.alert('高品質音声', `Server の音声一覧を取得できませんでした\n${error instanceof Error ? error.message : '不明なエラー'}`);
      return;
    } finally {
      setAudioSyncBusy(false);
    }
    const estimatedFullBytes = manifest.readyCount > 0
      ? manifest.totalBytes / manifest.readyCount * manifest.expectedCount
      : 0;
    Alert.alert(
      '高品質音声をダウンロード',
      `現在 ${manifest.readyCount.toLocaleString()} 件（${formatBytes(manifest.totalBytes)}）を同期します。\n全件生成後の論理容量見込み: ${formatBytes(estimatedFullBytes)}\n\n音声は App の書類領域に個別保存されます。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'Wi-Fiのみ', onPress: () => void runAudioSync(false) },
        { text: 'モバイル通信も許可', onPress: confirmMobileAudioSync },
      ],
    );
  };

  const handlePauseAudioSync = async () => {
    setAudioSyncBusy(true);
    try { setAudioSyncStatus(await pauseDictionaryAudioSync()); }
    catch (error) { Alert.alert('一時停止できませんでした', error instanceof Error ? error.message : '不明なエラー'); }
    finally { setAudioSyncBusy(false); }
  };

  const handleResumeAudioSync = async () => {
    setAudioSyncBusy(true);
    try { setAudioSyncStatus(await resumeDictionaryAudioSync(audioSyncStatus.allowCellular)); }
    catch (error) { Alert.alert('同期を再開できませんでした', error instanceof Error ? error.message : '不明なエラー'); }
    finally { setAudioSyncBusy(false); }
  };

  const confirmClearAudioSync = () => {
    Alert.alert(
      '音声データを削除',
      '持続保存された高品質音声をすべて削除します。通常の音声キャッシュは別に削除できます。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'すべて削除',
          style: 'destructive',
          onPress: () => {
            setAudioSyncBusy(true);
            void clearDictionaryAudioSync()
              .then(setAudioSyncStatus)
              .catch((error) => Alert.alert('削除できませんでした', error instanceof Error ? error.message : '不明なエラー'))
              .finally(() => setAudioSyncBusy(false));
          },
        },
      ],
    );
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

  const serverReadyCount = audioManifest?.readyCount ?? audioSyncStatus.readyCount;
  const serverExpectedCount = audioManifest?.expectedCount ?? audioSyncStatus.expectedCount;
  const serverTotalBytes = audioManifest?.totalBytes ?? audioSyncStatus.totalBytes;
  const profileId = audioManifest?.profileId ?? audioSyncStatus.profileId;
  const audioFormat = audioManifest?.format ?? audioSyncStatus.format;
  const estimatedFullBytes = serverReadyCount > 0
    ? serverTotalBytes / serverReadyCount * serverExpectedCount
    : 0;
  const syncIsActive = audioSyncStatus.state === 'preparing' || audioSyncStatus.state === 'downloading';
  const hasPersistentAudio = audioSyncStatus.downloadedCount > 0;

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

        <Text style={styles.sectionHeaderLabel}>高品質音声</Text>
        <SettingsCard>
          <View style={styles.audioSyncPanel}>
            <View style={styles.audioSyncTitleRow}>
              <View style={styles.audioSyncTitleText}>
                <Text style={styles.serverEditorLabel}>個別音声を同期</Text>
                <Text style={styles.serverEditorSubLabel}>巨大な音声パックを作らず、完成済みファイルだけを背景で保存します</Text>
              </View>
              <Text style={[styles.audioSyncBadge, audioSyncStatus.state === 'failed' && styles.audioSyncBadgeError]}>
                {syncStateLabel(audioSyncStatus.state)}
              </Text>
            </View>

            <View style={styles.audioSyncMetrics}>
              <View style={styles.audioSyncMetricRow}>
                <Text style={styles.audioSyncMetricLabel}>Server</Text>
                <Text style={styles.audioSyncMetricValue}>
                  {serverReadyCount.toLocaleString()} / {serverExpectedCount.toLocaleString()}（{percentage(serverReadyCount, serverExpectedCount)}）
                </Text>
              </View>
              <View style={styles.audioSyncMetricRow}>
                <Text style={styles.audioSyncMetricLabel}>この端末</Text>
                <Text style={styles.audioSyncMetricValue}>
                  {audioSyncStatus.downloadedCount.toLocaleString()} / {audioSyncStatus.readyCount.toLocaleString()}（{percentage(audioSyncStatus.downloadedCount, audioSyncStatus.readyCount)}）
                </Text>
              </View>
              <View style={styles.audioSyncMetricRow}>
                <Text style={styles.audioSyncMetricLabel}>容量</Text>
                <Text style={styles.audioSyncMetricValue}>
                  {formatBytes(audioSyncStatus.downloadedBytes)} / {formatBytes(serverTotalBytes)}
                </Text>
              </View>
              <View style={styles.audioSyncMetricRow}>
                <Text style={styles.audioSyncMetricLabel}>全件見込み</Text>
                <Text style={styles.audioSyncMetricValue}>{formatBytes(estimatedFullBytes)}</Text>
              </View>
              <View style={styles.audioSyncMetricRow}>
                <Text style={styles.audioSyncMetricLabel}>Profile</Text>
                <Text style={styles.audioSyncMetricValue} numberOfLines={2}>{profileId ?? '未確認'}</Text>
              </View>
              <View style={styles.audioSyncMetricRow}>
                <Text style={styles.audioSyncMetricLabel}>形式</Text>
                <Text style={styles.audioSyncMetricValue}>{audioFormat?.toUpperCase() ?? '—'}</Text>
              </View>
            </View>

            {audioSyncStatus.lastError && (
              <Text style={styles.audioSyncError}>{audioSyncStatus.lastError}</Text>
            )}

            <View style={styles.audioSyncActions}>
              {syncIsActive ? (
                <TouchableOpacity style={styles.secondaryButton} onPress={() => void handlePauseAudioSync()} disabled={audioSyncBusy}>
                  <Pause size={15} color={Colors.dark.textSecondary} />
                  <Text style={styles.secondaryButtonText}>一時停止</Text>
                </TouchableOpacity>
              ) : audioSyncStatus.state === 'paused' ? (
                <TouchableOpacity style={styles.saveButton} onPress={() => void handleResumeAudioSync()} disabled={audioSyncBusy}>
                  <Play size={15} color="#FFF" />
                  <Text style={styles.saveButtonText}>続ける</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.saveButton} onPress={() => void confirmInitialAudioSync()} disabled={audioSyncBusy}>
                  {hasPersistentAudio ? <RefreshCw size={15} color="#FFF" /> : <Download size={15} color="#FFF" />}
                  <Text style={styles.saveButtonText}>
                    {hasPersistentAudio ? '更新を確認して同期' : 'ダウンロード'}
                  </Text>
                </TouchableOpacity>
              )}
              {hasPersistentAudio && !syncIsActive && (
                <TouchableOpacity style={styles.destructiveButton} onPress={confirmClearAudioSync} disabled={audioSyncBusy}>
                  <Trash2 size={15} color="#FF6B6B" />
                  <Text style={styles.destructiveButtonText}>音声データを削除</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
  audioSyncPanel: {
    paddingVertical: 14,
    gap: Spacing.three,
  },
  audioSyncTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  audioSyncTitleText: {
    flex: 1,
  },
  audioSyncBadge: {
    color: '#7DCFFF',
    backgroundColor: 'rgba(125, 207, 255, 0.1)',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '600',
  },
  audioSyncBadgeError: {
    color: '#FF6B6B',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
  },
  audioSyncMetrics: {
    borderRadius: 8,
    backgroundColor: '#0F1014',
    borderWidth: 1,
    borderColor: '#1C1D22',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  audioSyncMetricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  audioSyncMetricLabel: {
    width: 76,
    color: Colors.dark.textSecondary,
    fontSize: 12,
  },
  audioSyncMetricValue: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 12,
    fontFamily: Fonts?.mono,
    textAlign: 'right',
  },
  audioSyncError: {
    color: '#FF6B6B',
    fontSize: 12,
    lineHeight: 18,
  },
  audioSyncActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: Spacing.two,
  },
  destructiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  destructiveButtonText: {
    color: '#FF6B6B',
    fontSize: 13,
    fontWeight: '600',
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
