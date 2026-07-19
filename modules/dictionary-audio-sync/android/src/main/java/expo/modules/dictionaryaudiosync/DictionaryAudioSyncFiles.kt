package expo.modules.dictionaryaudiosync

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

object DictionaryAudioSyncFiles {
  fun root(context: Context) = File(context.filesDir, "dictionary-audio")

  fun file(context: Context, entryId: String, format: String): File {
    val (kind, id) = entryId.split(":", limit = 2)
    return File(File(root(context), kind), "$id.$format")
  }

  fun partFile(context: Context, entryId: String, format: String) = File(file(context, entryId, format).path + ".part")

  fun valid(file: File, sha256: String, sizeBytes: Long): Boolean =
    file.isFile && file.length() == sizeBytes && runCatching { sha256(file) }.getOrNull() == sha256.lowercase()

  fun uri(file: File): String = Uri.fromFile(file).toString()

  fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(1024 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  fun validEntryId(entryId: String): Boolean {
    val parts = entryId.split(":", limit = 2)
    return parts.size == 2 && parts[0] in setOf("vocab", "example") && parts[1].isNotEmpty() &&
      parts[1].none { it == '/' || it == '\\' || it == '\n' || it == '\r' }
  }
}
