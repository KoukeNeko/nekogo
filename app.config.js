// 動態 Expo 設定：靜態設定仍在 app.json，本檔只把需要環境變數（.env / .env.local）的值注入，
// 避免把 Google 的 iOS URL scheme 死字串放進版控。Expo 偵測到 app.config.js 時，會把 app.json
// 的內容當作 `config` 傳入，本函式回傳合併後的最終設定。
//
// Google iOS URL scheme 由 EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID 自動推導（見 deriveIosUrlScheme），
// 使用者只需在 .env.local 填 web / ios 兩個 client id 即可。

const withModularHeaders = require('./plugins/withModularHeaders');

const GOOGLE_SIGNIN_PLUGIN = '@react-native-google-signin/google-signin';
const FALLBACK_IOS_URL_SCHEME = 'com.googleusercontent.apps.YOUR_IOS_CLIENT_ID';

// iOS client id 形如 "<id>.apps.googleusercontent.com" → URL scheme "com.googleusercontent.apps.<id>"。
const deriveIosUrlScheme = (iosClientId) => {
  const match = /^(.+)\.apps\.googleusercontent\.com$/.exec(iosClientId);
  return match ? `com.googleusercontent.apps.${match[1]}` : FALLBACK_IOS_URL_SCHEME;
};

module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
  const iosUrlScheme = iosClientId ? deriveIosUrlScheme(iosClientId) : FALLBACK_IOS_URL_SCHEME;

  const plugins = (config.plugins ?? []).map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name === GOOGLE_SIGNIN_PLUGIN ? [GOOGLE_SIGNIN_PLUGIN, { iosUrlScheme }] : plugin;
  });

  // use_modular_headers! 由 dangerous mod 注入（google-signin 的 Swift pod 靜態連結需要）。
  return withModularHeaders({ ...config, plugins });
};
