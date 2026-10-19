package io.github.kenhendricks00.celadontv.scripts

import java.net.HttpURLConnection
import java.net.URL

class ScriptUpdater(
    private val store: ScriptStore,
    private val download: (String) -> String = ::httpGet,
) {
    sealed interface Outcome {
        data class Updated(val version: String) : Outcome
        data class UpToDate(val version: String) : Outcome
        data class Failed(val error: Throwable) : Outcome
    }

    fun update(variants: Collection<ScriptVariant> = ScriptVariant.entries): Map<ScriptVariant, Outcome> =
        variants.associateWith { variant ->
            runCatching {
                val installed = store.install(variant, download(variant.updateUrl))
                if (installed != null) Outcome.Updated(installed.version) else Outcome.UpToDate(store.load(variant).version)
            }.getOrElse { Outcome.Failed(it) }
        }
}

private const val MAX_SCRIPT_BYTES = 2 * 1024 * 1024

private fun httpGet(url: String): String {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
        connection.connectTimeout = 15_000
        connection.readTimeout = 15_000
        check(connection.responseCode == HttpURLConnection.HTTP_OK) { "HTTP ${connection.responseCode} for $url" }
        val bytes = connection.inputStream.use { it.readNBytesCompat(MAX_SCRIPT_BYTES + 1) }
        check(bytes.size <= MAX_SCRIPT_BYTES) { "$url is larger than $MAX_SCRIPT_BYTES bytes" }
        return bytes.toString(Charsets.UTF_8)
    } finally {
        connection.disconnect()
    }
}

private fun java.io.InputStream.readNBytesCompat(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (out.size() < limit) {
        val read = read(buffer, 0, minOf(buffer.size, limit - out.size()))
        if (read < 0) break
        out.write(buffer, 0, read)
    }
    return out.toByteArray()
}
