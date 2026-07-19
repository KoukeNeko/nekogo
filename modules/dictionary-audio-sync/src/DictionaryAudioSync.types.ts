export type DictionaryAudioSyncState =
  | 'idle'
  | 'preparing'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export type DictionaryAudioSyncStatus = {
  state: DictionaryAudioSyncState;
  profileId: string | null;
  format: string | null;
  readyCount: number;
  expectedCount: number;
  downloadedCount: number;
  failedCount: number;
  totalBytes: number;
  downloadedBytes: number;
  lastError: string | null;
  allowCellular: boolean;
};

export type DictionaryAudioSyncModuleEvents = {
  onStateChanged: (status: DictionaryAudioSyncStatus) => void;
  onProgress: (status: DictionaryAudioSyncStatus) => void;
};
