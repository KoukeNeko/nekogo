import ExpoModulesCore

public final class DictionaryAudioSyncModule: Module {
  private let manager = DictionaryAudioSyncManager.shared

  public func definition() -> ModuleDefinition {
    Name("DictionaryAudioSync")
    Events("onStateChanged", "onProgress")

    OnCreate {
      manager.eventSink = { [weak self] name, body in self?.sendEvent(name, body) }
    }
    OnDestroy { manager.eventSink = nil }

    AsyncFunction("startSync") { (baseURL: String, allowCellular: Bool) in
      try manager.startSync(baseURL: baseURL, allowCellular: allowCellular)
    }
    AsyncFunction("pauseSync") { try manager.pauseSync() }
    AsyncFunction("resumeSync") { (allowCellular: Bool) in try manager.resumeSync(allowCellular: allowCellular) }
    AsyncFunction("cancelSync") { try manager.cancelSync() }
    AsyncFunction("clearAll") { try manager.clearAll() }
    AsyncFunction("deleteEntry") { (entryID: String) in try manager.deleteEntry(entryID) }
    AsyncFunction("getStatus") { manager.status() }
    AsyncFunction("getLocalUri") { (entryID: String) in manager.localURI(entryID: entryID) }
  }
}
