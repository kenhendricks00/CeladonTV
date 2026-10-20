package io.github.kenhendricks00.celadontv

import android.content.Context
import android.util.Log
import io.github.kenhendricks00.celadontv.scripts.ScriptStore
import io.github.kenhendricks00.celadontv.scripts.ScriptUpdater
import io.github.kenhendricks00.celadontv.scripts.ScriptVariant
import io.github.kenhendricks00.celadontv.settings.AppSettings
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
        // The adapter goes first so its backup-stream requests use the browser's own fetch:
        // the TwitchAdSolutions scripts rewrite access-token requests made through theirs.
        return listOf(context.readScriptAsset(ADAPTER), store(context).load(settings.variant).source)
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

internal fun Context.readScriptAsset(name: String): String =
    assets.open("scripts/$name").bufferedReader().use { it.readText() }
