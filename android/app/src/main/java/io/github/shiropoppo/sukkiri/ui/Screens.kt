package io.github.shiropoppo.sukkiri.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.shiropoppo.sukkiri.data.Progress
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 画面から呼ぶ操作（MainActivity が実装する） */
interface Actions {
    fun connect()
    fun requestMedia()
    fun openAppSettings()
    fun runNow()
    fun stop()
    fun setAutoNightly(on: Boolean)
    fun setCloudDedup(on: Boolean)
    fun askClean()
    fun confirmClean()
    fun dismissClean()
    fun openGooglePhotos()
    fun requestManageMedia()
    fun isCharging(): Boolean
}

/** 端末によってできること */
data class Env(val canTrash: Boolean, val canManageMediaSetting: Boolean, val manageMediaGranted: Boolean)

@Composable
fun App(state: UiState, env: Env, actions: Actions) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Palette.Cream)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Header()
        state.lastError?.let { Notice(it, warn = true) }
        if (state.needsLogin || !state.hasMedia) Setup(state, actions) else Home(state, env, actions)
        Spacer(Modifier.size(24.dp))
    }
    CleanDialogs(state, env, actions)
}

@Composable
private fun Header() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(44.dp).background(Palette.GreenSoft, RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) { Text("✓", color = Palette.Green, style = MaterialTheme.typography.titleLarge) }
        Spacer(Modifier.width(12.dp))
        Text("すっきり容量整理", style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun SoftCard(color: Color = Palette.Card, content: @Composable () -> Unit) {
    Card(
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = color),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        modifier = Modifier.fillMaxWidth(),
    ) { Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() } }
}

@Composable
private fun BigButton(text: String, color: Color = Palette.Green, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(20.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color),
        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
    ) { Text(text, style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Center) }
}

@Composable
private fun Notice(text: String, warn: Boolean = false) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (warn) Color(0xFF9A4A1C) else Color(0xFF2C5878),
        modifier = Modifier
            .fillMaxWidth()
            .background(if (warn) Palette.PeachSoft else Palette.SkySoft, RoundedCornerShape(16.dp))
            .padding(14.dp),
    )
}

// ---------------- はじめの設定（2つだけ） ----------------
@Composable
private fun Setup(state: UiState, actions: Actions) {
    Text("はじめに2つだけ設定します", style = MaterialTheme.typography.headlineMedium)
    Text(
        "設定が終われば、あとはスマホの写真・動画を自動でしらべて、クラウドと照らし合わせます。",
        style = MaterialTheme.typography.bodyLarge, color = Palette.InkSoft,
    )
    StepCard(
        number = 1, done = !state.needsLogin,
        title = "Google ドライブにつなぐ",
        body = if (!state.needsLogin) "つながっています\n${state.email.orEmpty()}" else
            "ログインの画面が出たら、いつものアカウントを選んでください。パスワードはこのアプリには届きません。",
        button = "Google につなぐ", onClick = actions::connect,
    )
    StepCard(
        number = 2, done = state.hasMedia && !state.partialMedia,
        title = "写真と動画を見る許可",
        body = when {
            state.partialMedia -> "いまは一部の写真しか見られません。「すべて許可」にしてください。"
            state.hasMedia -> "許可されています"
            else -> "許可の画面が出たら「すべて許可」を選んでください。写真がスマホの外に送られるのは、クラウドに保存するときだけです。"
        },
        button = if (state.partialMedia) "設定で「すべて許可」にする" else "許可する",
        onClick = if (state.partialMedia) actions::openAppSettings else actions::requestMedia,
    )
}

@Composable
private fun StepCard(number: Int, done: Boolean, title: String, body: String, button: String, onClick: () -> Unit) {
    SoftCard(if (done) Palette.GreenSoft else Palette.Card) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(40.dp).background(if (done) Palette.Green else Palette.Sand, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text(if (done) "✓" else "$number", color = if (done) Color.White else Palette.Ink, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.width(12.dp))
            Text(title, style = MaterialTheme.typography.titleMedium)
        }
        Text(body, style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft)
        if (!done) BigButton(button, onClick = onClick)
    }
}

// ---------------- いつもの画面 ----------------
@Composable
private fun Home(state: UiState, env: Env, actions: Actions) {
    var askCharger by remember { mutableStateOf(false) }

    state.quota?.let { q ->
        Text(
            "${state.email.orEmpty()}　クラウドの空き ${q.free?.let { formatBytes(it) } ?: "無制限"}",
            style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft,
        )
    }

    if (state.running) {
        Running(state.progress, actions)
    } else {
        Hero(state, env, actions)
        BigButton("いますぐ おまかせ整理") { if (actions.isCharging()) actions.runNow() else askCharger = true }
        Text(
            "スマホの写真・動画を全部しらべ、まだのものはクラウドに保存し、クラウドの重複も整理します。スマホから消すのは、確かめてからです。",
            style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft,
        )
        state.report?.let { Stats(it) }
    }

    Settings(state, env, actions)

    if (askCharger) ChargerDialog(actions, onStart = { askCharger = false; actions.runNow() }, onCancel = { askCharger = false })
}

