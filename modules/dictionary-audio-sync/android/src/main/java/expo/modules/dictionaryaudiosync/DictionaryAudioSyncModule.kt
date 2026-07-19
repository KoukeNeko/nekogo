package expo.modules.dictionaryaudiosync

import android.content.Context
import androidx.lifecycle.Observer
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.URI

class DictionaryAudioSyncModule : Module() {
  private val context: Context get() = requireNotNull(appContext.reactContext).applicationContext
  private val db: DictionaryAudioSyncDb get() = DictionaryAudioSyncDb(context)
  private var observer: Observer<List<WorkInfo>>? = null

  override fun definition() = ModuleDefinition {
    Name("DictionaryAudioSync")
    Events("onStateChanged", "onProgress")

    OnCreate {
      observer = Observer { sendEvent("onProgress", db.use { it.status() }) }
      observer?.let { WorkManager.getInstance(context).getWorkInfosForUniqueWorkLiveData(DictionaryAudioSyncWorker.UNIQUE_WORK_NAME).observeForever(it) }
    }
    OnDestroy {
      observer?.let { WorkManager.getInstance(context).getWorkInfosForUniqueWorkLiveData(DictionaryAudioSyncWorker.UNIQUE_WORK_NAME).removeObserver(it) }
      observer = null
    }

    AsyncFunction("startSync") { baseUrl: String, allowCellular: Boolean ->
      val normalized = normalizeBaseUrl(baseUrl)
      db.use { it.setMetadata(mapOf("state" to "preparing", "base_url" to normalized, "allow_cellular" to if (allowCellular) "1" else "0", "last_error" to "")) }
      enqueue(normalized, allowCellular)
      statusAndEmit()
    }
    AsyncFunction("pauseSync") {
      WorkManager.getInstance(context).cancelUniqueWork(DictionaryAudioSyncWorker.UNIQUE_WORK_NAME)
      db.use { it.setCurrentState("queued", "paused"); it.setMetadata(mapOf("state" to "paused")) }
      statusAndEmit()
    }
    AsyncFunction("resumeSync") { allowCellular: Boolean ->
      db.use {
        it.setCurrentState("paused", "queued")
        it.setMetadata(mapOf("state" to "downloading", "allow_cellular" to if (allowCellular) "1" else "0", "last_error" to ""))
        enqueue(requireNotNull(it.metadata("base_url")) { "音声サーバー URL がありません" }, allowCellular)
      }
      statusAndEmit()
    }
    AsyncFunction("cancelSync") {
      WorkManager.getInstance(context).cancelUniqueWork(DictionaryAudioSyncWorker.UNIQUE_WORK_NAME)
      db.use { it.setMetadata(mapOf("state" to "idle", "last_error" to "")) }
      statusAndEmit()
    }
    AsyncFunction("clearAll") {
      WorkManager.getInstance(context).cancelUniqueWork(DictionaryAudioSyncWorker.UNIQUE_WORK_NAME)
      DictionaryAudioSyncFiles.root(context).deleteRecursively()
      db.use { it.reset() }
      statusAndEmit()
    }
    AsyncFunction("deleteEntry") { entryId: String ->
      require(DictionaryAudioSyncFiles.validEntryId(entryId)) { "音声 ID が正しくありません" }
      listOf("opus", "m4a", "aac").forEach {
        DictionaryAudioSyncFiles.file(context, entryId, it).delete()
        DictionaryAudioSyncFiles.partFile(context, entryId, it).delete()
      }
      db.use { it.deleteEntry(entryId) }
      statusAndEmit()
    }
    AsyncFunction("getStatus") { db.use { it.status() } }
    AsyncFunction("getLocalUri") { entryId: String ->
      if (!DictionaryAudioSyncFiles.validEntryId(entryId)) return@AsyncFunction null
      db.use {
        val record = it.playableRecord(entryId) ?: return@use null
        val file = DictionaryAudioSyncFiles.file(context, entryId, record.format)
        if (DictionaryAudioSyncFiles.valid(file, record.sha256, record.sizeBytes)) DictionaryAudioSyncFiles.uri(file) else null
      }
    }
  }

  private fun enqueue(baseUrl: String, allowCellular: Boolean) {
    val constraints = Constraints.Builder().setRequiredNetworkType(if (allowCellular) NetworkType.CONNECTED else NetworkType.UNMETERED).build()
    val request = OneTimeWorkRequestBuilder<DictionaryAudioSyncWorker>()
      .setConstraints(constraints)
      .setInputData(workDataOf(DictionaryAudioSyncWorker.KEY_BASE_URL to baseUrl, DictionaryAudioSyncWorker.KEY_ALLOW_CELLULAR to allowCellular))
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(DictionaryAudioSyncWorker.UNIQUE_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
  }

  private fun statusAndEmit(): Map<String, Any?> = db.use { it.status() }.also { sendEvent("onStateChanged", it) }

  private fun normalizeBaseUrl(raw: String): String {
    val uri = URI(raw.trim())
    require(uri.scheme in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null) {
      "音声サーバー URL が正しくありません"
    }
    return raw.trim().trimEnd('/')
  }
}
