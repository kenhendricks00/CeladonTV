package io.github.kenhendricks00.celadontv

import android.content.Context
import io.github.kenhendricks00.celadontv.settings.AppSettings
import org.json.JSONArray
import org.json.JSONObject

/** Earlier chat messages and chat filters (`celadontv-chat.js`). */
object Chat {
    private const val SCRIPT = "celadontv-chat.js"

    data class Config(
        val history: Boolean,
        val hideBots: Boolean,
        val hideCommands: Boolean,
        val words: List<String>,
        val users: List<String>,
    ) {
        val isOff get() = !history && !hideBots && !hideCommands && words.isEmpty() && users.isEmpty()
    }

    fun config(settings: AppSettings) = Config(
        history = settings.chatHistory,
        hideBots = settings.chatHideBots,
        hideCommands = settings.chatHideCommands,
        words = settings.chatHiddenWords,
        users = settings.chatHiddenUsers,
    )

    /** The settings, as the script reads them from `window.__ctvChat`. */
    fun configScript(config: Config): String {
        val json = JSONObject()
            .put("history", config.history)
            .put("hideBots", config.hideBots)
            .put("hideCommands", config.hideCommands)
            .put("words", JSONArray(config.words))
            .put("users", JSONArray(config.users))
        return "window.__ctvChat = $json;"
    }

    /** Nothing at all is injected when every chat option is off. */
    fun scripts(context: Context, settings: AppSettings): List<String> {
        val config = config(settings)
        if (config.isOff) return emptyList()
        return listOf(configScript(config), context.readScriptAsset(SCRIPT))
    }
}
