package expo.modules.dictionaryaudiosync

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class AudioRecord(
  val entryId: String,
  val profileId: String,
  val format: String,
  val sha256: String,
  val sizeBytes: Long,
  val state: String,
  val attempts: Int,
)

class DictionaryAudioSyncDb(context: Context) : SQLiteOpenHelper(context, "dictionary-audio-sync.sqlite", null, 1) {
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    db.execSQL("""
      CREATE TABLE assets(
        entry_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        format TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        manifest_token TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(entry_id, profile_id)
      )
    """.trimIndent())
    db.execSQL("CREATE INDEX idx_assets_queue ON assets(profile_id, manifest_token, state, entry_id)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

  @Synchronized fun metadata(key: String): String? = readableDatabase.rawQuery(
    "SELECT value FROM metadata WHERE key = ?", arrayOf(key)
  ).use { if (it.moveToFirst()) it.getString(0) else null }

  @Synchronized fun setMetadata(values: Map<String, String>) {
    writableDatabase.beginTransaction()
    try {
      values.forEach { (key, value) ->
        writableDatabase.insertWithOnConflict("metadata", null, ContentValues().apply {
          put("key", key); put("value", value)
        }, SQLiteDatabase.CONFLICT_REPLACE)
      }
      writableDatabase.setTransactionSuccessful()
    } finally { writableDatabase.endTransaction() }
  }

  fun beginManifest(profileId: String, format: String, expected: Long, ready: Long, totalBytes: Long, baseUrl: String, allowCellular: Boolean, token: String) = setMetadata(mapOf(
    "state" to "preparing", "profile_id" to profileId, "format" to format,
    "expected_count" to expected.toString(), "ready_count" to ready.toString(),
    "total_bytes" to totalBytes.toString(), "base_url" to baseUrl,
    "allow_cellular" to if (allowCellular) "1" else "0", "manifest_token" to token, "last_error" to "",
  ))

  @Synchronized fun upsertManifestAssets(records: List<Pair<AudioRecord, Boolean>>, token: String) {
    if (records.isEmpty()) return
    writableDatabase.beginTransaction()
    try {
      records.forEach { (record, localIsValid) ->
        writableDatabase.insertWithOnConflict("assets", null, ContentValues().apply {
          put("entry_id", record.entryId); put("profile_id", record.profileId); put("format", record.format)
          put("sha256", record.sha256); put("size_bytes", record.sizeBytes); put("state", if (localIsValid) "complete" else "queued")
          put("attempts", 0); put("manifest_token", token); put("updated_at", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_REPLACE)
      }
      writableDatabase.setTransactionSuccessful()
    } finally { writableDatabase.endTransaction() }
  }

  @Synchronized fun record(entryId: String, profileId: String): AudioRecord? = readableDatabase.rawQuery(
    "SELECT entry_id, profile_id, format, sha256, size_bytes, state, attempts FROM assets WHERE entry_id = ? AND profile_id = ?",
    arrayOf(entryId, profileId),
  ).use { if (it.moveToFirst()) decode(it) else null }

  @Synchronized fun playableRecord(entryId: String): AudioRecord? {
    val current = metadata("profile_id") ?: ""
    return readableDatabase.rawQuery("""
      SELECT entry_id, profile_id, format, sha256, size_bytes, state, attempts FROM assets
      WHERE entry_id = ? AND state = 'complete'
      ORDER BY CASE WHEN profile_id = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
    """.trimIndent(), arrayOf(entryId, current)).use { if (it.moveToFirst()) decode(it) else null }
  }

  @Synchronized fun pending(limit: Int): List<AudioRecord> {
    val profile = metadata("profile_id") ?: ""
    val token = metadata("manifest_token") ?: ""
    return readableDatabase.rawQuery("""
      SELECT entry_id, profile_id, format, sha256, size_bytes, state, attempts FROM assets
      WHERE profile_id = ? AND manifest_token = ? AND state IN ('queued', 'paused')
      ORDER BY entry_id LIMIT ?
    """.trimIndent(), arrayOf(profile, token, limit.toString())).use { cursor ->
      buildList { while (cursor.moveToNext()) add(decode(cursor)) }
    }
  }

  @Synchronized fun pendingBytes(): Long = aggregateLong("SUM(CASE WHEN state != 'complete' THEN size_bytes ELSE 0 END)")

  @Synchronized fun markComplete(record: AudioRecord) {
    writableDatabase.execSQL("UPDATE assets SET state = 'complete', attempts = 0, updated_at = ? WHERE entry_id = ? AND profile_id = ?",
      arrayOf<Any>(System.currentTimeMillis(), record.entryId, record.profileId))
  }

  @Synchronized fun markRetryOrFailure(record: AudioRecord, error: String) {
    val attempts = record.attempts + 1
    writableDatabase.execSQL("UPDATE assets SET state = ?, attempts = ?, updated_at = ? WHERE entry_id = ? AND profile_id = ?",
      arrayOf<Any>(if (attempts <= 3) "queued" else "failed", attempts, System.currentTimeMillis(), record.entryId, record.profileId))
    setMetadata(mapOf("last_error" to error))
  }

  @Synchronized fun setCurrentState(from: String, to: String) {
    val profile = metadata("profile_id") ?: return
    val token = metadata("manifest_token") ?: return
    writableDatabase.execSQL("UPDATE assets SET state = ? WHERE profile_id = ? AND manifest_token = ? AND state = ?", arrayOf(to, profile, token, from))
  }

  @Synchronized fun deleteEntry(entryId: String) {
    writableDatabase.delete("assets", "entry_id = ?", arrayOf(entryId))
  }

  @Synchronized fun reset() {
    writableDatabase.execSQL("DELETE FROM assets")
    writableDatabase.execSQL("DELETE FROM metadata")
  }

  @Synchronized fun status(): Map<String, Any?> = mapOf(
    "state" to (metadata("state") ?: "idle"),
    "profileId" to metadata("profile_id"),
    "format" to metadata("format"),
    "readyCount" to (metadata("ready_count")?.toLongOrNull() ?: 0L),
    "expectedCount" to (metadata("expected_count")?.toLongOrNull() ?: 0L),
    "downloadedCount" to aggregateLong("SUM(CASE WHEN state = 'complete' THEN 1 ELSE 0 END)"),
    "failedCount" to aggregateLong("SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END)"),
    "totalBytes" to (metadata("total_bytes")?.toLongOrNull() ?: 0L),
    "downloadedBytes" to aggregateLong("SUM(CASE WHEN state = 'complete' THEN size_bytes ELSE 0 END)"),
    "lastError" to metadata("last_error")?.ifEmpty { null },
    "allowCellular" to (metadata("allow_cellular") == "1"),
  )

  private fun aggregateLong(expression: String): Long {
    val profile = metadata("profile_id") ?: ""
    val token = metadata("manifest_token") ?: ""
    return readableDatabase.rawQuery("SELECT COALESCE($expression, 0) FROM assets WHERE profile_id = ? AND manifest_token = ?", arrayOf(profile, token))
      .use { if (it.moveToFirst()) it.getLong(0) else 0L }
  }

  private fun decode(cursor: Cursor) = AudioRecord(
    entryId = cursor.getString(0), profileId = cursor.getString(1), format = cursor.getString(2),
    sha256 = cursor.getString(3), sizeBytes = cursor.getLong(4), state = cursor.getString(5), attempts = cursor.getInt(6),
  )
}
