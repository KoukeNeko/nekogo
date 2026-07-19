import { NativeModule, requireNativeModule } from 'expo';

import type {
  DictionaryAudioSyncModuleEvents,
  DictionaryAudioSyncStatus,
} from './DictionaryAudioSync.types';

declare class DictionaryAudioSyncModule extends NativeModule<DictionaryAudioSyncModuleEvents> {
  startSync(baseUrl: string, allowCellular: boolean): Promise<DictionaryAudioSyncStatus>;
  pauseSync(): Promise<DictionaryAudioSyncStatus>;
  resumeSync(allowCellular: boolean): Promise<DictionaryAudioSyncStatus>;
  cancelSync(): Promise<DictionaryAudioSyncStatus>;
  clearAll(): Promise<DictionaryAudioSyncStatus>;
  deleteEntry(entryId: string): Promise<DictionaryAudioSyncStatus>;
  getStatus(): Promise<DictionaryAudioSyncStatus>;
  getLocalUri(entryId: string): Promise<string | null>;
}

export default requireNativeModule<DictionaryAudioSyncModule>('DictionaryAudioSync');
