package io.github.kenhendricks00.celadontv.update

import org.json.JSONObject

/** A published CeladonTV release that carries the sideloadable APK. */
data class Release(val version: SemVer, val notes: String, val apk: Asset) {
    data class Asset(val url: String, val size: Long, val sha256: String?)

    companion object {
        const val ASSET_NAME = "CeladonTV.apk"
        private val SHA256 = Regex("^sha256:([0-9a-f]{64})$")

        /** Parses a GitHub "get release" response; null for drafts, pre-releases, or releases without the APK. */
        fun fromGitHubJson(json: String): Release? {
            val release = JSONObject(json)
            if (release.optBoolean("draft") || release.optBoolean("prerelease")) return null
            val version = SemVer.parse(release.optString("tag_name")) ?: return null
            val assets = release.optJSONArray("assets") ?: return null
            val apk = (0 until assets.length()).map(assets::getJSONObject).firstOrNull { it.optString("name") == ASSET_NAME }
                ?: return null
            val url = apk.optString("browser_download_url")
            val size = apk.optLong("size")
            if (!url.startsWith("https://") || size <= 0) return null
            val sha256 = SHA256.matchEntire(apk.optString("digest"))?.groupValues?.get(1)
            return Release(version, release.optString("body"), Asset(url, size, sha256))
        }

        /** The release notes as plain lines, without Markdown markup, the install section, or a dangling heading. */
        fun notesExcerpt(body: String, maxLines: Int = 8): String {
            val lines = body.lineSequence()
                .map { it.trim() }
                .takeWhile { !(it.startsWith("#") && it.contains("Install", ignoreCase = true)) }
                .map { it.removePrefix(">").trim() }
                .filter { it.isNotEmpty() && !it.startsWith("[!") }
                .take(maxLines)
                .toMutableList()
            while (lines.lastOrNull()?.startsWith("#") == true) lines.removeAt(lines.lastIndex)
            return lines.joinToString("\n") { it.replace(Regex("""^#+\s*"""), "").replace("**", "").replace("`", "") }
        }
    }
}
