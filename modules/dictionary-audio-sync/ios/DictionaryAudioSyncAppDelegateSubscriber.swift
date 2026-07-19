import ExpoModulesCore

public final class DictionaryAudioSyncAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    guard identifier == DictionaryAudioSyncManager.sessionIdentifier else {
      completionHandler()
      return
    }
    DictionaryAudioSyncManager.shared.setBackgroundCompletionHandler(completionHandler)
  }
}
