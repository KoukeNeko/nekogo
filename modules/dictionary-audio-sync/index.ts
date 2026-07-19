// Re-export the native module. On web, it will be resolved to DictionaryAudioSyncModule.web.ts
// and on native platforms to DictionaryAudioSyncModule.ts
export { default } from './src/DictionaryAudioSyncModule';
export * from './src/DictionaryAudioSync.types';