@Composable
private fun Hero(state: UiState, env: Env, actions: Actions) {
    val r = state.report ?: return SoftCard {
        Text("まだ一度も整理していません", style = MaterialTheme.typography.titleMedium)
        Text("下の「いますぐ おまかせ整理」を押すと始まります。充電中・Wi-Fi のときは、毎晩自動でも行います。", style = MaterialTheme.typography.bodyMedium)
    }
    if (r.safe.isEmpty()) {
        SoftCard {
            Text("いまは、スマホから消せるものはありません", style = MaterialTheme.typography.titleMedium)
            Text("クラウドに保存ずみの写真・動画が見つかると、ここに出ます。", style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft)
        }
        return
    }
    SoftCard(Palette.GreenSoft) {
        Text("空けられる容量", style = MaterialTheme.typography.titleMedium, color = Palette.GreenDeep)
        Text(formatBytes(r.safeBytes), style = MaterialTheme.typography.headlineLarge)
        Text(
            "${formatCount(r.safe.size)}の写真・動画が、クラウドにまったく同じ中身で保存されています。",
            style = MaterialTheme.typography.bodyMedium,
        )
        if (env.canTrash) {
            BigButton("スマホから消して空ける", color = Palette.Coral, onClick = actions::askClean)
        } else {
            Notice("この機種（Android 10 以前）では、アプリから消せません。「フォト」や「ギャラリー」アプリで消してください。")
        }
    }
}

@Composable
private fun Running(p: Progress?, actions: Actions) {
    SoftCard {
        Text("整理しています", style = MaterialTheme.typography.headlineMedium)
        Progress.PHASES.forEachIndexed { i, label ->
            val n = i + 1
            val phase = p?.phase ?: 1
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(28.dp).background(
                        when { n < phase -> Palette.Green; n == phase -> Palette.PeachSoft; else -> Palette.Sand }, CircleShape,
                    ),
                    contentAlignment = Alignment.Center,
                ) { if (n < phase) Text("✓", color = Color.White) }
                Spacer(Modifier.width(10.dp))
                Text(
                    label, style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (n == phase) FontWeight.Bold else FontWeight.Normal,
                    color = if (n <= phase) Palette.Ink else Palette.InkSoft,
                )
            }
        }
        val f = p?.fraction
        if (f != null) LinearProgressIndicator(progress = { f }, modifier = Modifier.fillMaxWidth().heightIn(min = 14.dp))
        else LinearProgressIndicator(modifier = Modifier.fillMaxWidth().heightIn(min = 14.dp))
        if (!p?.detail.isNullOrEmpty()) Text(p!!.detail, style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft)
        Text("アプリを閉じても、裏で最後まで続きます。", style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft)
        OutlinedButton(onClick = actions::stop, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(18.dp)) {
            Text("止める", style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun Stats(r: io.github.shiropoppo.sukkiri.data.Report) {
    SoftCard {
        Text("前回の結果", style = MaterialTheme.typography.titleMedium)
        StatRow("スマホの写真・動画", "${formatCount(r.localCount)}（${formatBytes(r.localBytes)}）")
        StatRow("クラウドに保存ずみ", "${formatCount(r.safe.size)}（${formatBytes(r.safeBytes)}）")
        StatRow("今回クラウドに保存", "${formatCount(r.uploadedCount)}（${formatBytes(r.uploadedBytes)}）")
        if (r.cloudDupTrashed > 0) StatRow("クラウドの重複を整理", "${formatCount(r.cloudDupTrashed)}（${formatBytes(r.cloudDupBytes)}）")
        if (r.missingCount > 0) StatRow("まだクラウドにない", "${formatCount(r.missingCount)}（${formatBytes(r.missingBytes)}）")
        if (r.uploadSkippedForQuota > 0) Notice("クラウドの空き容量が足りず、${formatCount(r.uploadSkippedForQuota)}は保存できませんでした。", warn = true)
        if (r.uploadFailed > 0 || r.readErrors > 0) {
            Notice("${formatCount(r.uploadFailed + r.readErrors)}は、うまく読めなかったり保存できなかったりしたので、そのまま残しています。")
        }
        Text(
            "整理した日時：" + SimpleDateFormat("M月d日 H:mm", Locale.JAPAN).format(Date(r.finishedAt)),
            style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft,
        )
        if (r.cloudDupTrashed > 0) {
            Text(
                "クラウドの重複は「ドライブのゴミ箱」に入っています。30日間は元に戻せます。",
                style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft,
            )
        }
    }
}

@Composable
private fun StatRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, textAlign = TextAlign.End)
    }
}

