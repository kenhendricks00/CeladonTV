package dev.twitchcobalt

import android.content.Context
import android.util.Log
import dev.twitchcobalt.scripts.ScriptStore
import dev.twitchcobalt.scripts.ScriptUpdater
import dev.twitchcobalt.scripts.ScriptVariant
import dev.twitchcobalt.settings.AppSettings
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Wires the bundled/updated upstream scripts and the hls.js adapter to app settings. */
object AdBlock {
    private const val TAG = "AdBlock"
    private const val ADAPTER = "starshot-hls-adblock.js"
    private val UPDATE_INTERVAL_MS = TimeUnit.HOURS.toMillis(24)
    private val executor = Executors.newSingleThreadExecutor()

    fun store(context: Context) = ScriptStore(File(context.filesDir, "scripts"), context::readScriptAsset)

    fun scripts(context: Context, settings: AppSettings): List<String> {
        if (!settings.adBlockEnabled) return emptyList()
        return listOf(store(context).load(settings.variant).source, context.readScriptAsset(ADAPTER))
    }

    fun update(context: Context, onDone: (Map<ScriptVariant, ScriptUpdater.Outcome>) -> Unit) {
        val appContext = context.applicationContext
        executor.execute {
            val outcomes = ScriptUpdater(store(appContext)).update()
            outcomes.forEach { (variant, outcome) -> Log.i(TAG, "${variant.key}: $outcome") }
            AppSettings(appContext).lastUpdateCheck = System.currentTimeMillis()
            onDone(outcomes)
        }
    }

    fun updateIfDue(context: Context, settings: AppSettings) {
        if (!settings.autoUpdate || System.currentTimeMillis() - settings.lastUpdateCheck < UPDATE_INTERVAL_MS) return
        update(context) {}
    }
}

private fun Context.readScriptAsset(name: String): String =
    assets.open("scripts/$name").bufferedReader().use { it.readText() }
