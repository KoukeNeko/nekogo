import { NativeModule, registerWebModule } from 'expo';

import type {
  DictionaryAudioSyncModuleEvents,
  DictionaryAudioSyncStatus,
} from './DictionaryAudioSync.types';

const unsupportedStatus: DictionaryAudioSyncStatus = {
  state: 'failed',
  profileId: null,
  format: null,
  readyCount: 0,
  expectedCount: 0,
  downloadedCount: 0,
  failedCount: 0,
  totalBytes: 0,
  downloadedBytes: 0,
  lastError: 'Dictionary audio background sync is only available on iOS and Android.',
  allowCellular: false,
};

class DictionaryAudioSyncWebModule extends NativeModule<DictionaryAudioSyncModuleEvents> {
  async startSync(): Promise<DictionaryAudioSyncStatus> { return unsupportedStatus; }
  async pauseSync(): Promise<DictionaryAudioSyncStatus> { return unsupportedStatus; }
  async resumeSync(): Promise<DictionaryAudioSyncStatus> { return unsupportedStatus; }
  async cancelSync(): Promise<DictionaryAudioSyncStatus> { return unsupportedStatus; }
  async clearAll(): Promise<DictionaryAudioSyncStatus> { return unsupportedStatus; }
  async deleteEntry(): Promise<DictionaryAudioSyncStatus> { return unsupportedStatus; }
  async getStatus(): Promise<DictionaryAudioSyncStatus> { return unsupportedStatus; }
  async getLocalUri(): Promise<null> { return null; }
}

export default registerWebModule(DictionaryAudioSyncWebModule, 'DictionaryAudioSync');
