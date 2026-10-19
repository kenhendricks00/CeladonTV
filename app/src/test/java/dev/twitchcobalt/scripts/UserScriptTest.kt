package dev.twitchcobalt.scripts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UserScriptTest {
    @Test
    fun `parses name and version from the userscript header`() {
        val source = """
            // ==UserScript==
            // @name         TwitchAdSolutions (vaft)
            // @namespace    https://github.com/ryanbr/TwitchAdSolutions
            // @version      68.5.7
            // ==/UserScript==
            (function() {})();
        """.trimIndent()
        assertEquals(UserScript("TwitchAdSolutions (vaft)", "68.5.7", source), UserScript.parse(source))
    }

    @Test
    fun `rejects text without a complete header`() {
        assertNull(UserScript.parse("<html>Rate limited</html>"))
        assertNull(UserScript.parse("// ==UserScript==\n// @name x\n// ==/UserScript=="))
    }

    @Test
    fun `compares versions numerically`() {
        assertTrue(compareVersions("68.10.0", "68.9.9") > 0)
        assertTrue(compareVersions("1.87", "1.9") > 0)
        assertEquals(0, compareVersions("2.0", "2"))
        assertTrue(compareVersions("1.0", "1.0.1") < 0)
    }
}
