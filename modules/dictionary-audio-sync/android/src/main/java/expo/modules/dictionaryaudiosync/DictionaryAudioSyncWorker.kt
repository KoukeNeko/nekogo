package expo.modules.dictionaryaudiosync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedReader
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class DictionaryAudioSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  private val db = DictionaryAudioSyncDb(context)
  private val baseUrl = inputData.getString(KEY_BASE_URL)?.trimEnd('/') ?: ""
  private val allowCellular = inputData.getBoolean(KEY_ALLOW_CELLULAR, false)

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    try {
      setForeground(foregroundInfo("音声リストを確認しています"))
      prepareManifest()
      val pendingBytes = db.pendingBytes()
      val requiredBytes = pendingBytes * 3 / 2 + 256L * 1024 * 1024
      if (pendingBytes > 0 && DictionaryAudioSyncFiles.root(applicationContext).usableSpace < requiredBytes) {
        throw IllegalStateException("空き容量が不足しています。少なくとも ${android.text.format.Formatter.formatFileSize(applicationContext, requiredBytes)} 必要です")
      }
      db.setMetadata(mapOf("state" to if (pendingBytes == 0L) "completed" else "downloading"))
      while (!isStopped) {
        if (db.metadata("state") == "paused" || db.metadata("state") == "idle") break
        val batch = db.pending(6)
        if (batch.isEmpty()) break
        coroutineScope { batch.map { async(Dispatchers.IO) { download(it) } }.awaitAll() }
        setProgress(androidx.work.workDataOf("downloadedCount" to (db.status()["downloadedCount"] as Long)))
        setForeground(foregroundInfo("${db.status()["downloadedCount"]} / ${db.status()["readyCount"]} 件"))
      }
      if (!isStopped && db.metadata("state") !in setOf("paused", "idle")) {
        val status = db.status()
        val downloaded = status["downloadedCount"] as Long
        val ready = status["readyCount"] as Long
        val failed = status["failedCount"] as Long
        db.setMetadata(mapOf("state" to if (downloaded >= ready) "completed" else if (failed > 0) "completed_with_errors" else "failed"))
      }
      Result.success()
    } catch (error: Exception) {
      if (!isStopped) db.setMetadata(mapOf("state" to "failed", "last_error" to (error.localizedMessage ?: "同期に失敗しました")))
      Result.failure()
    } finally { db.close() }
  }

  private fun prepareManifest() {
    require(baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) { "音声サーバー URL が正しくありません" }
    val connection = (URL("$baseUrl/api/v1/dictionary-audio/manifest.ndjson").openConnection() as HttpURLConnection).apply {
      connectTimeout = 30_000; readTimeout = 120_000; useCaches = false
    }
    try {
      require(connection.responseCode in 200..299) { "音声 manifest を取得できませんでした (HTTP ${connection.responseCode})" }
      BufferedReader(InputStreamReader(connection.inputStream, Charsets.UTF_8)).use { reader ->
        val first = reader.readLine() ?: error("音声 manifest が空です")
        val header = JSONObject(first)
        require(header.getInt("schema_version") == 1) { "対応していない音声 manifest です" }
        val profileId = header.getString("profile_id")
        val format = header.getString("format")
        require(format in setOf("opus", "m4a", "aac")) { "対応していない音声形式です" }
        val ready = header.getLong("ready_count")
        val token = UUID.randomUUID().toString()
        db.beginManifest(profileId, format, header.getLong("expected_count"), ready, header.getLong("total_bytes"), baseUrl, allowCellular, token)
        var count = 0L
        val batch = ArrayList<Pair<AudioRecord, Boolean>>(512)
        reader.forEachLine { line ->
          if (line.isBlank()) return@forEachLine
          val item = JSONObject(line)
          val entryId = item.getString("entry_id")
          val sha256 = item.getString("sha256")
          val size = item.getLong("size_bytes")
          require(DictionaryAudioSyncFiles.validEntryId(entryId) && sha256.length == 64 && size > 0) { "音声 manifest に不正な項目があります" }
          val record = AudioRecord(entryId, profileId, format, sha256, size, "queued", 0)
          val file = DictionaryAudioSyncFiles.file(applicationContext, entryId, format)
          batch.add(record to DictionaryAudioSyncFiles.valid(file, sha256, size))
          if (batch.size == 512) {
            db.upsertManifestAssets(batch, token)
            batch.clear()
          }
          count++
        }
        db.upsertManifestAssets(batch, token)
        require(count == ready) { "音声 manifest の件数が一致しません" }
      }
    } finally { connection.disconnect() }
  }

  private fun download(initial: AudioRecord) {
    var record = initial
    while (record.attempts <= 3 && !isStopped) {
      try {
        val parts = record.entryId.split(":", limit = 2)
        val url = URL("$baseUrl/api/v1/dictionary-audio/${parts[0]}/${java.net.URLEncoder.encode(parts[1], "UTF-8").replace("+", "%20")}")
        val connection = (url.openConnection() as HttpURLConnection).apply {
          connectTimeout = 30_000; readTimeout = 300_000; useCaches = false
        }
        try {
          require(connection.responseCode in 200..299) { "HTTP ${connection.responseCode}: ${record.entryId}" }
          val part = DictionaryAudioSyncFiles.partFile(applicationContext, record.entryId, record.format)
          part.parentFile?.mkdirs()
          BufferedInputStream(connection.inputStream).use { input -> FileOutputStream(part).use { output -> input.copyTo(output) } }
          require(DictionaryAudioSyncFiles.valid(part, record.sha256, record.sizeBytes)) { "音声ファイルの検証に失敗しました: ${record.entryId}" }
          val destination = DictionaryAudioSyncFiles.file(applicationContext, record.entryId, record.format)
          require(part.renameTo(destination) || run { part.copyTo(destination, overwrite = true); part.delete(); true }) { "音声ファイルを保存できません" }
          db.markComplete(record)
          return
        } finally { connection.disconnect() }
      } catch (error: Exception) {
        db.markRetryOrFailure(record, error.localizedMessage ?: "ダウンロードに失敗しました")
        record = db.record(record.entryId, record.profileId) ?: return
        if (record.state == "failed") return
      }
    }
  }

  private fun foregroundInfo(text: String): ForegroundInfo {
    val manager = applicationContext.getSystemService(Service.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "高品質音声の同期", NotificationManager.IMPORTANCE_LOW))
    val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
      .setSmallIcon(applicationContext.applicationInfo.icon)
      .setContentTitle("高品質音声を同期中")
      .setContentText(text)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .build()
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else ForegroundInfo(NOTIFICATION_ID, notification)
  }

  companion object {
    const val UNIQUE_WORK_NAME = "dictionary-audio-sync"
    const val KEY_BASE_URL = "baseUrl"
    const val KEY_ALLOW_CELLULAR = "allowCellular"
    private const val CHANNEL_ID = "dictionary-audio-sync"
    private const val NOTIFICATION_ID = 20731
  }
}
