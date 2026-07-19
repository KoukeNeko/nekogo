import { Platform } from 'react-native';
import {
    AudioPlayer,
    createAudioPlayer,
    setAudioModeAsync,
    setIsAudioActiveAsync,
} from 'expo-audio';
import * as Speech from 'expo-speech';
import {
    getDictionaryAudioUri,
    invalidateDictionaryAudioCacheEntry,
    prefetchDictionaryAudio,
} from '../services/dictionaryAudio';

let latestRequest = 0;
let audioModeReady: Promise<void> | undefined;
let audioPlayer: AudioPlayer | undefined;
const PLAYER_LOAD_TIMEOUT_MS = 5_000;

async function prepareAudioSession(): Promise<void> {
    if (Platform.OS !== 'ios') return;

    audioModeReady ??= setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
    }).catch((error) => {
        audioModeReady = undefined;
        throw error;
    });

    await audioModeReady;
    await setIsAudioActiveAsync(true);
}

function player(): AudioPlayer {
    audioPlayer ??= createAudioPlayer(null, { keepAudioSessionActive: false });
    return audioPlayer;
}

function waitForPlayerStatus(
    currentPlayer: AudioPlayer,
    predicate: (status: AudioPlayer['currentStatus']) => boolean,
    timeoutMs: number,
    timeoutMessage: string,
): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let subscription: { remove(): void } | undefined;
        const timeout = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);

        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            subscription?.remove();
            if (error) reject(error);
            else resolve();
        };

        subscription = currentPlayer.addListener('playbackStatusUpdate', (status) => {
            if (status.error) {
                finish(new Error(status.error));
            } else if (predicate(status)) {
                finish();
            }
        });

        const status = currentPlayer.currentStatus;
        if (status.error) finish(new Error(status.error));
        else if (predicate(status)) finish();
    });
}

async function playRemoteAudio(currentPlayer: AudioPlayer, uri: string): Promise<void> {
    currentPlayer.replace(uri);
    await waitForPlayerStatus(
        currentPlayer,
        (status) => status.isLoaded,
        PLAYER_LOAD_TIMEOUT_MS,
        'Audio source did not finish loading',
    );

    currentPlayer.volume = 1;
    currentPlayer.muted = false;
    currentPlayer.play();
}

function pauseRemoteAudio(): void {
    try {
        audioPlayer?.pause();
    } catch {
        // Player may already have been released during a root-layout teardown.
    }
}

async function speakWithDeviceTts(content: string, request: number): Promise<void> {
    if (request !== latestRequest) return;

    if (Platform.OS === 'ios') {
        try {
            await setIsAudioActiveAsync(false);
        } catch (error) {
            console.warn('無法停用 App 音訊 session，繼續使用系統 TTS', error);
        }
    }
    if (request !== latestRequest) return;

    Speech.speak(content, {
        language: 'ja-JP',
        rate: 0.9,
        volume: 1,
        ...(Platform.OS === 'ios' ? { useApplicationAudioSession: false } : {}),
        onError: (error) => {
            console.error('日文語音播放失敗', error);
        },
    });
}

/** 畫面顯示時先抓預產音檔；失敗不拋到 UI，實際按下時仍會重試並 fallback。 */
export async function prefetchJapaneseAudio(entryId: string): Promise<void> {
    try {
        await prefetchDictionaryAudio(entryId);
    } catch (error) {
        console.warn('預取日文語音失敗', { entryId, error });
    }
}

/**
 * 播放日文。提供 vocab:/example: entryId 時優先播放 Go server 的預產音檔；
 * 未設定 server、缺檔、逾時或播放失敗時自動退回裝置 TTS。
 */
export async function speakJapanese(text: string, entryId?: string): Promise<void> {
    const content = text.trim();
    if (!content) return;

    const request = ++latestRequest;
    try {
        await Speech.stop();
        pauseRemoteAudio();
        if (request !== latestRequest) return;

        if (entryId) {
            const uri = await getDictionaryAudioUri(entryId);
            if (request !== latestRequest) return;
            if (uri) {
                try {
                    await prepareAudioSession();
                    if (request !== latestRequest) return;
                    const currentPlayer = player();
                    await playRemoteAudio(currentPlayer, uri);
                    return;
                } catch (error) {
                    invalidateDictionaryAudioCacheEntry(entryId);
                    console.warn('預產日文語音播放失敗，改用裝置 TTS', { entryId, error });
                }
            }
        }

        await speakWithDeviceTts(content, request);
    } catch (error) {
        console.error('日文語音播放失敗', error);
    }
}

/** Root layout 卸載／Fast Refresh 時釋放手動建立的 AudioPlayer。 */
export function releaseSpeechResources(): void {
    latestRequest += 1;
    void Speech.stop();
    pauseRemoteAudio();
    try {
        audioPlayer?.release();
    } finally {
        audioPlayer = undefined;
        audioModeReady = undefined;
    }
}
