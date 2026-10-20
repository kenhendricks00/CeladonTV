package io.github.kenhendricks00.celadontv.update

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseTest {
    private val v010 = checkNotNull(javaClass.getResource("/github-release-v0.1.0.json")).readText()

    private fun edited(block: JSONObject.() -> Unit) = JSONObject(v010).apply(block).toString()

    @Test
    fun `parses the published v0_1_0 release`() {
        val release = checkNotNull(Release.fromGitHubJson(v010))
        assertEquals(SemVer.parse("0.1.0"), release.version)
        assertEquals("https://github.com/kenhendricks00/CeladonTV/releases/download/v0.1.0/CeladonTV.apk", release.apk.url)
        assertEquals(3435725L, release.apk.size)
        assertEquals("0e844e4dea68a134f798eecce361e5d07c6ec31366f7a803ca312cf1a9b9639a", release.apk.sha256)
    }

    @Test
    fun `ignores drafts, pre-releases and non-semver tags`() {
        assertNull(Release.fromGitHubJson(edited { put("draft", true) }))
        assertNull(Release.fromGitHubJson(edited { put("prerelease", true) }))
        assertNull(Release.fromGitHubJson(edited { put("tag_name", "nightly") }))
        assertNull(Release.fromGitHubJson("{}"))
    }

    @Test
    fun `requires an HTTPS asset named exactly CeladonTV_apk with a size`() {
        val asset = { block: JSONObject.() -> Unit -> edited { getJSONArray("assets").getJSONObject(0).apply(block) } }
        assertNull(Release.fromGitHubJson(asset { put("name", "CeladonTV-debug.apk") }))
        assertNull(Release.fromGitHubJson(asset { put("name", "celadontv.apk") }))
        assertNull(Release.fromGitHubJson(asset { put("browser_download_url", "http://example.com/CeladonTV.apk") }))
        assertNull(Release.fromGitHubJson(asset { put("size", 0) }))
        assertNull(Release.fromGitHubJson(asset { remove("digest") })?.apk?.sha256)
    }

    @Test
    fun `release notes excerpt drops markup and the install section`() {
        val notes = Release.notesExcerpt(checkNotNull(Release.fromGitHubJson(v010)).notes, maxLines = 20)
        assertTrue(notes.startsWith("Ad blocking has only been tested against simulated ad breaks"))
        assertTrue(notes.contains("✨ Features"))
        assertFalse(notes.contains("**") || notes.contains("[!WARNING]") || notes.contains("`"))
        assertFalse(notes.contains("6719631"))
    }

    @Test
    fun `release notes excerpt never ends on a heading`() {
        val body = "#### **Features**\n- One\n- Two\n\n#### **License**\n- MIT"
        assertEquals("Features\n- One\n- Two", Release.notesExcerpt(body, maxLines = 4))
    }
}
