package io.github.shiropoppo.sukkiri.data

import java.io.InputStream
import java.security.MessageDigest

/** 中身の指紋（MD5）。Google ドライブもファイルごとに同じ MD5 を持っているので、これで「まったく同じ」かを確かめる */
object Hashing {
    private const val BUFFER = 1 shl 20

    class Result(val md5: String, val bytes: Long)

    fun md5(input: InputStream, onBytes: (Long) -> Unit = {}): Result {
        val md = MessageDigest.getInstance("MD5")
        val buf = ByteArray(BUFFER)
        var total = 0L
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            md.update(buf, 0, n)
            total += n
            onBytes(n.toLong())
        }
        return Result(md.digest().toHex(), total)
    }

    fun ByteArray.toHex(): String {
        val out = StringBuilder(size * 2)
        for (b in this) {
            val v = b.toInt() and 0xff
            out.append(HEX[v ushr 4]).append(HEX[v and 0x0f])
        }
        return out.toString()
    }

    private val HEX = "0123456789abcdef".toCharArray()

    private val MD5_FORMAT = Regex("^[0-9a-f]{32}$")

    /** 計算に失敗した値などを「一致」と誤判定しないよう、形式も確かめて比べる */
    fun sameMd5(a: String?, b: String?): Boolean =
        a != null && b != null && MD5_FORMAT.matches(a) && MD5_FORMAT.matches(b) && a == b
}
