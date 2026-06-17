// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 讓 Metro 把預載的 SQLite 內容庫 (.db) 當成資產打包，供 expo-asset 解析。
config.resolver.assetExts.push('db');

module.exports = config;
