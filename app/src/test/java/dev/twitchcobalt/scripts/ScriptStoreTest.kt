package dev.twitchcobalt.scripts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ScriptStoreTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun script(version: String, name: String = "TwitchAdSolutions (vaft)") = """
        // ==UserScript==
        // @name         $name
        // @version      $version
        // ==/UserScript==
        (function() {})();
    """.trimIndent()

    private fun store(bundledVersion: String = "68.5.7") =
        ScriptStore(tmp.root) { script(bundledVersion) }

    @Test
    fun `loads the bundled script when nothing was downloaded`() {
        assertEquals("68.5.7", store().load(ScriptVariant.VAFT).version)
    }

    @Test
    fun `installs and then serves a newer upstream version`() {
        val store = store()
        assertEquals("68.10.0", store.install(ScriptVariant.VAFT, script("68.10.0"))?.version)
        assertEquals("68.10.0", store.load(ScriptVariant.VAFT).version)
    }

    @Test
    fun `installing the same version twice is a no-op`() {
        val store = store()
        store.install(ScriptVariant.VAFT, script("69"))
        assertNull(store.install(ScriptVariant.VAFT, script("69")))
        assertEquals("69", store.load(ScriptVariant.VAFT).version)
    }

    @Test
    fun `rejects older versions, other scripts and non-scripts`() {
        val store = store()
        assertNull(store.install(ScriptVariant.VAFT, script("68.5.6")))
        assertNull(store.install(ScriptVariant.VAFT, script("99", name = "Something else")))
        assertNull(store.install(ScriptVariant.VAFT, "<html>404: Not Found</html>"))
        assertEquals("68.5.7", store.load(ScriptVariant.VAFT).version)
    }

    @Test
    fun `a newer bundled script wins over an older download`() {
        store("68.5.7").install(ScriptVariant.VAFT, script("68.6.0"))
        assertEquals("70.0.0", store("70.0.0").load(ScriptVariant.VAFT).version)
    }

    @Test
    fun `updater reports outcomes per variant`() {
        val updater = ScriptUpdater(store()) { url ->
            if (url.contains("vaft")) script("68.6.0") else error("offline")
        }
        val outcomes = updater.update()
        assertEquals(ScriptUpdater.Outcome.Updated("68.6.0"), outcomes[ScriptVariant.VAFT])
        assert(outcomes[ScriptVariant.VIDEO_SWAP_NEW] is ScriptUpdater.Outcome.Failed)
    }
}
