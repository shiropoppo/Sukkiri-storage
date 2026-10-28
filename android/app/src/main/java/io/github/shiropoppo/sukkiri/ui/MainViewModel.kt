package io.github.shiropoppo.sukkiri.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import io.github.shiropoppo.sukkiri.data.DriveClient
import io.github.shiropoppo.sukkiri.data.GoogleAuth
import io.github.shiropoppo.sukkiri.data.LoginRequiredException
import io.github.shiropoppo.sukkiri.data.Progress
import io.github.shiropoppo.sukkiri.data.Quota
import io.github.shiropoppo.sukkiri.data.Report
import io.github.shiropoppo.sukkiri.data.Store
import io.github.shiropoppo.sukkiri.work.Cleaner
import io.github.shiropoppo.sukkiri.work.OrganizeWorker
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** スマホから消す作業の状態 */
sealed interface CleanState {
    data object Confirm : CleanState
    data class Verifying(val done: Int, val total: Int) : CleanState
    data class Done(val count: Int, val bytes: Long, val skipped: Int) : CleanState
    data class Failed(val message: String) : CleanState
}

data class UiState(
    val email: String? = null,
    val quota: Quota? = null,
    val needsLogin: Boolean = true,
    val hasMedia: Boolean = false,
    val partialMedia: Boolean = false,
    val report: Report? = null,
    val running: Boolean = false,
    val progress: Progress? = null,
    val lastError: String? = null,
    val autoNightly: Boolean = true,
    val cloudDedup: Boolean = true,
    val clean: CleanState? = null,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val store = Store(app)
    private val drive = DriveClient { GoogleAuth.silentToken(app) ?: throw LoginRequiredException() }
    private val _state = MutableStateFlow(
        UiState(
            email = store.connectedEmail,
            needsLogin = store.connectedEmail == null,
            report = store.loadReport(),
            autoNightly = store.autoNightly,
            cloudDedup = store.cloudDedup,
        ),
    )
    val state: StateFlow<UiState> = _state

    /** 削除の最終確認に通ったもの（Android のゴミ箱へ移す対象） */
    var pendingTrash: List<Uri> = emptyList()
        private set
    private var pendingBytes = 0L
    private var pendingSkipped = 0

    init {
        viewModelScope.launch {
            WorkManager.getInstance(app).getWorkInfosForUniqueWorkFlow(OrganizeWorker.NOW).collect { infos ->
                val info = infos.lastOrNull() ?: return@collect
                when (info.state) {
                    WorkInfo.State.RUNNING, WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> {
                        val p = info.progress
                        val phase = p.getInt(OrganizeWorker.KEY_PHASE, 0)
                        _state.update {
                            it.copy(
                                running = true,
                                lastError = null,
                                progress = if (phase == 0) it.progress else Progress(
                                    phase, p.getString(OrganizeWorker.KEY_LABEL).orEmpty(),
                                    p.getLong(OrganizeWorker.KEY_DONE, 0), p.getLong(OrganizeWorker.KEY_TOTAL, 0),
                                    p.getString(OrganizeWorker.KEY_DETAIL).orEmpty(),
                                ),
                            )
                        }
                    }
                    WorkInfo.State.SUCCEEDED -> {
                        _state.update { it.copy(running = false, progress = null, report = store.loadReport()) }
                        refreshAccount()
                    }
                    WorkInfo.State.FAILED -> {
                        val err = info.outputData.getString(OrganizeWorker.KEY_ERROR)
                        _state.update {
                            it.copy(
                                running = false, progress = null,
                                needsLogin = it.needsLogin || err == "login",
                                lastError = if (err == "login") "もう一度 Google につないでください。" else "途中で止まりました（$err）。もう一度お試しください。",
                            )
                        }
                    }
                    WorkInfo.State.CANCELLED -> _state.update { it.copy(running = false, progress = null) }
                }
            }
        }
        if (!_state.value.needsLogin) refreshAccount()
    }

    fun setMediaPermission(granted: Boolean, partial: Boolean) =
        _state.update { it.copy(hasMedia = granted, partialMedia = partial) }

    fun refreshAccount() {
        viewModelScope.launch {
            try {
                val q = drive.about()
                store.connectedEmail = q.email
                _state.update { it.copy(email = q.email, quota = q, needsLogin = false) }
            } catch (e: LoginRequiredException) {
                _state.update { it.copy(needsLogin = true) }
            } catch (e: Exception) {
                // 通信できないときは、前回の表示のまま
            }
        }
    }

    fun onAuthorized() {
        _state.update { it.copy(needsLogin = false, lastError = null) }
        refreshAccount()
        OrganizeWorker.schedule(getApplication(), store.autoNightly)
    }

    fun onAuthFailed(message: String) = _state.update { it.copy(lastError = message) }

    fun runNow() {
        _state.update { it.copy(running = true, progress = Progress(1, Progress.PHASES[0]), lastError = null) }
        OrganizeWorker.runNow(getApplication())
    }

    fun stop() = OrganizeWorker.cancel(getApplication())

    fun setAutoNightly(on: Boolean) {
        store.autoNightly = on
        _state.update { it.copy(autoNightly = on) }
        OrganizeWorker.schedule(getApplication(), on)
    }

    fun setCloudDedup(on: Boolean) {
        store.cloudDedup = on
        _state.update { it.copy(cloudDedup = on) }
    }

    // ---- スマホから消す ----
    fun askClean() = _state.update { it.copy(clean = CleanState.Confirm) }

    fun dismissClean() = _state.update { it.copy(clean = null) }

    /** 最終確認をしてから、onReady で Android の「ゴミ箱へ移す」画面を出す */
    fun verifyForClean(onReady: (List<Uri>) -> Unit) {
        val report = _state.value.report ?: return
        viewModelScope.launch {
            _state.update { it.copy(clean = CleanState.Verifying(0, report.safe.size)) }
            try {
                val checked = Cleaner(getApplication(), drive).verify(report) { done, total ->
                    _state.update { it.copy(clean = CleanState.Verifying(done, total)) }
                }
                pendingTrash = checked.uris
                pendingBytes = checked.items.sumOf { it.size }
                pendingSkipped = checked.skipped
                if (checked.uris.isEmpty()) {
                    _state.update { it.copy(clean = CleanState.Done(0, 0, checked.skipped)) }
                } else {
                    onReady(checked.uris)
                }
            } catch (e: LoginRequiredException) {
                _state.update { it.copy(clean = null, needsLogin = true) }
            } catch (e: Exception) {
                _state.update { it.copy(clean = CleanState.Failed(e.message ?: "うまくいきませんでした")) }
            }
        }
    }

    fun onTrashResult(ok: Boolean) {
        if (!ok) {
            _state.update { it.copy(clean = null) }
            return
        }
        val removed = pendingTrash.map { it.toString() }.toHashSet()
        val report = _state.value.report
        if (report != null) {
            val next = report.copy(safe = report.safe.filter { it.uri.toString() !in removed })
            store.saveReport(next)
            _state.update { it.copy(report = next) }
        }
        _state.update { it.copy(clean = CleanState.Done(pendingTrash.size, pendingBytes, pendingSkipped)) }
        pendingTrash = emptyList()
    }
}
