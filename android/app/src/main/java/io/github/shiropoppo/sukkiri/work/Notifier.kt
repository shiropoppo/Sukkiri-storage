package io.github.shiropoppo.sukkiri.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.shiropoppo.sukkiri.MainActivity
import io.github.shiropoppo.sukkiri.R
import io.github.shiropoppo.sukkiri.ui.formatBytes

/** 通知（作業中の表示、「〇〇 GB 空けられます」、ログインのお願い） */
object Notifier {
    const val PROGRESS_ID = 1
    private const val RESULT_ID = 2
    private const val CH_PROGRESS = "progress"
    private const val CH_RESULT = "result"

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_PROGRESS, "整理の進み具合", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CH_RESULT, "整理の結果", NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun progress(context: Context, text: String, fraction: Float?) = NotificationCompat.Builder(context, CH_PROGRESS)
        .setSmallIcon(R.drawable.ic_launcher_foreground)
        .setContentTitle("写真・動画を整理しています")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(openApp(context))
        .apply { if (fraction != null) setProgress(1000, (fraction * 1000).toInt(), false) else setProgress(0, 0, true) }
        .build()

    private fun post(context: Context, title: String, text: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        NotificationManagerCompat.from(context).notify(
            RESULT_ID,
            NotificationCompat.Builder(context, CH_RESULT)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(openApp(context))
                .build(),
        )
    }

    fun readyToClean(context: Context, bytes: Long, count: Int) = post(
        context,
        "${formatBytes(bytes)} 空けられます",
        "クラウドに保存ずみの写真・動画が ${count}件あります。タップして、スマホから消すか確かめてください。",
    )

    fun needLogin(context: Context) = post(
        context,
        "もう一度ログインが必要です",
        "自動の整理を続けるため、アプリを開いて Google にもう一度つないでください。",
    )
}
