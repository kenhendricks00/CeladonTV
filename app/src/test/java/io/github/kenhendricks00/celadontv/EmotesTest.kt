package io.github.kenhendricks00.celadontv

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EmotesTest {
    private fun config(script: String): JSONObject {
        assertTrue(script.startsWith("window.__ctvEmotes = ") && script.endsWith(";"))
        return JSONObject(script.removePrefix("window.__ctvEmotes = ").removeSuffix(";"))
    }

    @Test
    fun passesEachProviderToggleToTheScript() {
        val all = config(Emotes.configScript(bttv = true, ffz = true, seventv = true))
        assertEquals(true, all.getBoolean("bttv"))
        assertEquals(true, all.getBoolean("ffz"))
        assertEquals(true, all.getBoolean("seventv"))

        val some = config(Emotes.configScript(bttv = false, ffz = true, seventv = false))
        assertEquals(false, some.getBoolean("bttv"))
        assertEquals(true, some.getBoolean("ffz"))
        assertEquals(false, some.getBoolean("seventv"))
    }

    @Test
    fun differentTogglesGiveDifferentScriptsSoThePageReloads() {
        // MainActivity reloads Twitch's page when the injected scripts change.
        val scripts = listOf(
            Emotes.configScript(true, true, true),
            Emotes.configScript(false, true, true),
            Emotes.configScript(true, false, true),
            Emotes.configScript(true, true, false),
        )
        assertEquals(scripts.size, scripts.toSet().size)
    }
}
