package io.github.shiropoppo.sukkiri.work

import android.content.Context
import android.net.Uri
import io.github.shiropoppo.sukkiri.data.DriveClient
import io.github.shiropoppo.sukkiri.data.Hashing
import io.github.shiropoppo.sukkiri.data.MediaScanner
import io.github.shiropoppo.sukkiri.data.Report
import io.github.shiropoppo.sukkiri.data.SafeItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext

/**
 * スマホから消す前の最終確認。1つでも合わなければ、そのファイルは消さない。
 *  ・スマホのファイルが書きかえられていない（大きさ・更新日時が同じ）
 *  ・クラウドのファイルがまだあり、ゴミ箱にも入っていない（大きさ・MD5 が同じ）
 *  ・スマホのファイルの中身をもう一度計算して、MD5 が同じ
 * 実際の削除は、Android の「ゴミ箱へ移す」で行う（30日間は元に戻せる）。
 */
class Cleaner(private val context: Context, private val drive: DriveClient) {

    class Checked(val uris: List<Uri>, val items: List<SafeItem>, val skipped: Int)

    suspend fun verify(report: Report, onProgress: suspend (Int, Int) -> Unit): Checked = withContext(Dispatchers.IO) {
        val ok = ArrayList<SafeItem>()
        var skipped = 0
        for ((i, item) in report.safe.withIndex()) {
            coroutineContext.ensureActive()
            onProgress(i + 1, report.safe.size)
            if (verifyOne(item)) ok += item else skipped++
        }
        Checked(ok.map { it.uri }, ok, skipped)
    }

    private suspend fun verifyOne(item: SafeItem): Boolean {
        val stat = MediaScanner.stat(context, item.uri) ?: return false
        if (stat.first != item.size || stat.second != item.modifiedSec) return false
        val meta = try { drive.meta(item.cloudId) } catch (e: Exception) { null } ?: return false
        if (meta.optBoolean("trashed")) return false
        if (meta.optString("size").toLongOrNull() != item.size) return false
        if (!Hashing.sameMd5(meta.optString("md5Checksum"), item.md5)) return false
        val again = try {
            context.contentResolver.openInputStream(item.uri)?.use { Hashing.md5(it) }
        } catch (e: Exception) {
            null
        } ?: return false
        return again.bytes == item.size && Hashing.sameMd5(again.md5, item.md5)
    }
}
