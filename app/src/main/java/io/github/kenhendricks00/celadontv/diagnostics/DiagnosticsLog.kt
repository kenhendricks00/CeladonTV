package io.github.kenhendricks00.celadontv.diagnostics

import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * A small on-device log of how the ad filter handled playback, kept only while the user has
 * turned diagnostics on. It holds at most two files of [maxBytes] each: when the current one
 * is full it replaces the previous one.
 */
class DiagnosticsLog(private val dir: File, private val maxBytes: Long = 256 * 1024, private val clock: () -> Long = System::currentTimeMillis) {
    private val current get() = File(dir, "diagnostics.log")
    private val previous get() = File(dir, "diagnostics.1.log")
    private val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

    @Synchronized
    fun append(line: String) {
        dir.mkdirs()
        if (current.length() >= maxBytes) {
            previous.delete()
            current.renameTo(previous)
        }
        val clean = line.take(MAX_LINE).replace('\n', ' ').replace('\r', ' ')
        current.appendText("${timestamp.format(Date(clock()))} $clean\n")
    }

    /** Everything recorded, oldest first, or an empty string. */
    @Synchronized
    fun read(): String = listOf(previous, current).filter(File::exists).joinToString("") { it.readText() }

    @Synchronized
    fun clear() {
        previous.delete()
        current.delete()
    }

    companion object {
        const val MAX_LINE = 2000
    }
}
