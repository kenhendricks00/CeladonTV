package io.github.kenhendricks00.celadontv.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class DiagnosticsLogTest {
    @get:Rule
    val folder = TemporaryFolder()

    private fun log(maxBytes: Long = 256 * 1024) = DiagnosticsLog(folder.root, maxBytes, clock = { 0L })

    @Test
    fun recordsLinesWithATimestampOldestFirst() {
        val log = log()
        log.append("first")
        log.append("second")
        assertEquals("1970-01-01 00:00:00.000Z first\n1970-01-01 00:00:00.000Z second\n", log.read())
    }

    @Test
    fun keepsEachEntryOnOneBoundedLine() {
        val log = log()
        log.append("a\nb\rc" + "x".repeat(5000))
        val line = log.read().trimEnd('\n')
        assertFalse(line.contains('\n'))
        assertEquals("1970-01-01 00:00:00.000Z ".length + DiagnosticsLog.MAX_LINE, line.length)
    }

    @Test
    fun staysWithinTwoFilesOfTheCapReplacingTheOldestOne() {
        val log = log(maxBytes = 1000)
        repeat(500) { log.append("entry $it") }
        val text = log.read()
        assertTrue("bounded: ${text.length}", text.length <= 2 * 1000 + 100)
        assertTrue(text.endsWith("entry 499\n"))
        assertFalse(text.contains("entry 0\n"))
    }

    @Test
    fun clearRemovesEverything() {
        val log = log(maxBytes = 100)
        repeat(20) { log.append("entry $it") }
        log.clear()
        assertEquals("", log.read())
    }
}
