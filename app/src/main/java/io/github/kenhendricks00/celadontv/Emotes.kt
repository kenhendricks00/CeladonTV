package io.github.kenhendricks00.celadontv

import android.content.Context
import io.github.kenhendricks00.celadontv.settings.AppSettings

/** BetterTTV, FrankerFaceZ and 7TV emotes in Twitch's chat (`celadontv-emotes.js`). */
object Emotes {
    private const val SCRIPT = "celadontv-emotes.js"

    /** The emote providers turned on, as the script reads them from `window.__ctvEmotes`. */
    fun configScript(bttv: Boolean, ffz: Boolean, seventv: Boolean): String =
        "window.__ctvEmotes = {\"bttv\":$bttv,\"ffz\":$ffz,\"seventv\":$seventv};"

    /** Nothing at all is injected when every provider is off. */
    fun scripts(context: Context, settings: AppSettings): List<String> {
        if (!settings.emotesBttv && !settings.emotesFfz && !settings.emotes7tv) return emptyList()
        return listOf(configScript(settings.emotesBttv, settings.emotesFfz, settings.emotes7tv), context.readScriptAsset(SCRIPT))
    }
}
