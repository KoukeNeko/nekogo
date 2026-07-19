import Foundation
import SQLite3

struct DictionaryAudioRecord {
  let entryID: String
  let profileID: String
  let format: String
  let sha256: String
  let sizeBytes: Int64
  let state: String
  let attempts: Int
  let taskID: Int?
  let resumeData: Data?
}

struct DictionaryAudioManifestRecord {
  let entryID: String
  let profileID: String
  let format: String
  let sha256: String
  let sizeBytes: Int64
  let localIsValid: Bool
}

final class DictionaryAudioSyncStore {
  private let queue = DispatchQueue(label: "com.koukeneko.nekogo.dictionary-audio-sync.sqlite")
  private var database: OpaquePointer?

  init(url: URL) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
      throw storeError("Unable to open the dictionary audio index")
    }
    try execute("PRAGMA journal_mode=WAL;")
    try execute("PRAGMA synchronous=NORMAL;")
    try execute("""
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        entry_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        format TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        task_id INTEGER,
        resume_data BLOB,
        manifest_token TEXT NOT NULL,
        updated_at REAL NOT NULL,
        PRIMARY KEY (entry_id, profile_id)
      );
      CREATE INDEX IF NOT EXISTS idx_assets_queue
        ON assets(profile_id, manifest_token, state, entry_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_task
        ON assets(task_id) WHERE task_id IS NOT NULL;
      """)
  }

  deinit {
    sqlite3_close(database)
  }

  func metadata(_ key: String) -> String? {
    queue.sync {
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      guard sqlite3_prepare_v2(database, "SELECT value FROM metadata WHERE key = ?", -1, &statement, nil) == SQLITE_OK else { return nil }
      bind(key, to: 1, in: statement)
      guard sqlite3_step(statement) == SQLITE_ROW, let text = sqlite3_column_text(statement, 0) else { return nil }
      return String(cString: text)
    }
  }

  func setMetadata(_ values: [String: String]) throws {
    try queue.sync {
      try transaction {
        for (key, value) in values {
          var statement: OpaquePointer?
          defer { sqlite3_finalize(statement) }
          try prepare("INSERT INTO metadata(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", &statement)
          bind(key, to: 1, in: statement)
          bind(value, to: 2, in: statement)
          try stepDone(statement)
        }
      }
    }
  }

  func beginManifest(profileID: String, format: String, expected: Int64, ready: Int64, totalBytes: Int64, baseURL: String, allowCellular: Bool, token: String) throws {
    try setMetadata([
      "state": "preparing",
      "profile_id": profileID,
      "format": format,
      "expected_count": String(expected),
      "ready_count": String(ready),
      "total_bytes": String(totalBytes),
      "base_url": baseURL,
      "allow_cellular": allowCellular ? "1" : "0",
      "manifest_token": token,
      "last_error": "",
    ])
  }

  func upsertManifestAssets(_ records: [DictionaryAudioManifestRecord], token: String) throws {
    guard !records.isEmpty else { return }
    try queue.sync {
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      try prepare("""
        INSERT INTO assets(entry_id, profile_id, format, sha256, size_bytes, state, attempts, task_id, resume_data, manifest_token, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
        ON CONFLICT(entry_id, profile_id) DO UPDATE SET
          format = excluded.format,
          sha256 = excluded.sha256,
          size_bytes = excluded.size_bytes,
          state = CASE
            WHEN assets.sha256 = excluded.sha256 AND ? = 1 THEN 'complete'
            ELSE 'queued'
          END,
          attempts = 0,
          task_id = NULL,
          resume_data = CASE WHEN assets.sha256 = excluded.sha256 THEN assets.resume_data ELSE NULL END,
          manifest_token = excluded.manifest_token,
          updated_at = excluded.updated_at
        """, &statement)
      try transaction {
        for record in records {
          sqlite3_reset(statement); sqlite3_clear_bindings(statement)
          bind(record.entryID, to: 1, in: statement)
          bind(record.profileID, to: 2, in: statement)
          bind(record.format, to: 3, in: statement)
          bind(record.sha256, to: 4, in: statement)
          sqlite3_bind_int64(statement, 5, record.sizeBytes)
          bind(record.localIsValid ? "complete" : "queued", to: 6, in: statement)
          bind(token, to: 7, in: statement)
          sqlite3_bind_double(statement, 8, Date().timeIntervalSince1970)
          sqlite3_bind_int(statement, 9, record.localIsValid ? 1 : 0)
          try stepDone(statement)
        }
      }
    }
  }

  func record(entryID: String, profileID: String) -> DictionaryAudioRecord? {
    queryOne("SELECT entry_id, profile_id, format, sha256, size_bytes, state, attempts, task_id, resume_data FROM assets WHERE entry_id = ? AND profile_id = ?", bindings: [entryID, profileID])
  }

  func record(taskID: Int) -> DictionaryAudioRecord? {
    queryOne("SELECT entry_id, profile_id, format, sha256, size_bytes, state, attempts, task_id, resume_data FROM assets WHERE task_id = ?", integer: taskID)
  }

  func playableRecord(entryID: String) -> DictionaryAudioRecord? {
    queue.sync {
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      let current = metadataUnlocked("profile_id") ?? ""
      guard sqlite3_prepare_v2(database, """
        SELECT entry_id, profile_id, format, sha256, size_bytes, state, attempts, task_id, resume_data
        FROM assets WHERE entry_id = ? AND state = 'complete'
        ORDER BY CASE WHEN profile_id = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
        """, -1, &statement, nil) == SQLITE_OK else { return nil }
      bind(entryID, to: 1, in: statement)
      bind(current, to: 2, in: statement)
      return sqlite3_step(statement) == SQLITE_ROW ? decodeRecord(statement) : nil
    }
  }

  func pendingRecords(limit: Int) -> [DictionaryAudioRecord] {
    queue.sync {
      let profile = metadataUnlocked("profile_id") ?? ""
      let token = metadataUnlocked("manifest_token") ?? ""
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      guard sqlite3_prepare_v2(database, """
        SELECT entry_id, profile_id, format, sha256, size_bytes, state, attempts, task_id, resume_data
        FROM assets
        WHERE profile_id = ? AND manifest_token = ? AND state IN ('queued', 'paused') AND task_id IS NULL
        ORDER BY entry_id LIMIT ?
        """, -1, &statement, nil) == SQLITE_OK else { return [] }
      bind(profile, to: 1, in: statement)
      bind(token, to: 2, in: statement)
      sqlite3_bind_int(statement, 3, Int32(limit))
      var records: [DictionaryAudioRecord] = []
      while sqlite3_step(statement) == SQLITE_ROW { records.append(decodeRecord(statement)) }
      return records
    }
  }

  func pendingBytes() -> Int64 {
    scalarForCurrent("SELECT COALESCE(SUM(size_bytes), 0) FROM assets WHERE profile_id = ? AND manifest_token = ? AND state != 'complete'")
  }

  func setTask(entryID: String, profileID: String, taskID: Int, state: String = "downloading") throws {
    try updateAsset("UPDATE assets SET task_id = ?, state = ?, resume_data = NULL, updated_at = ? WHERE entry_id = ? AND profile_id = ?") { statement in
      sqlite3_bind_int(statement, 1, Int32(taskID)); bind(state, to: 2, in: statement)
      sqlite3_bind_double(statement, 3, Date().timeIntervalSince1970); bind(entryID, to: 4, in: statement); bind(profileID, to: 5, in: statement)
    }
  }

  func markComplete(_ record: DictionaryAudioRecord) throws {
    try updateAsset("UPDATE assets SET state = 'complete', task_id = NULL, resume_data = NULL, attempts = 0, updated_at = ? WHERE entry_id = ? AND profile_id = ?") { statement in
      sqlite3_bind_double(statement, 1, Date().timeIntervalSince1970); bind(record.entryID, to: 2, in: statement); bind(record.profileID, to: 3, in: statement)
    }
  }

  func markPaused(taskID: Int, resumeData: Data?) throws {
    try updateAsset("UPDATE assets SET state = 'paused', task_id = NULL, resume_data = ?, updated_at = ? WHERE task_id = ?") { statement in
      if let resumeData { _ = resumeData.withUnsafeBytes { sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32(resumeData.count), SQLITE_TRANSIENT) } }
      else { sqlite3_bind_null(statement, 1) }
      sqlite3_bind_double(statement, 2, Date().timeIntervalSince1970); sqlite3_bind_int(statement, 3, Int32(taskID))
    }
  }

  func markRetryOrFailure(taskID: Int, error: String) throws {
    try updateAsset("""
      UPDATE assets SET
        attempts = attempts + 1,
        state = CASE WHEN attempts + 1 <= 3 THEN 'queued' ELSE 'failed' END,
        task_id = NULL,
        resume_data = NULL,
        updated_at = ?
      WHERE task_id = ?
      """) { statement in
      sqlite3_bind_double(statement, 1, Date().timeIntervalSince1970); sqlite3_bind_int(statement, 2, Int32(taskID))
    }
    try setMetadata(["last_error": error])
  }

  func resumePaused() throws {
    try updateCurrent("UPDATE assets SET state = 'queued', task_id = NULL WHERE profile_id = ? AND manifest_token = ? AND state = 'paused'")
  }

  func pauseUnassigned() throws {
    try updateCurrent("UPDATE assets SET state = 'paused' WHERE profile_id = ? AND manifest_token = ? AND state = 'queued'")
  }

  func cancelCurrent() throws {
    try updateCurrent("UPDATE assets SET state = 'queued', task_id = NULL, resume_data = NULL WHERE profile_id = ? AND manifest_token = ? AND state != 'complete'")
    try setMetadata(["state": "idle", "last_error": ""])
  }

  func deleteEntry(_ entryID: String) throws {
    try queue.sync {
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      try prepare("DELETE FROM assets WHERE entry_id = ?", &statement)
      bind(entryID, to: 1, in: statement)
      try stepDone(statement)
    }
  }

  func reset() throws {
    try queue.sync {
      try executeUnlocked("DELETE FROM assets; DELETE FROM metadata;")
    }
  }

  func status() -> [String: Any?] {
    queue.sync {
      let profile = metadataUnlocked("profile_id") ?? ""
      let token = metadataUnlocked("manifest_token") ?? ""
      let counts = aggregate(profile: profile, token: token)
      return [
        "state": metadataUnlocked("state") ?? "idle",
        "profileId": profile.isEmpty ? nil : profile,
        "format": metadataUnlocked("format"),
        "readyCount": Int64(metadataUnlocked("ready_count") ?? "0") ?? 0,
        "expectedCount": Int64(metadataUnlocked("expected_count") ?? "0") ?? 0,
        "downloadedCount": counts.completed,
        "failedCount": counts.failed,
        "totalBytes": Int64(metadataUnlocked("total_bytes") ?? "0") ?? 0,
        "downloadedBytes": counts.bytes,
        "lastError": (metadataUnlocked("last_error") ?? "").nilIfEmpty,
        "allowCellular": metadataUnlocked("allow_cellular") == "1",
      ]
    }
  }

  private func aggregate(profile: String, token: String) -> (completed: Int64, failed: Int64, bytes: Int64) {
    var statement: OpaquePointer?
    defer { sqlite3_finalize(statement) }
    guard sqlite3_prepare_v2(database, """
      SELECT
        COALESCE(SUM(CASE WHEN state = 'complete' THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN state = 'complete' THEN size_bytes ELSE 0 END), 0)
      FROM assets WHERE profile_id = ? AND manifest_token = ?
      """, -1, &statement, nil) == SQLITE_OK else { return (0, 0, 0) }
    bind(profile, to: 1, in: statement); bind(token, to: 2, in: statement)
    guard sqlite3_step(statement) == SQLITE_ROW else { return (0, 0, 0) }
    return (sqlite3_column_int64(statement, 0), sqlite3_column_int64(statement, 1), sqlite3_column_int64(statement, 2))
  }

  private func scalarForCurrent(_ sql: String) -> Int64 {
    queue.sync {
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { return 0 }
      bind(metadataUnlocked("profile_id") ?? "", to: 1, in: statement)
      bind(metadataUnlocked("manifest_token") ?? "", to: 2, in: statement)
      return sqlite3_step(statement) == SQLITE_ROW ? sqlite3_column_int64(statement, 0) : 0
    }
  }

  private func updateCurrent(_ sql: String) throws {
    try queue.sync {
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      try prepare(sql, &statement)
      bind(metadataUnlocked("profile_id") ?? "", to: 1, in: statement)
      bind(metadataUnlocked("manifest_token") ?? "", to: 2, in: statement)
      try stepDone(statement)
    }
  }

  private func queryOne(_ sql: String, bindings: [String] = [], integer: Int? = nil) -> DictionaryAudioRecord? {
    queue.sync {
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
      for (index, value) in bindings.enumerated() { bind(value, to: Int32(index + 1), in: statement) }
      if let integer { sqlite3_bind_int(statement, 1, Int32(integer)) }
      return sqlite3_step(statement) == SQLITE_ROW ? decodeRecord(statement) : nil
    }
  }

  private func decodeRecord(_ statement: OpaquePointer?) -> DictionaryAudioRecord {
    func text(_ column: Int32) -> String { sqlite3_column_text(statement, column).map { String(cString: $0) } ?? "" }
    let resumeData: Data? = {
      guard let bytes = sqlite3_column_blob(statement, 8) else { return nil }
      return Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 8)))
    }()
    return DictionaryAudioRecord(
      entryID: text(0), profileID: text(1), format: text(2), sha256: text(3), sizeBytes: sqlite3_column_int64(statement, 4),
      state: text(5), attempts: Int(sqlite3_column_int(statement, 6)),
      taskID: sqlite3_column_type(statement, 7) == SQLITE_NULL ? nil : Int(sqlite3_column_int(statement, 7)), resumeData: resumeData
    )
  }

  private func metadataUnlocked(_ key: String) -> String? {
    var statement: OpaquePointer?
    defer { sqlite3_finalize(statement) }
    guard sqlite3_prepare_v2(database, "SELECT value FROM metadata WHERE key = ?", -1, &statement, nil) == SQLITE_OK else { return nil }
    bind(key, to: 1, in: statement)
    guard sqlite3_step(statement) == SQLITE_ROW, let text = sqlite3_column_text(statement, 0) else { return nil }
    return String(cString: text)
  }

  private func updateAsset(_ sql: String, bindings: (OpaquePointer?) -> Void) throws {
    try queue.sync {
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      try prepare(sql, &statement); bindings(statement); try stepDone(statement)
    }
  }

  private func transaction(_ body: () throws -> Void) throws {
    try executeUnlocked("BEGIN IMMEDIATE")
    do { try body(); try executeUnlocked("COMMIT") }
    catch { try? executeUnlocked("ROLLBACK"); throw error }
  }

  private func execute(_ sql: String) throws { try queue.sync { try executeUnlocked(sql) } }

  private func executeUnlocked(_ sql: String) throws {
    guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw storeError("SQLite operation failed") }
  }

  private func prepare(_ sql: String, _ statement: inout OpaquePointer?) throws {
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { throw storeError("SQLite statement failed") }
  }

  private func stepDone(_ statement: OpaquePointer?) throws {
    guard sqlite3_step(statement) == SQLITE_DONE else { throw storeError("SQLite update failed") }
  }

  private func bind(_ value: String, to index: Int32, in statement: OpaquePointer?) {
    sqlite3_bind_text(statement, index, value, -1, SQLITE_TRANSIENT)
  }

  private func storeError(_ message: String) -> NSError {
    NSError(domain: "DictionaryAudioSync", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

private extension String {
  var nilIfEmpty: String? { isEmpty ? nil : self }
}
