Pod::Spec.new do |s|
  s.name           = 'DictionaryAudioSync'
  s.version        = '1.0.0'
  s.summary        = 'Persistent dictionary audio background synchronization'
  s.description    = 'Downloads and verifies individual dictionary audio assets in the background.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.libraries = 'sqlite3'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
