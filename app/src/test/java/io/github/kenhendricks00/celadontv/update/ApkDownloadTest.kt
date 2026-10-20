package io.github.kenhendricks00.celadontv.update

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.MessageDigest

class ApkDownloadTest {
    private val bytes = ByteArray(200_000) { (it % 251).toByte() }
    private val sha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun copy(size: Long = bytes.size.toLong(), digest: String? = sha256, data: ByteArray = bytes, cancelled: Boolean = false) =
        ByteArrayOutputStream().also {
            ApkDownload.copyVerified(ByteArrayInputStream(data), it, size, digest, isCancelled = { cancelled })
        }.toByteArray()

    @Test
    fun `copies a download that matches the release size and digest`() {
        assertArrayEquals(bytes, copy())
        assertArrayEquals(bytes, copy(digest = null))
    }

    @Test
    fun `rejects truncated, oversized and tampered downloads`() {
        assertThrows(IOException::class.java) { copy(data = bytes.copyOf(bytes.size - 1)) }
        assertThrows(IOException::class.java) { copy(size = bytes.size - 1L) }
        assertThrows(IOException::class.java) { copy(data = bytes.clone().also { it[1234] = 0x7f }) }
    }

    @Test
    fun `reports progress and stops when cancelled`() {
        val seen = mutableListOf<Long>()
        ApkDownload.copyVerified(ByteArrayInputStream(bytes), ByteArrayOutputStream(), bytes.size.toLong(), sha256) { seen += it }
        assertEquals(bytes.size.toLong(), seen.last())
        assertThrows(ApkDownload.CancelledException::class.java) { copy(cancelled = true) }
    }
}
