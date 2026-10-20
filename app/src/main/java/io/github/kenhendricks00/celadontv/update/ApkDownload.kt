package io.github.kenhendricks00.celadontv.update

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

object ApkDownload {
    /** Downloads [asset] into [dest] over HTTPS, verifying its size and (when GitHub provides it) its SHA-256. */
    fun download(asset: Release.Asset, dest: File, isCancelled: () -> Boolean, onProgress: (Long) -> Unit) {
        val connection = URL(asset.url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            val code = connection.responseCode
            if (connection.url.protocol != "https") throw IOException("Download was redirected away from HTTPS")
            if (code != HttpURLConnection.HTTP_OK) throw IOException("HTTP $code while downloading the update")
            dest.parentFile?.mkdirs()
            connection.inputStream.use { input ->
                dest.outputStream().use { output -> copyVerified(input, output, asset.size, asset.sha256, isCancelled, onProgress) }
            }
        } catch (e: Exception) {
            dest.delete()
            throw e
        } finally {
            connection.disconnect()
        }
    }

    /** Copies exactly [size] bytes, failing on a short or long stream, a digest mismatch, or cancellation. */
    fun copyVerified(
        input: InputStream,
        output: OutputStream,
        size: Long,
        sha256: String?,
        isCancelled: () -> Boolean = { false },
        onProgress: (Long) -> Unit = {},
    ) {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            if (isCancelled()) throw CancelledException()
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > size) throw IOException("The update is larger than the release says ($size bytes)")
            digest.update(buffer, 0, read)
            output.write(buffer, 0, read)
            onProgress(total)
        }
        if (total != size) throw IOException("The update download was incomplete ($total of $size bytes)")
        if (sha256 != null) {
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (actual != sha256) throw IOException("The update's checksum doesn't match the release")
        }
    }

    class CancelledException : IOException("Download cancelled")
}
