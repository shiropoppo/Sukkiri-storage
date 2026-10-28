package io.github.shiropoppo.sukkiri.data

import android.content.ContentResolver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import io.github.shiropoppo.sukkiri.data.Hashing.toHex

class DriveException(val code: Int, body: String) : Exception("Google ドライブとの通信でエラーが起きました（$code）") {
    val quotaExceeded = code == 403 && Regex("storageQuotaExceeded|quotaLimitReached|insufficientStorage").containsMatchIn(body)
}

/** Google ドライブとのやりとり（一覧・保存・ゴミ箱へ移す） */
class DriveClient(private val tokenProvider: suspend () -> String) {

    companion object {
        const val BACKUP_FOLDER = "容量すっきり_バックアップ"
        private const val API = "https://www.googleapis.com/drive/v3"
        private const val UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
        private const val FOLDER = "application/vnd.google-apps.folder"
        private const val CHUNK = 8 * 1024 * 1024 // 256KiB の倍数
        private val JSON = "application/json; charset=UTF-8".toMediaType()
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .followRedirects(false) // 保存の途中経過（308）をそのまま受け取る
        .build()

    @Volatile private var token: String? = null

    private fun backoff(attempt: Int) = minOf(30_000L, 1000L shl attempt)

    /** 通行証を付けて送る。期限切れ（401）は1回だけ取り直し、混雑（429・5xx）や通信の途切れは待ってやり直す */
    private suspend fun execute(build: (Request.Builder) -> Request.Builder): Response {
        var attempt = 0
        var refreshed = false
        while (true) {
            val t = token ?: tokenProvider().also { token = it }
            val req = build(Request.Builder()).header("Authorization", "Bearer $t").build()
            val res = try {
                withContext(Dispatchers.IO) { http.newCall(req).execute() }
            } catch (e: IOException) {
                if (attempt >= 4) throw e
                delay(backoff(attempt++))
                continue
            }
            when {
                res.code == 401 && !refreshed -> { res.close(); token = null; refreshed = true }
                (res.code == 429 || res.code >= 500) && attempt < 5 -> { res.close(); delay(backoff(attempt++)) }
                else -> return res
            }
        }
    }

    private suspend fun json(build: (Request.Builder) -> Request.Builder): JSONObject =
        execute(build).use { res ->
            val body = withContext(Dispatchers.IO) { res.body?.string().orEmpty() }
            if (!res.isSuccessful) throw DriveException(res.code, body)
            JSONObject(body)
        }

    suspend fun about(): Quota {
        val o = json { it.url("$API/about?fields=user(emailAddress),storageQuota") }
        val q = o.optJSONObject("storageQuota") ?: JSONObject()
        return Quota(
            email = o.optJSONObject("user")?.optString("emailAddress").orEmpty(),
            total = q.optString("limit").toLongOrNull(),
            used = q.optString("usage").toLongOrNull() ?: 0L,
        )
    }

    /** 自分が持ち主で、ゴミ箱に入っていないファイルを全部（フォルダの場所もたどる） */
    suspend fun listAll(onProgress: (Int) -> Unit = {}): List<CloudFile> {
        val rootId = json { it.url("$API/files/root?fields=id") }.getString("id")
        data class Raw(val id: String, val name: String, val mime: String, val size: Long, val md5: String?, val sha256: String?, val parent: String?, val created: String)
        val folders = HashMap<String, Pair<String, String?>>()
        val files = ArrayList<Raw>()
        var pageToken: String? = null
        do {
            val url = "$API/files".toHttpUrl().newBuilder()
                .addQueryParameter("q", "trashed = false and 'me' in owners")
                .addQueryParameter("fields", "nextPageToken,files(id,name,mimeType,size,md5Checksum,sha256Checksum,parents,createdTime)")
                .addQueryParameter("pageSize", "1000")
                .addQueryParameter("spaces", "drive")
                .addQueryParameter("corpora", "user")
                .apply { pageToken?.let { addQueryParameter("pageToken", it) } }
                .build()
            val r = json { it.url(url) }
            val arr = r.optJSONArray("files")
            for (i in 0 until (arr?.length() ?: 0)) {
                val f = arr!!.getJSONObject(i)
                val parent = f.optJSONArray("parents")?.optString(0)
                val mime = f.optString("mimeType")
                if (mime == FOLDER) {
                    folders[f.getString("id")] = f.optString("name") to parent
                } else {
                    val size = f.optString("size").toLongOrNull() ?: 0L
                    val md5 = f.optString("md5Checksum").ifEmpty { null }
                    if (size > 0 && md5 != null) {
                        files += Raw(f.getString("id"), f.optString("name"), mime, size, md5,
                            f.optString("sha256Checksum").ifEmpty { null }, parent, f.optString("createdTime"))
                    }
                }
            }
            onProgress(files.size)
            pageToken = r.optString("nextPageToken").ifEmpty { null }
        } while (pageToken != null)

        // 親フォルダをたどって場所を作る。マイドライブの一番上に着かないもの（パソコン同期の領域など）は照合に使わない
        val memo = HashMap<String, Pair<String, Boolean>>()
        fun resolve(id: String?, depth: Int = 0): Pair<String, Boolean> {
            if (id == null) return "" to false
            if (id == rootId) return "" to true
            memo[id]?.let { return it }
            val f = folders[id]
            val out = if (f == null || depth > 200) "" to false else resolve(f.second, depth + 1).let { (p, ok) -> "$p/${f.first}" to ok }
            memo[id] = out
            return out
        }
        return files.map { f ->
            val (dir, underRoot) = resolve(f.parent)
            CloudFile(
                id = f.id, name = f.name, size = f.size, md5 = f.md5, sha256 = f.sha256, mime = f.mime,
                path = "$dir/${f.name}", createdTime = f.created, eligible = underRoot,
                inBackupFolder = dir.startsWith("/$BACKUP_FOLDER"),
            )
        }
    }

    /** 1つのファイルの最新の状態（削除の直前に、まだクラウドにあるかを確かめる） */
    suspend fun meta(fileId: String): JSONObject? = execute {
        it.url("$API/files/$fileId?fields=id,size,md5Checksum,sha256Checksum,trashed")
    }.use { res ->
        val body = withContext(Dispatchers.IO) { res.body?.string().orEmpty() }
        when {
            res.code == 404 -> null
            !res.isSuccessful -> throw DriveException(res.code, body)
            else -> JSONObject(body)
        }
    }

    /** ドライブのゴミ箱へ移す（30日間は元に戻せる） */
    suspend fun trash(fileId: String) {
        json {
            it.url("$API/files/$fileId?fields=id,trashed")
                .patch(JSONObject().put("trashed", true).toString().toRequestBody(JSON))
        }
    }

    private suspend fun findFolder(q: String): String? {
        val url = "$API/files".toHttpUrl().newBuilder()
            .addQueryParameter("q", q).addQueryParameter("fields", "files(id)")
            .addQueryParameter("spaces", "drive").addQueryParameter("pageSize", "10").build()
        val arr = json { it.url(url) }.optJSONArray("files")
        return if (arr != null && arr.length() > 0) arr.getJSONObject(0).getString("id") else null
    }

    private suspend fun createFolder(name: String, parent: String, marker: String): String {
        val body = JSONObject().put("name", name).put("mimeType", FOLDER)
            .put("parents", org.json.JSONArray().put(parent))
            .put("appProperties", JSONObject().put("sukkiriTool", marker))
        return json { it.url("$API/files?fields=id").post(body.toString().toRequestBody(JSON)) }.getString("id")
    }

    /** 保存先「容量すっきり_バックアップ / 日付 端末名」を用意する（なければ作る） */
    suspend fun ensureFolder(dayName: String): String {
        val rootId = findFolder("appProperties has { key='sukkiriTool' and value='root' } and trashed = false and mimeType = '$FOLDER'")
            ?: createFolder(BACKUP_FOLDER, "root", "root")
        val esc = dayName.replace("\\", "\\\\").replace("'", "\\'")
        return findFolder("'$rootId' in parents and name = '$esc' and trashed = false and mimeType = '$FOLDER'")
            ?: createFolder(dayName, rootId, "day")
    }

    class Uploaded(val id: String, val md5: String, val verified: Boolean)

    /** 1つ保存する。送りながら MD5 を計算し、ドライブ側の MD5 と一致したときだけ「保存できた」とする */
    suspend fun upload(resolver: ContentResolver, media: LocalMedia, folderId: String, onBytes: (Long) -> Unit): Uploaded {
        val meta = JSONObject().put("name", media.name).put("parents", org.json.JSONArray().put(folderId))
        val init = execute {
            it.url("$UPLOAD?uploadType=resumable&fields=id,size,md5Checksum")
                .header("X-Upload-Content-Type", media.mime)
                .header("X-Upload-Content-Length", media.size.toString())
                .post(meta.toString().toRequestBody(JSON))
        }
        val location = init.use { res ->
            if (!res.isSuccessful) throw DriveException(res.code, res.body?.string().orEmpty())
            res.header("Location") ?: throw IOException("保存の準備ができませんでした")
        }
        val md = MessageDigest.getInstance("MD5")
        var result: JSONObject? = null
        withContext(Dispatchers.IO) {
            val input = resolver.openInputStream(media.uri) ?: throw IOException("ファイルを開けませんでした")
            input.use { stream ->
                val buf = ByteArray(CHUNK)
                var off = 0L
                while (off < media.size) {
                    val want = minOf(CHUNK.toLong(), media.size - off).toInt()
                    val n = readFully(stream, buf, want)
                    if (n != want) throw IOException("ファイルを最後まで読めませんでした")
                    md.update(buf, 0, n)
                    val res = putChunk(location, buf, n, off, media.size)
                    if (res != null) result = res
                    off += n
                    onBytes(n.toLong())
                }
            }
        }
        val local = md.digest().toHex()
        val r = result ?: throw IOException("保存が最後まで終わりませんでした")
        val verified = r.optString("size").toLongOrNull() == media.size && Hashing.sameMd5(r.optString("md5Checksum"), local)
        return Uploaded(r.getString("id"), local, verified)
    }

    private fun readFully(input: InputStream, buf: ByteArray, want: Int): Int {
        var got = 0
        while (got < want) {
            val n = input.read(buf, got, want - got)
            if (n < 0) break
            got += n
        }
        return got
    }

    /** 区切り1つを送る。途中なら null、最後なら完成したファイルの情報を返す */
    private suspend fun putChunk(location: String, buf: ByteArray, n: Int, off: Long, total: Long): JSONObject? {
        for (attempt in 0 until 5) {
            try {
                val req = Request.Builder().url(location)
                    .header("Content-Range", "bytes $off-${off + n - 1}/$total")
                    .put(buf.toRequestBody(null, 0, n))
                    .build()
                http.newCall(req).execute().use { res ->
                    when {
                        res.code == 308 -> return null
                        res.isSuccessful -> return JSONObject(res.body?.string().orEmpty())
                        res.code == 404 || res.code == 410 -> throw IOException("保存の受付が切れました")
                        res.code < 500 && res.code != 429 -> throw DriveException(res.code, res.body?.string().orEmpty())
                        else -> Unit
                    }
                }
            } catch (e: DriveException) {
                throw e
            } catch (e: IOException) {
                if (attempt == 4) throw e
            }
            delay(backoff(attempt))
            // どこまで届いたかを確かめる。この区切りの前までしか届いていなければ送り直す
            val status = Request.Builder().url(location).header("Content-Range", "bytes */$total")
                .put(ByteArray(0).toRequestBody(null)).build()
            http.newCall(status).execute().use { res ->
                if (res.isSuccessful) return JSONObject(res.body?.string().orEmpty())
                val received = res.header("Range")?.substringAfter('-')?.toLongOrNull()?.plus(1) ?: 0L
                if (received == off + n) return null
                if (received != off) throw IOException("保存が途中で食いちがいました")
            }
        }
        throw IOException("通信が不安定なため保存できませんでした")
    }
}