@Composable
private fun Settings(state: UiState, env: Env, actions: Actions) {
    SoftCard {
        Text("設定", style = MaterialTheme.typography.titleMedium)
        SwitchRow("毎晩、充電中・Wi-Fi のときに自動で整理する", state.autoNightly, actions::setAutoNightly)
        SwitchRow("クラウドの中の重複も整理する", state.cloudDedup, actions::setCloudDedup)
        if (env.canManageMediaSetting && !env.manageMediaGranted) {
            Text(
                "「メディア管理」を許可すると、スマホから消すときの確認画面が出なくなります（このアプリでの確認は残ります）。",
                style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft,
            )
            TextButton(onClick = actions::requestManageMedia) { Text("メディア管理を許可する", style = MaterialTheme.typography.bodyLarge) }
        }
        Text(
            "写真を Google フォトにも保存している場合は、Google フォトの「空き容量を増やす」でも容量を空けられます。",
            style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft,
        )
        TextButton(onClick = actions::openGooglePhotos) { Text("Google フォトを開く", style = MaterialTheme.typography.bodyLarge) }
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

// 充電していなければ案内する。充電器をつなぐと自動で始まる
@Composable
private fun ChargerDialog(actions: Actions, onStart: () -> Unit, onCancel: () -> Unit) {
    LaunchedEffect(Unit) {
        while (true) {
            if (actions.isCharging()) {
                delay(1200)
                onStart()
                break
            }
            delay(1000)
        }
    }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("充電器をつないでください", style = MaterialTheme.typography.titleLarge) },
        text = {
            Text(
                "写真や動画がたくさんあると、時間がかかります。途中で電源が切れないよう、充電器をつないでから始めましょう。\n\n充電器をつなぐと、自動で始まります。",
                style = MaterialTheme.typography.bodyLarge,
            )
        },
        confirmButton = { TextButton(onClick = onStart) { Text("充電せずに始める", style = MaterialTheme.typography.bodyLarge) } },
        dismissButton = { TextButton(onClick = onCancel) { Text("やめる", style = MaterialTheme.typography.bodyLarge) } },
    )
}

// ---------------- スマホから消す ----------------
@Composable
private fun CleanDialogs(state: UiState, env: Env, actions: Actions) {
    when (val c = state.clean) {
        null -> Unit
        CleanState.Confirm -> {
            var agree by remember { mutableStateOf(false) }
            val r = state.report
            AlertDialog(
                onDismissRequest = actions::dismissClean,
                title = { Text("本当に消しますか？", style = MaterialTheme.typography.titleLarge) },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("このスマホから ${formatCount(r?.safe?.size ?: 0)}（${formatBytes(r?.safeBytes ?: 0)}）を消します。", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
                        Text("✓ どれも Google ドライブに、中身がまったく同じものが保存されています。", style = MaterialTheme.typography.bodyMedium)
                        Text("✓ 消す直前に、1つずつもう一度クラウドと照らし合わせます。", style = MaterialTheme.typography.bodyMedium)
                        Text("✓ 消したものはスマホの「ゴミ箱」に入り、30日間は元に戻せます。", style = MaterialTheme.typography.bodyMedium)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = agree, onCheckedChange = { agree = it })
                            Text("上の内容を確認しました", style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                },
                confirmButton = {
                    Button(
                        onClick = actions::confirmClean, enabled = agree,
                        colors = ButtonDefaults.buttonColors(containerColor = Palette.Coral),
                    ) { Text("消す", style = MaterialTheme.typography.labelLarge) }
                },
                dismissButton = { TextButton(onClick = actions::dismissClean) { Text("やめる", style = MaterialTheme.typography.bodyLarge) } },
            )
        }
        is CleanState.Verifying -> AlertDialog(
            onDismissRequest = {},
            title = { Text("最終確認をしています", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("クラウドにあることを、1つずつもう一度確かめています。", style = MaterialTheme.typography.bodyLarge)
                    if (c.total > 0) LinearProgressIndicator(progress = { c.done.toFloat() / c.total }, modifier = Modifier.fillMaxWidth())
                    Text("${c.done} / ${c.total}", style = MaterialTheme.typography.bodyMedium)
                }
            },
            confirmButton = {},
        )
        is CleanState.Done -> AlertDialog(
            onDismissRequest = actions::dismissClean,
            title = { Text(if (c.count > 0) "すっきりしました！" else "消したものはありません", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (c.count > 0) {
                        Text(formatBytes(c.bytes), style = MaterialTheme.typography.headlineLarge, color = Palette.GreenDeep)
                        Text("${formatCount(c.count)}をスマホのゴミ箱に移しました。30日たつと自動で消え、容量が空きます（すぐ空けたいときは、フォトやギャラリーのゴミ箱を空にしてください）。", style = MaterialTheme.typography.bodyMedium)
                    }
                    if (c.skipped > 0) Text("念のため ${formatCount(c.skipped)}は消さずに残しました（書きかえられていた、クラウドの状態が変わっていた など）。", style = MaterialTheme.typography.bodyMedium)
                }
            },
            confirmButton = { TextButton(onClick = actions::dismissClean) { Text("閉じる", style = MaterialTheme.typography.bodyLarge) } },
        )
        is CleanState.Failed -> AlertDialog(
            onDismissRequest = actions::dismissClean,
            title = { Text("うまくいきませんでした", style = MaterialTheme.typography.titleLarge) },
            text = { Text(c.message + "\n消したものはありません。", style = MaterialTheme.typography.bodyLarge) },
            confirmButton = { TextButton(onClick = actions::dismissClean) { Text("閉じる", style = MaterialTheme.typography.bodyLarge) } },
        )
    }
}
