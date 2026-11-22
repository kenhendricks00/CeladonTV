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

    val appUpdateCheck: Boolean get() = prefs.getBoolean(KEY_APP_UPDATE_CHECK, true)

    val diagnostics: Boolean get() = prefs.getBoolean(KEY_DIAGNOSTICS, false)

    val emotesBttv: Boolean get() = prefs.getBoolean(KEY_EMOTES_BTTV, true)
    val emotesFfz: Boolean get() = prefs.getBoolean(KEY_EMOTES_FFZ, true)
    val emotes7tv: Boolean get() = prefs.getBoolean(KEY_EMOTES_7TV, true)

    val chatHistory: Boolean get() = prefs.getBoolean(KEY_CHAT_HISTORY, true)
    val chatHideBots: Boolean get() = prefs.getBoolean(KEY_CHAT_HIDE_BOTS, false)
    val chatHideCommands: Boolean get() = prefs.getBoolean(KEY_CHAT_HIDE_COMMANDS, false)
    val chatHiddenWords: List<String> get() = splitList(prefs.getString(KEY_CHAT_HIDDEN_WORDS, null))
    val chatHiddenUsers: List<String> get() = splitList(prefs.getString(KEY_CHAT_HIDDEN_USERS, null))

    var lastAppUpdateCheck: Long
        get() = prefs.getLong(KEY_LAST_APP_UPDATE_CHECK, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_APP_UPDATE_CHECK, value).apply()

    companion object {
        const val KEY_AD_BLOCK = "ad_block"
        const val KEY_VARIANT = "script_variant"
        const val KEY_AUTO_UPDATE = "auto_update"
        const val KEY_UPDATE_NOW = "update_now"
        const val KEY_APP_UPDATE_CHECK = "app_update_check"
        const val KEY_CHECK_APP_UPDATE = "check_app_update"
        const val KEY_DIAGNOSTICS = "diagnostics"
        const val KEY_EMOTES_BTTV = "emotes_bttv"
        const val KEY_EMOTES_FFZ = "emotes_ffz"
        const val KEY_EMOTES_7TV = "emotes_7tv"
        const val KEY_CHAT_HISTORY = "chat_history"
        const val KEY_CHAT_HIDE_BOTS = "chat_hide_bots"
        const val KEY_CHAT_HIDE_COMMANDS = "chat_hide_commands"
        const val KEY_CHAT_HIDDEN_WORDS = "chat_hidden_words"
        const val KEY_CHAT_HIDDEN_USERS = "chat_hidden_users"
        const val KEY_SAVE_DIAGNOSTICS = "save_diagnostics"
        private const val KEY_LAST_UPDATE_CHECK = "last_update_check"
        private const val KEY_LAST_APP_UPDATE_CHECK = "last_app_update_check"

        /** A list typed into a settings field: one entry per comma or line, blanks and repeats dropped. */
        fun splitList(value: String?): List<String> =
            value.orEmpty().split(',', '\n').map { it.trim() }.filter { it.isNotEmpty() }.distinctBy { it.lowercase() }
    }
}
