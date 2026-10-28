package io.github.shiropoppo.sukkiri

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.auth.api.identity.Identity
import io.github.shiropoppo.sukkiri.data.GoogleAuth
import io.github.shiropoppo.sukkiri.ui.Actions
import io.github.shiropoppo.sukkiri.ui.App
import io.github.shiropoppo.sukkiri.ui.Env
import io.github.shiropoppo.sukkiri.ui.MainViewModel
import io.github.shiropoppo.sukkiri.ui.SukkiriTheme
import io.github.shiropoppo.sukkiri.work.Notifier
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity(), Actions {

    private val vm: MainViewModel by viewModels()
    private var manageMediaGranted by mutableStateOf(false)

    // Google の許可画面（初回だけ）から戻ってきたとき
    private val authLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        try {
            val r = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(result.data)
            if (r.accessToken != null) vm.onAuthorized() else vm.onAuthFailed("ログインが最後まで終わりませんでした。もう一度お試しください。")
        } catch (e: Exception) {
            vm.onAuthFailed("ログインが最後まで終わりませんでした。もう一度お試しください。")
        }
    }

    private val mediaLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        updateMediaPermission()
    }

    // Android の「ゴミ箱へ移す」確認から戻ってきたとき
    private val trashLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        vm.onTrashResult(result.resultCode == Activity.RESULT_OK)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Notifier.ensureChannels(this)
        updateMediaPermission()
        setContent {
            SukkiriTheme {
                val state by vm.state.collectAsStateWithLifecycle()
                App(
                    state = state,
                    env = Env(
                        canTrash = Build.VERSION.SDK_INT >= 30,
                        canManageMediaSetting = Build.VERSION.SDK_INT >= 31,
                        manageMediaGranted = manageMediaGranted,
                    ),
                    actions = this,
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        updateMediaPermission()
        manageMediaGranted = Build.VERSION.SDK_INT >= 31 && MediaStore.canManageMedia(this)
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun updateMediaPermission() {
        val full = if (Build.VERSION.SDK_INT >= 33) {
            granted(Manifest.permission.READ_MEDIA_IMAGES) && granted(Manifest.permission.READ_MEDIA_VIDEO)
        } else {
            granted(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        val partial = !full && Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        vm.setMediaPermission(full || partial, partial)
    }

    // ---- Actions ----
    override fun connect() {
        lifecycleScope.launch {
            try {
                val r = GoogleAuth.authorize(this@MainActivity)
                val pi = r.pendingIntent
                if (r.hasResolution() && pi != null) {
                    authLauncher.launch(IntentSenderRequest.Builder(pi.intentSender).build())
                } else {
                    vm.onAuthorized()
                }
            } catch (e: Exception) {
                vm.onAuthFailed("Google につなげませんでした。インターネットにつながっているか確かめて、もう一度お試しください。")
            }
        }
    }

    override fun requestMedia() {
        val perms = buildList {
            if (Build.VERSION.SDK_INT >= 33) {
                add(Manifest.permission.READ_MEDIA_IMAGES)
                add(Manifest.permission.READ_MEDIA_VIDEO)
                add(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                add(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
        }
        mediaLauncher.launch(perms.toTypedArray())
    }

    override fun openAppSettings() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
    }

    override fun runNow() = vm.runNow()
    override fun stop() = vm.stop()
    override fun setAutoNightly(on: Boolean) = vm.setAutoNightly(on)
    override fun setCloudDedup(on: Boolean) = vm.setCloudDedup(on)
    override fun askClean() = vm.askClean()
    override fun dismissClean() = vm.dismissClean()

    override fun confirmClean() {
        if (Build.VERSION.SDK_INT < 30) return
        vm.verifyForClean { uris ->
            // Android の「ゴミ箱へ移す」（30日間は元に戻せる）。メディア管理を許可していれば確認画面は出ない
            if (Build.VERSION.SDK_INT >= 30) {
                val pi = MediaStore.createTrashRequest(contentResolver, uris, true)
                trashLauncher.launch(IntentSenderRequest.Builder(pi.intentSender).build())
            }
        }
    }

    override fun openGooglePhotos() {
        val pkg = "com.google.android.apps.photos"
        val launch = packageManager.getLaunchIntentForPackage(pkg)
        startActivity(launch ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg")))
    }

    override fun requestManageMedia() {
        if (Build.VERSION.SDK_INT >= 31) {
            startActivity(Intent(Settings.ACTION_REQUEST_MANAGE_MEDIA, Uri.parse("package:$packageName")))
        }
    }

    override fun isCharging(): Boolean = getSystemService(BatteryManager::class.java)?.isCharging ?: true
}
