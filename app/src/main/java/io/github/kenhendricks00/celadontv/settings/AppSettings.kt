package io.github.kenhendricks00.celadontv.settings

import android.content.Context
import androidx.preference.PreferenceManager
import io.github.kenhendricks00.celadontv.scripts.ScriptVariant

class AppSettings(context: Context) {
    private val prefs = PreferenceManager.getDefaultSharedPreferences(context)

    val adBlockEnabled: Boolean get() = prefs.getBoolean(KEY_AD_BLOCK, true)
    val variant: ScriptVariant get() = ScriptVariant.fromKey(prefs.getString(KEY_VARIANT, null))
    val autoUpdate: Boolean get() = prefs.getBoolean(KEY_AUTO_UPDATE, true)

    var lastUpdateCheck: Long
        get() = prefs.getLong(KEY_LAST_UPDATE_CHECK, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_UPDATE_CHECK, value).apply()

    companion object {
        const val KEY_AD_BLOCK = "ad_block"
        const val KEY_VARIANT = "script_variant"
        const val KEY_AUTO_UPDATE = "auto_update"
        const val KEY_UPDATE_NOW = "update_now"
        private const val KEY_LAST_UPDATE_CHECK = "last_update_check"
    }
}
