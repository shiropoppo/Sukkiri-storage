package io.github.shiropoppo.sukkiri.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.io.File

/** 設定・前回の結果・しらべた指紋の記憶（すべてスマホの中だけに保存） */
class Store(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val reportFile = File(app.filesDir, "last_report.json")
    private val hashes = HashDb(app)

    var autoNightly: Boolean
        get() = prefs.getBoolean("autoNightly", true)
        set(v) = prefs.edit().putBoolean("autoNightly", v).apply()

    var cloudDedup: Boolean
        get() = prefs.getBoolean("cloudDedup", true)
        set(v) = prefs.edit().putBoolean("cloudDedup", v).apply()

    var connectedEmail: String?
        get() = prefs.getString("email", null)
        set(v) = prefs.edit().putString("email", v).apply()

    fun saveReport(r: Report) = reportFile.writeText(r.toJson().toString())

    fun loadReport(): Report? = try {
        if (reportFile.exists()) Report.fromJson(JSONObject(reportFile.readText())) else null
    } catch (e: Exception) {
        null
    }

    fun cachedMd5(m: LocalMedia): String? = hashes.get(m.cacheKey)
    fun rememberMd5(m: LocalMedia, md5: String) = hashes.put(m.cacheKey, md5)

    /** しらべた指紋を覚えておく小さなデータベース（場所・大きさ・更新日時が同じときだけ使う） */
    private class HashDb(context: Context) : SQLiteOpenHelper(context, "hashes.db", null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE hashes (k TEXT PRIMARY KEY, md5 TEXT NOT NULL)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

        fun get(key: String): String? = readableDatabase.rawQuery("SELECT md5 FROM hashes WHERE k = ?", arrayOf(key)).use {
            if (it.moveToFirst()) it.getString(0) else null
        }

        fun put(key: String, md5: String) {
            writableDatabase.insertWithOnConflict("hashes", null, ContentValues().apply {
                put("k", key)
                put("md5", md5)
            }, SQLiteDatabase.CONFLICT_REPLACE)
        }
    }
}
