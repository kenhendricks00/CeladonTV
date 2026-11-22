package io.github.kenhendricks00.celadontv

import io.github.kenhendricks00.celadontv.settings.AppSettings
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatTest {
    private val defaults = Chat.Config(history = true, hideBots = false, hideCommands = false, words = emptyList(), users = emptyList())

    private fun config(script: String): JSONObject {
        assertTrue(script.startsWith("window.__ctvChat = ") && script.endsWith(";"))
        return JSONObject(script.removePrefix("window.__ctvChat = ").removeSuffix(";"))
    }

    @Test
    fun passesEverySettingToTheScript() {
        val json = config(Chat.configScript(Chat.Config(true, true, false, listOf("spoiler", "say \"hi\""), listOf("nightbot"))))
        assertEquals(true, json.getBoolean("history"))
        assertEquals(true, json.getBoolean("hideBots"))
        assertEquals(false, json.getBoolean("hideCommands"))
        assertEquals(listOf("spoiler", "say \"hi\""), json.getJSONArray("words").let { a -> List(a.length()) { a.getString(it) } })
        assertEquals("nightbot", json.getJSONArray("users").getString(0))
    }

    @Test
    fun isOffOnlyWhenNothingIsOn() {
        assertTrue(defaults.copy(history = false).isOff)
        assertFalse(defaults.isOff)
        assertFalse(defaults.copy(history = false, users = listOf("a")).isOff)
        assertFalse(defaults.copy(history = false, hideCommands = true).isOff)
    }

    @Test
    fun differentSettingsGiveDifferentScriptsSoThePageReloads() {
        val scripts = listOf(
            defaults,
            defaults.copy(history = false, hideBots = true),
            defaults.copy(hideCommands = true),
            defaults.copy(words = listOf("a")),
            defaults.copy(users = listOf("a")),
        ).map(Chat::configScript)
        assertEquals(scripts.size, scripts.toSet().size)
    }

    @Test
    fun splitsTypedListsOnCommasAndLines() {
        assertEquals(listOf("spoiler", "game over", "Nightbot"), AppSettings.splitList(" spoiler, game over ,,\nNightbot\n, SPOILER "))
        assertEquals(emptyList<String>(), AppSettings.splitList(null))
        assertEquals(emptyList<String>(), AppSettings.splitList(" , "))
    }
}
