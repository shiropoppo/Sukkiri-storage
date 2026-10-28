package io.github.shiropoppo.sukkiri.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import java.util.Locale

// ウェブ版と同じ、明るくやさしい色
object Palette {
    val Cream = Color(0xFFFFF8EE)
    val Card = Color(0xFFFFFFFF)
    val Ink = Color(0xFF3A342E)
    val InkSoft = Color(0xFF6B6158)
    val Line = Color(0xFFEFE2D0)
    val Green = Color(0xFF2F8F6A)
    val GreenDeep = Color(0xFF237556)
    val GreenSoft = Color(0xFFE3F4EB)
    val Peach = Color(0xFFE58A4E)
    val PeachSoft = Color(0xFFFDEBDC)
    val Sky = Color(0xFF3E86B8)
    val SkySoft = Color(0xFFE2F0FA)
    val Coral = Color(0xFFCF5640)
    val CoralSoft = Color(0xFFFCE6E0)
    val Sand = Color(0xFFF4EEE6)
}

private val colors = lightColorScheme(
    primary = Palette.Green,
    onPrimary = Color.White,
    secondary = Palette.Peach,
    background = Palette.Cream,
    surface = Palette.Card,
    onBackground = Palette.Ink,
    onSurface = Palette.Ink,
    error = Palette.Coral,
)

// 年配の方にも読みやすい、大きめの文字
private val type = Typography(
    headlineLarge = TextStyle(fontSize = 40.sp, fontWeight = FontWeight.Bold, lineHeight = 48.sp),
    headlineMedium = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.Bold, lineHeight = 36.sp),
    titleLarge = TextStyle(fontSize = 23.sp, fontWeight = FontWeight.Bold, lineHeight = 31.sp),
    titleMedium = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold, lineHeight = 28.sp),
    bodyLarge = TextStyle(fontSize = 19.sp, lineHeight = 29.sp),
    bodyMedium = TextStyle(fontSize = 17.sp, lineHeight = 26.sp),
    labelLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold),
)

@Composable
fun SukkiriTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, typography = type, content = content)
}

fun formatBytes(n: Long): String {
    val gb = 1024.0 * 1024 * 1024
    val mb = 1024.0 * 1024
    return when {
        n >= 100 * gb -> String.format(Locale.JAPAN, "%,d GB", (n / gb).toLong())
        n >= gb -> String.format(Locale.JAPAN, "%.1f GB", n / gb)
        n >= 10 * mb -> String.format(Locale.JAPAN, "%d MB", (n / mb).toLong())
        n >= mb -> String.format(Locale.JAPAN, "%.1f MB", n / mb)
        n >= 1024 -> String.format(Locale.JAPAN, "%d KB", n / 1024)
        else -> "$n バイト"
    }
}

fun formatCount(n: Int): String = String.format(Locale.JAPAN, "%,d件", n)
