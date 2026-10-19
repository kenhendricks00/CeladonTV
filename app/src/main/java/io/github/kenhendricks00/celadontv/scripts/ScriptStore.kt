package io.github.kenhendricks00.celadontv.scripts

import java.io.File

/**
 * Resolves each upstream script to the newest of the copy bundled in the APK and the
 * copy last downloaded into [updatesDir].
 */
class ScriptStore(private val updatesDir: File, private val readBundled: (String) -> String) {

    fun load(variant: ScriptVariant): UserScript {
        val bundled = checkNotNull(UserScript.parse(readBundled(variant.fileName))) {
            "Bundled ${variant.fileName} has no userscript header"
        }
        val downloaded = updateFile(variant).takeIf { it.isFile }?.readText()?.let(UserScript::parse)
        return if (downloaded != null && downloaded.name == bundled.name &&
            compareVersions(downloaded.version, bundled.version) > 0
        ) downloaded else bundled
    }

    /** Stores [source] if it is a newer version of the same script; returns the stored script. */
    fun install(variant: ScriptVariant, source: String): UserScript? {
        val candidate = UserScript.parse(source) ?: return null
        val current = load(variant)
        if (candidate.name != current.name || compareVersions(candidate.version, current.version) <= 0) return null
        updatesDir.mkdirs()
        val target = updateFile(variant)
        val tmp = File(updatesDir, "${variant.fileName}.tmp")
        tmp.writeText(source)
        if (!tmp.renameTo(target)) {
            target.delete()
            check(tmp.renameTo(target)) { "Could not replace $target" }
        }
        return candidate
    }

    private fun updateFile(variant: ScriptVariant) = File(updatesDir, variant.fileName)
}
