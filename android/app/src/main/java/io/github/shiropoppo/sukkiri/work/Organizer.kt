package io.github.shiropoppo.sukkiri.work

import android.content.Context
import android.os.Build
import io.github.shiropoppo.sukkiri.data.CloudFile
import io.github.shiropoppo.sukkiri.data.DriveClient
import io.github.shiropoppo.sukkiri.data.DriveException
import io.github.shiropoppo.sukkiri.data.Hashing
import io.github.shiropoppo.sukkiri.data.LocalMedia
import io.github.shiropoppo.sukkiri.data.MediaScanner
import io.github.shiropoppo.sukkiri.data.Progress
import io.github.shiropoppo.sukkiri.data.Report
import io.github.shiropoppo.sukkiri.data.SafeItem
import io.github.shiropoppo.sukkiri.data.Store
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.time.LocalDate
import kotlin.coroutines.coroutineContext

/**
 * おまかせ整理の本体。
 *  1. クラウド（Google ドライブ）の一覧を読む
 *  2. スマホの写真・動画を全部数える（1枚ずつ選ぶ必要はない）
 *  3. 大きさが同じものだけ中身の指紋（MD5）を計算し、クラウドと照らし合わせる
 *  4. まだクラウドにないものを保存する（空き容量の範囲で、保存後に中身が同じか確かめる）
 *  5. クラウドの中の重複（大きさ・MD5・SHA-256 がすべて同じ写真・動画）を1つ残してゴミ箱へ
 * スマホからの削除はここでは行わない（利用者が画面で1回確かめてから Cleaner が行う）。
 */
