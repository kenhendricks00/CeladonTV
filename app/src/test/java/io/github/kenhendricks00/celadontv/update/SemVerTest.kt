package io.github.kenhendricks00.celadontv.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SemVerTest {
    private fun v(text: String) = checkNotNull(SemVer.parse(text)) { "unparseable $text" }

    @Test
    fun `accepts release tags with or without a leading v`() {
        assertEquals(v("0.1.0"), v("v0.1.0"))
        assertEquals("1.2.3-rc.1", v("v1.2.3-rc.1+build.7").toString())
    }

    @Test
    fun `rejects anything that is not semver`() {
        listOf("", "1", "1.2", "1.2.3.4", "01.2.3", "1.2.3-", "1.2.3-01", "latest", "v1.2.x", "1.2.3 beta").forEach {
            assertNull(it, SemVer.parse(it))
        }
    }

    @Test
    fun `orders by numeric major, minor and patch`() {
        assertTrue(v("0.1.0") < v("0.2.0"))
        assertTrue(v("0.9.0") < v("0.10.0"))
        assertTrue(v("1.0.0") > v("0.99.99"))
        assertTrue(v("1.2.10") > v("1.2.9"))
    }

    @Test
    fun `orders pre-releases below their release, following the semver precedence example`() {
        val ordered = listOf(
            "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta",
            "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0",
        ).map(::v)
        assertEquals(ordered, ordered.shuffled(java.util.Random(7)).sorted())
    }

    @Test
    fun `ignores build metadata when comparing`() {
        assertEquals(0, v("1.0.0+a").compareTo(v("1.0.0+b")))
    }
}
