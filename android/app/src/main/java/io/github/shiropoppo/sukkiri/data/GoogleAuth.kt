package io.github.shiropoppo.sukkiri.data

import android.content.Context
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.tasks.await

/**
 * Google ドライブを使う許可（Android の Google ログイン）。
 * パスワードはアプリに届かない。一度許可すると、次からは画面を出さずに通行証（アクセストークン）がもらえる。
 */
object GoogleAuth {
    /** ドライブ全体を扱う許可。クラウド内の重複を整理する（ゴミ箱へ移す）ために必要 */
    const val DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"

    val request: AuthorizationRequest =
        AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(DRIVE_SCOPE))).build()

    suspend fun authorize(context: Context): AuthorizationResult =
        Identity.getAuthorizationClient(context).authorize(request).await()

    /** 画面を出さずに通行証をもらう。まだ許可されていない（画面が必要な）ときは null */
    suspend fun silentToken(context: Context): String? {
        val r = authorize(context)
        return if (r.hasResolution()) null else r.accessToken
    }
}

class LoginRequiredException : Exception("もう一度ログインが必要です")
