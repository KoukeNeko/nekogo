import DictionaryAudioSync, {
  type DictionaryAudioSyncStatus,
} from '../../modules/dictionary-audio-sync';

export type { DictionaryAudioSyncStatus };

export const getDictionaryAudioSyncStatus = (): Promise<DictionaryAudioSyncStatus> =>
  DictionaryAudioSync.getStatus();

export const startDictionaryAudioSync = (baseUrl: string, allowCellular: boolean): Promise<DictionaryAudioSyncStatus> =>
  DictionaryAudioSync.startSync(baseUrl, allowCellular);

export const pauseDictionaryAudioSync = (): Promise<DictionaryAudioSyncStatus> =>
  DictionaryAudioSync.pauseSync();

export const resumeDictionaryAudioSync = (allowCellular: boolean): Promise<DictionaryAudioSyncStatus> =>
  DictionaryAudioSync.resumeSync(allowCellular);

export const cancelDictionaryAudioSync = (): Promise<DictionaryAudioSyncStatus> =>
  DictionaryAudioSync.cancelSync();

export const clearDictionaryAudioSync = (): Promise<DictionaryAudioSyncStatus> =>
  DictionaryAudioSync.clearAll();

export const deleteDictionaryAudioSyncEntry = (entryId: string): Promise<DictionaryAudioSyncStatus> =>
  DictionaryAudioSync.deleteEntry(entryId);

export const getSyncedDictionaryAudioUri = (entryId: string): Promise<string | null> =>
  DictionaryAudioSync.getLocalUri(entryId);

export const subscribeToDictionaryAudioSync = (
  listener: (status: DictionaryAudioSyncStatus) => void,
): { remove(): void } => {
  const stateSubscription = DictionaryAudioSync.addListener('onStateChanged', listener);
  const progressSubscription = DictionaryAudioSync.addListener('onProgress', listener);
  return {
    remove() {
      stateSubscription.remove();
      progressSubscription.remove();
    },
  };
};
