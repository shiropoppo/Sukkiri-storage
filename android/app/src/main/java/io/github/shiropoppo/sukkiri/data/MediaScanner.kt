package io.github.shiropoppo.sukkiri.data

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore

/** スマホの写真・動画を、1枚ずつ選んでもらわずに全部まとめて読む（MediaStore） */
object MediaScanner {

    private fun collections(): List<Pair<Uri, Boolean>> = if (Build.VERSION.SDK_INT >= 29) {
        listOf(
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) to false,
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) to true,
        )
    } else {
        listOf(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI to false,
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI to true,
        )
    }

    fun scan(context: Context): List<LocalMedia> {
        val out = mutableListOf<LocalMedia>()
        val folderColumn = if (Build.VERSION.SDK_INT >= 29) MediaStore.MediaColumns.RELATIVE_PATH else MediaStore.MediaColumns.DATA
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.MIME_TYPE,
            folderColumn,
        )
        for ((collection, isVideo) in collections()) {
            context.contentResolver.query(collection, projection, "${MediaStore.MediaColumns.SIZE} > 0", null, null)?.use { c ->
                val idCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val sizeCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                val modCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
                val mimeCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
                val folderCol = c.getColumnIndexOrThrow(folderColumn)
                while (c.moveToNext()) {
                    val id = c.getLong(idCol)
                    val folder = c.getString(folderCol).orEmpty().let {
                        if (Build.VERSION.SDK_INT >= 29) it else it.substringBeforeLast('/', "")
                    }
                    out += LocalMedia(
                        id = id,
                        uri = ContentUris.withAppendedId(collection, id),
                        name = c.getString(nameCol) ?: "（名前なし）",
                        folder = folder,
                        size = c.getLong(sizeCol),
                        modifiedSec = c.getLong(modCol),
                        mime = c.getString(mimeCol) ?: if (isVideo) "video/*" else "image/*",
                        isVideo = isVideo,
                    )
                }
            }
        }
        return out
    }

    /** 削除の直前に、書きかえられていないかを確かめるための最新の大きさ・更新日時 */
    fun stat(context: Context, uri: Uri): Pair<Long, Long>? {
        val projection = arrayOf(MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED)
        return try {
            context.contentResolver.query(uri, projection, null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getLong(0) to c.getLong(1) else null
            }
        } catch (e: Exception) {
            null
        }
    }
}
