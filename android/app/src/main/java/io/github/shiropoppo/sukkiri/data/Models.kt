package io.github.shiropoppo.sukkiri.data

import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

/** スマホの中の写真・動画 1つ */
data class LocalMedia(
    val id: Long,
    val uri: Uri,
    val name: String,
    val folder: String,
    val size: Long,
    val modifiedSec: Long,
    val mime: String,
    val isVideo: Boolean,
) {
    /** 「同じファイルで、書きかえられていない」ことを表す鍵（指紋を覚えておくのに使う） */
    val cacheKey: String get() = "$id|$size|$modifiedSec"
}

/** Google ドライブ上のファイル 1つ */
data class CloudFile(
    val id: String,
    val name: String,
    val size: Long,
    val md5: String?,
    val sha256: String?,
    val mime: String,
    val path: String,
    val createdTime: String,
    /** マイドライブの中にあり、自分が持ち主のもの（照合や削除の根拠にしてよいもの） */
    val eligible: Boolean,
    /** このアプリが作った保存先フォルダの中にあるか */
    val inBackupFolder: Boolean,
) {
    val isMedia: Boolean get() = mime.startsWith("image/") || mime.startsWith("video/")
}

data class Quota(val email: String, val total: Long?, val used: Long) {
    val free: Long? get() = total?.let { (it - used).coerceAtLeast(0) }
}

/** クラウドに中身がまったく同じものがある、スマホの写真・動画（削除してよい候補） */
data class SafeItem(
    val mediaId: Long,
    val uri: Uri,
    val name: String,
    val size: Long,
    val modifiedSec: Long,
    val md5: String,
    val cloudId: String,
) {
    fun toJson() = JSONObject()
        .put("mediaId", mediaId).put("uri", uri.toString()).put("name", name).put("size", size)
        .put("modifiedSec", modifiedSec).put("md5", md5).put("cloudId", cloudId)

    companion object {
        fun fromJson(o: JSONObject) = SafeItem(
            o.getLong("mediaId"), Uri.parse(o.getString("uri")), o.getString("name"), o.getLong("size"),
            o.getLong("modifiedSec"), o.getString("md5"), o.getString("cloudId"),
        )
    }
}

/** 整理の結果 */
data class Report(
    val finishedAt: Long,
    val localCount: Int,
    val localBytes: Long,
    val safe: List<SafeItem>,
    val missingCount: Int,
    val missingBytes: Long,
    val uploadedCount: Int,
    val uploadedBytes: Long,
    val uploadFailed: Int,
    val uploadSkippedForQuota: Int,
    val cloudDupTrashed: Int,
    val cloudDupBytes: Long,
    val readErrors: Int,
) {
    val safeBytes: Long get() = safe.sumOf { it.size }

    fun toJson(): JSONObject = JSONObject()
        .put("finishedAt", finishedAt).put("localCount", localCount).put("localBytes", localBytes)
        .put("safe", JSONArray().apply { safe.forEach { put(it.toJson()) } })
        .put("missingCount", missingCount).put("missingBytes", missingBytes)
        .put("uploadedCount", uploadedCount).put("uploadedBytes", uploadedBytes)
        .put("uploadFailed", uploadFailed).put("uploadSkippedForQuota", uploadSkippedForQuota)
        .put("cloudDupTrashed", cloudDupTrashed).put("cloudDupBytes", cloudDupBytes)
        .put("readErrors", readErrors)

    companion object {
        fun fromJson(o: JSONObject): Report {
            val arr = o.getJSONArray("safe")
            return Report(
                o.getLong("finishedAt"), o.getInt("localCount"), o.getLong("localBytes"),
                (0 until arr.length()).map { SafeItem.fromJson(arr.getJSONObject(it)) },
                o.getInt("missingCount"), o.getLong("missingBytes"),
                o.getInt("uploadedCount"), o.getLong("uploadedBytes"),
                o.getInt("uploadFailed"), o.getInt("uploadSkippedForQuota"),
                o.getInt("cloudDupTrashed"), o.getLong("cloudDupBytes"),
                o.getInt("readErrors"),
            )
        }
    }
}

/** 進み具合（画面と通知に出す） */
data class Progress(
    val phase: Int,
    val label: String,
    val done: Long = 0,
    val total: Long = 0,
    val detail: String = "",
) {
    val fraction: Float? get() = if (total > 0) (done.toFloat() / total).coerceIn(0f, 1f) else null

    companion object {
        val PHASES = listOf(
            "クラウドの一覧を読み込む",
            "スマホの写真・動画を数える",
            "中身を1つずつ照らし合わせる",
            "まだのものをクラウドに保存する",
            "クラウドの重複を整理する",
        )
    }
}
