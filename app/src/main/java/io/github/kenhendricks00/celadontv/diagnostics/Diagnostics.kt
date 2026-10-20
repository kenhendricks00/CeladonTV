package io.github.kenhendricks00.celadontv.diagnostics

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.webkit.WebViewCompat
import io.github.kenhendricks00.celadontv.BuildConfig
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Opt-in playback diagnostics: the on-device log and saving it somewhere the user can reach. */
object Diagnostics {
    fun log(context: Context) = DiagnosticsLog(File(context.filesDir, "diagnostics"))

    /**
     * Saves the log with a short device header to Downloads (Android 10+, no permission
     * needed) or to the app's folder on shared storage. Returns where it went, or null if
     * nothing has been recorded.
     */
    fun save(context: Context): String? {
        val body = log(context).read()
        if (body.isEmpty()) return null
        val text = header(context) + body
        val name = "CeladonTV-diagnostics-${SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())}.txt"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, "text/plain")
            }
            val resolver = context.contentResolver
            val uri = checkNotNull(resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)) { "Downloads unavailable" }
            checkNotNull(resolver.openOutputStream(uri)) { "Downloads unavailable" }.use { it.write(text.toByteArray()) }
            return "${Environment.DIRECTORY_DOWNLOADS}/$name"
        }
        val dir = checkNotNull(context.getExternalFilesDir(null)) { "Shared storage unavailable" }
        val file = File(dir, name)
        file.writeText(text)
        return file.absolutePath
    }

    private fun header(context: Context): String {
        val webView = WebViewCompat.getCurrentWebViewPackage(context)
        return buildString {
            appendLine("CeladonTV ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine("WebView: ${webView?.packageName} ${webView?.versionName}")
            appendLine()
        }
    }
}
