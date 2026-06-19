Pod::Spec.new do |s|
  s.name           = 'FsrsNative'
  s.version        = '1.0.0'
  s.summary        = 'FSRS Rust core bridge (fsrs-rs via C ABI)'
  s.description    = 'Local Expo module exposing the fsrs-rs optimizer to JS.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '6.0'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # 只編 Swift 來源；不要 glob 到 xcframework 內容。
  s.source_files = '*.swift'

  # Rust 靜態庫（device + simulator 兩個 slice）+ 內含的 C header/modulemap，
  # 讓 Swift 可 `import FsrsMobile` 並在連結期解析 fsrs_native_ping。
  s.vendored_frameworks = 'Frameworks/FsrsMobile.xcframework'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE'         => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
