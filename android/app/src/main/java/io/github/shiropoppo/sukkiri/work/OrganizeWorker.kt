package io.github.shiropoppo.sukkiri.work

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import io.github.shiropoppo.sukkiri.data.DriveClient
import io.github.shiropoppo.sukkiri.data.GoogleAuth
import io.github.shiropoppo.sukkiri.data.LoginRequiredException
import io.github.shiropoppo.sukkiri.data.Progress
import io.github.shiropoppo.sukkiri.data.Store
import java.util.concurrent.TimeUnit

/**
 * おまかせ整理を裏で動かす。
 *  ・「いますぐ整理」：画面から。アプリを閉じても最後まで続く
 *  ・毎晩の自動整理：充電中・Wi-Fi・電池が少なくないときだけ動く
 */
class OrganizeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    companion object {
        const val NOW = "organize-now"
        private const val NIGHTLY = "organize-nightly"
        private const val KEY_MANUAL = "manual"
        const val KEY_PHASE = "phase"
        const val KEY_LABEL = "label"
        const val KEY_DONE = "done"
        const val KEY_TOTAL = "total"
        const val KEY_DETAIL = "detail"
        const val KEY_ERROR = "error"

        fun runNow(context: Context) {
            val req = OneTimeWorkRequestBuilder<OrganizeWorker>()
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setInputData(workDataOf(KEY_MANUAL to true))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, req)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NOW)
        }

        fun schedule(context: Context, enabled: Boolean) {
            val wm = WorkManager.getInstance(context)
            if (!enabled) {
                wm.cancelUniqueWork(NIGHTLY)
                return
            }
            val constraints = Constraints.Builder()
                .setRequiresCharging(true)
                .setRequiredNetworkType(NetworkType.UNMETERED)
                .setRequiresBatteryNotLow(true)
                .build()
            val req = PeriodicWorkRequestBuilder<OrganizeWorker>(1, TimeUnit.DAYS)
                .setConstraints(constraints)
                .build()
            wm.enqueueUniquePeriodicWork(NIGHTLY, ExistingPeriodicWorkPolicy.UPDATE, req)
        }
    }

    private fun foregroundInfo(text: String, fraction: Float?): ForegroundInfo {
        val n = Notifier.progress(applicationContext, text, fraction)
        return if (Build.VERSION.SDK_INT >= 29) {
            ForegroundInfo(Notifier.PROGRESS_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(Notifier.PROGRESS_ID, n)
        }
    }

    override suspend fun getForegroundInfo(): ForegroundInfo = foregroundInfo("準備しています…", null)

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        Notifier.ensureChannels(ctx)
        try {
            setForeground(foregroundInfo("準備しています…", null))
        } catch (e: Exception) {
            // 画面の外から始められない状況でも、作業そのものは続ける
        }
        val store = Store(ctx)
        val drive = DriveClient { GoogleAuth.silentToken(ctx) ?: throw LoginRequiredException() }
        return try {
            var last = 0L
            val report = Organizer(ctx, drive, store).run(Organizer.Options(cloudDedup = store.cloudDedup)) { p ->
                val now = System.currentTimeMillis()
                if (now - last > 400 || p.done == 0L) {
                    last = now
                    setProgress(p.toData())
                    try { setForeground(foregroundInfo("${p.label}  ${p.detail}", p.fraction)) } catch (e: Exception) { }
                }
            }
            if (!inputData.getBoolean(KEY_MANUAL, false) && report.safe.isNotEmpty()) {
                Notifier.readyToClean(ctx, report.safeBytes, report.safe.size)
            }
            Result.success()
        } catch (e: LoginRequiredException) {
            Notifier.needLogin(ctx)
            Result.failure(workDataOf(KEY_ERROR to "login"))
        } catch (e: Exception) {
            if (runAttemptCount < 2 && !inputData.getBoolean(KEY_MANUAL, false)) Result.retry()
            else Result.failure(workDataOf(KEY_ERROR to (e.message ?: "error")))
        }
    }

    private fun Progress.toData(): Data = workDataOf(
        KEY_PHASE to phase, KEY_LABEL to label, KEY_DONE to done, KEY_TOTAL to total, KEY_DETAIL to detail,
    )
}