class Organizer(
    private val context: Context,
    private val drive: DriveClient,
    private val store: Store,
) {
    data class Options(val upload: Boolean = true, val cloudDedup: Boolean = true)

    private companion object {
        const val QUOTA_MARGIN = 300L * 1024 * 1024
    }

    suspend fun run(options: Options, progress: suspend (Progress) -> Unit): Report = withContext(Dispatchers.IO) {
        // 1. クラウドの一覧
        progress(Progress(1, Progress.PHASES[0]))
        val cloud = drive.listAll { n -> }.toMutableList()
        val cloudBySize = cloud.groupBy { it.size }

        // 2. スマホの写真・動画
        progress(Progress(2, Progress.PHASES[1]))
        val local = MediaScanner.scan(context)
        val localSizeCount = local.groupingBy { it.size }.eachCount()

        // 3. 照らし合わせ（大きさが同じものがクラウドか手元にあるものだけ、中身を計算する）
        val need = local.filter { cloudBySize.containsKey(it.size) || (localSizeCount[it.size] ?: 0) > 1 }
        val totalBytes = need.sumOf { it.size }
        var doneBytes = 0L
        val md5Of = HashMap<Long, String>()
        var readErrors = 0
        for ((i, m) in need.withIndex()) {
            coroutineContext.ensureActive()
            val label = "${i + 1} / ${need.size}件"
            val cached = store.cachedMd5(m)
            if (cached != null) {
                md5Of[m.id] = cached
                doneBytes += m.size
            } else {
                try {
                    val r = context.contentResolver.openInputStream(m.uri)?.use { input ->
                        Hashing.md5(input) { n -> doneBytes += n }
                    }
                    if (r != null && r.bytes == m.size) {
                        md5Of[m.id] = r.md5
                        store.rememberMd5(m, r.md5)
                    } else {
                        readErrors++
                    }
                } catch (e: Exception) {
                    readErrors++
                }
            }
            if (i % 5 == 0) progress(Progress(3, Progress.PHASES[2], doneBytes, totalBytes, label))
        }

        // 照合: 大きさと MD5 が同じで、自分のマイドライブにあるものだけを「保存ずみ」とする
        val cloudByKey = HashMap<String, CloudFile>()
        for (f in cloud) if (f.eligible && f.md5 != null) cloudByKey.putIfAbsent("${f.size}|${f.md5}", f)
        val safe = ArrayList<SafeItem>()
        val missing = ArrayList<LocalMedia>()
        for (m in local) {
            val md5 = md5Of[m.id]
            val hit = md5?.let { cloudByKey["${m.size}|$it"] }
            if (hit != null && Hashing.sameMd5(md5, hit.md5)) safe += SafeItem(m.id, m.uri, m.name, m.size, m.modifiedSec, md5, hit.id)
            else missing += m
        }

        // 4. まだクラウドにないものを保存（中身が同じものは1つだけ送る。新しいものから、空き容量の範囲で）
        var uploadedCount = 0
        var uploadedBytes = 0L
        var uploadFailed = 0
        var skippedForQuota = 0
        if (options.upload && missing.isNotEmpty()) {
            val uploadedByMd5 = HashMap<String, String>()
            val queue = missing.sortedByDescending { it.modifiedSec }
            var free = drive.about().free
            val folderId = drive.ensureFolder("${LocalDate.now()} ${Build.MANUFACTURER} ${Build.MODEL}")
            val total = queue.sumOf { it.size }
            var sent = 0L
            for ((i, m) in queue.withIndex()) {
                coroutineContext.ensureActive()
                val known = md5Of[m.id]
                val twin = known?.let { uploadedByMd5[it] }
                if (twin != null) {
                    // 中身が同じものをさっき保存したので、それと照合できる
                    safe += SafeItem(m.id, m.uri, m.name, m.size, m.modifiedSec, known, twin)
                    continue
                }
                if (free != null && free - m.size < QUOTA_MARGIN) {
                    skippedForQuota++
                    continue
                }
                progress(Progress(4, Progress.PHASES[3], sent, total, "${i + 1} / ${queue.size}件  ${m.name}"))
                try {
                    val up = drive.upload(context.contentResolver, m, folderId) { n -> sent += n }
                    if (up.verified) {
                        uploadedCount++
                        uploadedBytes += m.size
                        free = free?.minus(m.size)
                        uploadedByMd5[up.md5] = up.id
                        store.rememberMd5(m, up.md5)
                        safe += SafeItem(m.id, m.uri, m.name, m.size, m.modifiedSec, up.md5, up.id)
                    } else {
                        uploadFailed++
                    }
                } catch (e: DriveException) {
                    uploadFailed++
                    if (e.quotaExceeded) {
                        skippedForQuota += queue.size - i - 1
                        break
                    }
                } catch (e: Exception) {
                    uploadFailed++
                }
            }
        }

        // 5. クラウドの中の重複を整理（写真・動画だけ。大きさ・MD5・SHA-256 がすべて同じものを1つ残す）
        var dupTrashed = 0
        var dupBytes = 0L
        if (options.cloudDedup) {
            val groups = cloud
                .filter { it.eligible && it.isMedia && it.md5 != null && it.sha256 != null }
                .groupBy { Triple(it.size, it.md5, it.sha256) }
                .values.filter { it.size > 1 }
            val replaced = HashMap<String, String>()
            for ((gi, g) in groups.withIndex()) {
                coroutineContext.ensureActive()
                progress(Progress(5, Progress.PHASES[4], gi.toLong(), groups.size.toLong(), "${gi + 1} / ${groups.size}組"))
                // 自分で整理した場所にあるもの（保存先フォルダ以外）・古いものを優先して残す
                val keeper = g.sortedWith(compareBy<CloudFile>({ it.inBackupFolder }, { it.createdTime })).first()
                for (f in g) {
                    if (f === keeper) continue
                    try {
                        val now = drive.meta(f.id) ?: continue
                        val same = !now.optBoolean("trashed") &&
                            now.optString("size").toLongOrNull() == keeper.size &&
                            Hashing.sameMd5(now.optString("md5Checksum"), keeper.md5) &&
                            now.optString("sha256Checksum") == keeper.sha256
                        if (!same) continue
                        drive.trash(f.id)
                        dupTrashed++
                        dupBytes += f.size
                        replaced[f.id] = keeper.id
                    } catch (e: Exception) {
                        // 1つうまくいかなくても、残りは続ける（消さずに残すだけ）
                    }
                }
            }
            // ゴミ箱へ移したファイルと照合していたものは、残した方に付け替える
            if (replaced.isNotEmpty()) {
                for (i in safe.indices) replaced[safe[i].cloudId]?.let { safe[i] = safe[i].copy(cloudId = it) }
            }
        }

        val safeIds = safe.map { it.mediaId }.toHashSet()
        val stillMissing = local.filter { it.id !in safeIds }
        val report = Report(
            finishedAt = System.currentTimeMillis(),
            localCount = local.size,
            localBytes = local.sumOf { it.size },
            safe = safe,
            missingCount = stillMissing.size,
            missingBytes = stillMissing.sumOf { it.size },
            uploadedCount = uploadedCount,
            uploadedBytes = uploadedBytes,
            uploadFailed = uploadFailed,
            uploadSkippedForQuota = skippedForQuota,
            cloudDupTrashed = dupTrashed,
            cloudDupBytes = dupBytes,
            readErrors = readErrors,
        )
        store.saveReport(report)
        report
    }
}
