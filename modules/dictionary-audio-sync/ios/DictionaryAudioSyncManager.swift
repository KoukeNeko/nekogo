import CryptoKit
import Foundation

private struct ManifestHeader: Decodable {
  let schemaVersion: Int
  let profileID: String
  let format: String
  let expectedCount: Int64
  let readyCount: Int64
  let totalBytes: Int64

  enum CodingKeys: String, CodingKey {
    case schemaVersion = "schema_version"
    case profileID = "profile_id"
    case format
    case expectedCount = "expected_count"
    case readyCount = "ready_count"
    case totalBytes = "total_bytes"
  }
}

private struct ManifestAsset: Decodable {
  let entryID: String
  let sha256: String
  let sizeBytes: Int64

  enum CodingKeys: String, CodingKey {
    case entryID = "entry_id"
    case sha256
    case sizeBytes = "size_bytes"
  }
}

final class DictionaryAudioSyncManager: NSObject, URLSessionDownloadDelegate, URLSessionTaskDelegate {
  static let shared = DictionaryAudioSyncManager()
  static let sessionIdentifier = "com.koukeneko.nekogo.dictionary-audio-sync"

  var eventSink: ((String, [String: Any?]) -> Void)?
  private let workQueue = DispatchQueue(label: "com.koukeneko.nekogo.dictionary-audio-sync.manager")
  private let fileManager = FileManager.default
  private let rootURL: URL
  private let store: DictionaryAudioSyncStore
  private var pauseRequested = false
  private var cancelRequested = false
  private var manifestTask: URLSessionDataTask?
  private var manifestGeneration = UUID()
  private var finishingTaskIDs = Set<Int>()
  private var completionHandler: (() -> Void)?

  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
    configuration.sessionSendsLaunchEvents = true
    configuration.isDiscretionary = false
    configuration.waitsForConnectivity = true
    configuration.httpMaximumConnectionsPerHost = 6
    return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }()

  private override init() {
    let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
    rootURL = documents.appendingPathComponent("dictionary-audio", isDirectory: true)
    do {
      store = try DictionaryAudioSyncStore(url: rootURL.appendingPathComponent("index.sqlite"))
    } catch {
      fatalError("Unable to initialize dictionary audio storage: \(error.localizedDescription)")
    }
    super.init()
    try? ensureDirectories()
    _ = session
    restoreBackgroundTasks()
    if store.metadata("state") == "preparing",
      let rawBaseURL = store.metadata("base_url"),
      let baseURL = normalizedBaseURL(rawBaseURL) {
      fetchManifest(baseURL: baseURL, allowCellular: store.metadata("allow_cellular") == "1")
    }
  }

  func startSync(baseURL rawBaseURL: String, allowCellular: Bool) throws -> [String: Any?] {
    guard let baseURL = normalizedBaseURL(rawBaseURL) else { throw syncError("音声サーバー URL が正しくありません") }
    pauseRequested = false
    cancelRequested = false
    try store.setMetadata([
      "state": "preparing", "base_url": baseURL.absoluteString,
      "allow_cellular": allowCellular ? "1" : "0", "last_error": "", "resume_manifest": "0",
    ])
    emitState()
    fetchManifest(baseURL: baseURL, allowCellular: allowCellular)
    return status()
  }

  func pauseSync() throws -> [String: Any?] {
    let wasPreparing = store.metadata("state") == "preparing"
    pauseRequested = true
    manifestGeneration = UUID()
    manifestTask?.cancel()
    manifestTask = nil
    try store.pauseUnassigned()
    session.getAllTasks { [weak self] tasks in
      guard let self else { return }
      for task in tasks {
        guard let download = task as? URLSessionDownloadTask else { continue }
        download.cancel { data in
          try? self.store.markPaused(taskID: download.taskIdentifier, resumeData: data)
          self.emitProgress()
        }
      }
    }
    try store.setMetadata(["state": "paused", "resume_manifest": wasPreparing ? "1" : "0"])
    emitState()
    return status()
  }

  func resumeSync(allowCellular: Bool) throws -> [String: Any?] {
    pauseRequested = false
    cancelRequested = false
    let cellularPolicyChanged = (store.metadata("allow_cellular") == "1") != allowCellular
    let needsManifest = store.metadata("resume_manifest") == "1" || store.metadata("manifest_token") == nil
    try store.setMetadata([
      "state": needsManifest ? "preparing" : "downloading",
      "allow_cellular": allowCellular ? "1" : "0", "last_error": "", "resume_manifest": "0",
    ])
    if needsManifest {
      guard let rawBaseURL = store.metadata("base_url"), let baseURL = normalizedBaseURL(rawBaseURL) else {
        throw syncError("音声サーバー URL がありません")
      }
      fetchManifest(baseURL: baseURL, allowCellular: allowCellular)
      emitState()
      return status()
    }
    try store.resumePaused(discardResumeData: cellularPolicyChanged)
    scheduleDownloads()
    emitState()
    return status()
  }

  func cancelSync() throws -> [String: Any?] {
    cancelRequested = true
    pauseRequested = false
    manifestGeneration = UUID()
    manifestTask?.cancel()
    manifestTask = nil
    session.getAllTasks { $0.forEach { $0.cancel() } }
    try store.cancelCurrent()
    emitState()
    return status()
  }

  func clearAll() throws -> [String: Any?] {
    _ = try cancelSync()
    for child in try fileManager.contentsOfDirectory(at: rootURL, includingPropertiesForKeys: nil) where child.lastPathComponent != "index.sqlite" && !child.lastPathComponent.hasPrefix("index.sqlite-") {
      try? fileManager.removeItem(at: child)
    }
    try store.reset()
    try ensureDirectories()
    emitState()
    return status()
  }

  func deleteEntry(_ entryID: String) throws -> [String: Any?] {
    guard Self.validEntryID(entryID) else { throw syncError("音声 ID が正しくありません") }
    session.getAllTasks { [weak self] tasks in
      guard let self else { return }
      for task in tasks where self.store.record(taskID: task.taskIdentifier)?.entryID == entryID { task.cancel() }
    }
    for format in ["opus", "m4a", "aac"] {
      try? fileManager.removeItem(at: destinationURL(entryID: entryID, format: format))
      try? fileManager.removeItem(at: temporaryURL(entryID: entryID, format: format))
    }
    try store.deleteEntry(entryID)
    emitProgress()
    return status()
  }

  func status() -> [String: Any?] { store.status() }

  func localURI(entryID: String) -> String? {
    guard Self.validEntryID(entryID), let record = store.playableRecord(entryID: entryID) else { return nil }
    let url = destinationURL(entryID: entryID, format: record.format)
    guard validLocalFile(url: url, record: record) else { return nil }
    return url.absoluteString
  }

  func setBackgroundCompletionHandler(_ handler: @escaping () -> Void) {
    completionHandler = handler
  }

  private func fetchManifest(baseURL: URL, allowCellular: Bool) {
    let generation = UUID()
    manifestGeneration = generation
    let url = baseURL.appending(path: "api/v1/dictionary-audio/manifest.ndjson")
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 120
    request.allowsCellularAccess = allowCellular
    let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
      guard let self else { return }
      self.workQueue.async {
        guard self.manifestGeneration == generation else { return }
        self.manifestTask = nil
        if self.pauseRequested || self.cancelRequested { return }
        do {
          if let error { throw error }
          guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode), let data else {
            throw self.syncError("音声 manifest を取得できませんでした")
          }
          try self.prepareManifest(data: data, baseURL: baseURL, allowCellular: allowCellular)
        } catch {
          self.fail(error.localizedDescription)
        }
      }
    }
    manifestTask = task
    task.resume()
  }

  private func prepareManifest(data: Data, baseURL: URL, allowCellular: Bool) throws {
    let lines = data.split(separator: 0x0A, omittingEmptySubsequences: true)
    guard let first = lines.first else { throw syncError("音声 manifest が空です") }
    let decoder = JSONDecoder()
    let header = try decoder.decode(ManifestHeader.self, from: first)
    guard header.schemaVersion == 1, ["opus", "m4a", "aac"].contains(header.format), header.readyCount >= 0 else {
      throw syncError("対応していない音声 manifest です")
    }
    let token = UUID().uuidString
    try store.beginManifest(
      profileID: header.profileID, format: header.format, expected: header.expectedCount,
      ready: header.readyCount, totalBytes: header.totalBytes,
      baseURL: baseURL.absoluteString, allowCellular: allowCellular, token: token
    )
    var parsed: Int64 = 0
    var batch: [DictionaryAudioManifestRecord] = []
    batch.reserveCapacity(512)
    for line in lines.dropFirst() {
      let asset = try decoder.decode(ManifestAsset.self, from: line)
      guard Self.validEntryID(asset.entryID), asset.sha256.count == 64, asset.sizeBytes > 0 else {
        throw syncError("音声 manifest に不正な項目があります")
      }
      batch.append(DictionaryAudioManifestRecord(
        entryID: asset.entryID, profileID: header.profileID, format: header.format,
        sha256: asset.sha256, sizeBytes: asset.sizeBytes,
        localIsValid: validLocalFile(
          url: destinationURL(entryID: asset.entryID, format: header.format),
          sha256: asset.sha256, sizeBytes: asset.sizeBytes
        )
      ))
      if batch.count == 512 {
        try store.upsertManifestAssets(batch, token: token)
        batch.removeAll(keepingCapacity: true)
      }
      parsed += 1
    }
    try store.upsertManifestAssets(batch, token: token)
    guard parsed == header.readyCount else { throw syncError("音声 manifest の件数が一致しません") }

    let pending = store.pendingBytes()
    if pending > 0 {
      let required = pending * 3 / 2 + 256 * 1024 * 1024
      let available = try rootURL.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage ?? 0
      guard available >= required else {
        throw syncError("空き容量が不足しています。少なくとも \(Self.byteString(required)) 必要です")
      }
    }
    try store.setMetadata(["state": pending == 0 ? "completed" : "downloading"])
    emitState()
    if pending > 0 { scheduleDownloads() }
  }

  private func restoreBackgroundTasks() {
    session.getAllTasks { [weak self] tasks in
      guard let self else { return }
      self.workQueue.async {
        for task in tasks {
          guard let record = self.store.record(taskID: task.taskIdentifier) else { task.cancel(); continue }
          try? self.store.setTask(entryID: record.entryID, profileID: record.profileID, taskID: task.taskIdentifier)
        }
        if tasks.isEmpty, self.store.metadata("state") == "downloading" { self.scheduleDownloads() }
      }
    }
  }

  private func scheduleDownloads() {
    workQueue.async { [weak self] in
      guard let self, !self.pauseRequested, !self.cancelRequested else { return }
      self.session.getAllTasks { tasks in
        self.workQueue.async {
          let availableSlots = max(0, 6 - tasks.filter { $0.state == .running || $0.state == .suspended }.count)
          guard availableSlots > 0 else { return }
          let records = self.store.pendingRecords(limit: availableSlots)
          if records.isEmpty {
            self.finishIfNeeded(activeTasks: tasks.count)
            return
          }
          guard let rawBase = self.store.metadata("base_url"), let baseURL = URL(string: rawBase) else {
            self.fail("音声サーバー URL がありません")
            return
          }
          let allowCellular = self.store.metadata("allow_cellular") == "1"
          for record in records {
            let task: URLSessionDownloadTask
            if let resumeData = record.resumeData {
              task = self.session.downloadTask(withResumeData: resumeData)
            } else {
              var request = URLRequest(url: self.downloadURL(baseURL: baseURL, entryID: record.entryID))
              request.timeoutInterval = 300
              request.allowsCellularAccess = allowCellular
              request.cachePolicy = .reloadIgnoringLocalCacheData
              task = self.session.downloadTask(with: request)
            }
            do {
              try self.store.setTask(entryID: record.entryID, profileID: record.profileID, taskID: task.taskIdentifier)
              task.resume()
            } catch {
              task.cancel()
              self.fail(error.localizedDescription)
              return
            }
          }
          self.emitProgress()
        }
      }
    }
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    workQueue.sync {
      guard let record = store.record(taskID: downloadTask.taskIdentifier) else { return }
      finishingTaskIDs.insert(downloadTask.taskIdentifier)
      do {
        guard let response = downloadTask.response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
          throw syncError("HTTP \((downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0): \(record.entryID)")
        }
        guard validLocalFile(url: location, sha256: record.sha256, sizeBytes: record.sizeBytes) else {
          throw syncError("音声ファイルの検証に失敗しました: \(record.entryID)")
        }
        let destination = destinationURL(entryID: record.entryID, format: record.format)
        let temporary = temporaryURL(entryID: record.entryID, format: record.format)
        try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? fileManager.removeItem(at: temporary)
        try fileManager.moveItem(at: location, to: temporary)
        if fileManager.fileExists(atPath: destination.path) {
          _ = try fileManager.replaceItemAt(destination, withItemAt: temporary)
        } else {
          try fileManager.moveItem(at: temporary, to: destination)
        }
        try store.markComplete(record)
      } catch {
        try? store.markRetryOrFailure(taskID: downloadTask.taskIdentifier, error: error.localizedDescription)
      }
      emitProgress()
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    workQueue.async { [weak self] in
      guard let self else { return }
      let finishedFile = self.finishingTaskIDs.remove(task.taskIdentifier) != nil
      if !finishedFile, let record = self.store.record(taskID: task.taskIdentifier) {
        if self.pauseRequested {
          try? self.store.markPaused(taskID: task.taskIdentifier, resumeData: nil)
        } else if self.cancelRequested {
          try? self.store.markRetryOrFailure(taskID: task.taskIdentifier, error: "同期をキャンセルしました")
        } else {
          try? self.store.markRetryOrFailure(taskID: task.taskIdentifier, error: error?.localizedDescription ?? "ダウンロードに失敗しました: \(record.entryID)")
        }
      }
      self.scheduleDownloads()
    }
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    emitProgress()
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    DispatchQueue.main.async { [weak self] in
      self?.completionHandler?()
      self?.completionHandler = nil
    }
  }

  private func finishIfNeeded(activeTasks: Int) {
    guard activeTasks == 0 else { return }
    let current = status()
    let failed = current["failedCount"] as? Int64 ?? 0
    let downloaded = current["downloadedCount"] as? Int64 ?? 0
    let ready = current["readyCount"] as? Int64 ?? 0
    let state = downloaded >= ready ? "completed" : (failed > 0 ? "completed_with_errors" : "downloading")
    try? store.setMetadata(["state": state])
    emitState()
  }

  private func fail(_ message: String) {
    try? store.setMetadata(["state": "failed", "last_error": message])
    emitState()
  }

  private func emitState() { eventSink?("onStateChanged", status()) }
  private func emitProgress() { eventSink?("onProgress", status()) }

  private func ensureDirectories() throws {
    try fileManager.createDirectory(at: rootURL.appendingPathComponent("vocab", isDirectory: true), withIntermediateDirectories: true)
    try fileManager.createDirectory(at: rootURL.appendingPathComponent("example", isDirectory: true), withIntermediateDirectories: true)
  }

  private func destinationURL(entryID: String, format: String) -> URL {
    let parts = entryID.split(separator: ":", maxSplits: 1).map(String.init)
    return rootURL.appendingPathComponent(parts[0], isDirectory: true).appendingPathComponent(parts[1] + "." + format)
  }

  private func temporaryURL(entryID: String, format: String) -> URL {
    destinationURL(entryID: entryID, format: format).appendingPathExtension("part")
  }

  private func downloadURL(baseURL: URL, entryID: String) -> URL {
    let parts = entryID.split(separator: ":", maxSplits: 1).map(String.init)
    return baseURL.appending(path: "api/v1/dictionary-audio").appending(path: parts[0]).appending(path: parts[1])
  }

  private func validLocalFile(url: URL, record: DictionaryAudioRecord) -> Bool {
    validLocalFile(url: url, sha256: record.sha256, sizeBytes: record.sizeBytes)
  }

  private func validLocalFile(url: URL, sha256: String, sizeBytes: Int64) -> Bool {
    guard let attributes = try? fileManager.attributesOfItem(atPath: url.path),
      (attributes[.size] as? NSNumber)?.int64Value == sizeBytes,
      let digest = try? Self.sha256(url: url) else { return false }
    return digest == sha256.lowercased()
  }

  private func normalizedBaseURL(_ raw: String) -> URL? {
    guard var components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
      ["http", "https"].contains(components.scheme?.lowercased() ?? ""), components.host != nil,
      components.user == nil, components.password == nil else { return nil }
    components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    components.query = nil; components.fragment = nil
    return components.url
  }

  private static func validEntryID(_ entryID: String) -> Bool {
    let parts = entryID.split(separator: ":", maxSplits: 1)
    guard parts.count == 2, ["vocab", "example"].contains(String(parts[0])), !parts[1].isEmpty else { return false }
    return !parts[1].contains(where: { $0 == "/" || $0 == "\\" || $0.isNewline })
  }

  private static func sha256(url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    while autoreleasepool(invoking: {
      let data = try? handle.read(upToCount: 1024 * 1024)
      guard let data, !data.isEmpty else { return false }
      hasher.update(data: data)
      return true
    }) {}
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private static func byteString(_ bytes: Int64) -> String {
    ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
  }

  private func syncError(_ message: String) -> NSError {
    NSError(domain: "DictionaryAudioSync", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
