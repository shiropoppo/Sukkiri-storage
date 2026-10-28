package io.github.shiropoppo.sukkiri.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HashingTest {
    private fun md5(s: String) = Hashing.md5(s.toByteArray().inputStream()).md5

    @Test
    fun knownValues() {
        assertEquals("d41d8cd98f00b204e9800998ecf8427e", md5(""))
        assertEquals("900150983cd24fb0d6963f7d28e17f72", md5("abc"))
        assertEquals("9e107d9d372bb6826bd81d3542a419d6", md5("The quick brown fox jumps over the lazy dog"))
    }

    @Test
    fun countsBytes() {
        val data = ByteArray(3 * 1024 * 1024 + 7) { (it % 251).toByte() }
        assertEquals(data.size.toLong(), Hashing.md5(data.inputStream()).bytes)
    }

    @Test
    fun neverMatchesBrokenValues() {
        assertFalse(Hashing.sameMd5(null, null))
        assertFalse(Hashing.sameMd5("", ""))
        assertFalse(Hashing.sameMd5("D41D8CD98F00B204E9800998ECF8427E", "D41D8CD98F00B204E9800998ECF8427E"))
        assertTrue(Hashing.sameMd5("d41d8cd98f00b204e9800998ecf8427e", "d41d8cd98f00b204e9800998ecf8427e"))
    }
}
