const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// 為 iOS Podfile 注入 use_modular_headers!，解決 google-signin 依賴鏈中的 Swift pod
// （AppCheckCore → GoogleUtilities / RecaptchaInterop，皆未定義模組）在「靜態 library」下
// 無法被 Swift import、導致 pod install 失敗的問題。
//
// CNG 友善：放在 config plugin，每次 prebuild 自動套用，不必手改被重生的 Podfile。
const withModularHeaders = (config) =>
  withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfilePath, 'utf8');
      if (!contents.includes('use_modular_headers!')) {
        // 置於 prepare_react_native_project! 之後（target 之外的全域層級）。
        const patched = contents.replace(
          /prepare_react_native_project!\n/,
          'prepare_react_native_project!\n\nuse_modular_headers!\n',
        );
        fs.writeFileSync(podfilePath, patched);
      }
      return modConfig;
    },
  ]);

module.exports = withModularHeaders;
