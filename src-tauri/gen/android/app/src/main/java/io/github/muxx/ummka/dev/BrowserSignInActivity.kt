package io.github.muxx.ummka.dev

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsClient
import java.lang.ref.WeakReference

/** Each instance owns exactly one Activity Result registration and one native request. */
class BrowserSignInActivity : ComponentActivity() {
    private val requestId get() = intent.getStringExtra("request")
    private var settled = false
    private external fun nativeIsWaiting(id: String): Boolean
    private external fun nativeBrowserResult(id: String, result: Int, uri: String?)

    private val launcher = AuthTabIntent.registerActivityResultLauncher(this) { result ->
        when (result.resultCode) {
            Activity.RESULT_OK -> finishWith(RETURNED, result.resultUri?.toString())
            Activity.RESULT_CANCELED -> finishWith(CANCELLED)
            else -> finishWith(UNAVAILABLE)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = requestId
        if (id == null || !nativeIsWaiting(id)) {
            finish()
            return
        }
        shown = WeakReference(this)
        // Android restores this Activity's own result. Starting again would launch a second login.
        if (savedInstanceState != null) return
        val start = intent.getStringExtra("start")
        val scheme = intent.getStringExtra("scheme")
        if (start == null || scheme == null) {
            finishWith(UNAVAILABLE)
            return
        }
        // A generic HTTPS address selects the default browser independently of site-specific App Links.
        val web = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.invalid/")).addCategory(Intent.CATEGORY_BROWSABLE)
        val provider = packageManager.resolveActivity(web, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
        if (provider == null || !CustomTabsClient.isAuthTabSupported(this, provider)) {
            finishWith(UNSUPPORTED)
            return
        }
        val tab = AuthTabIntent.Builder().build()
        tab.intent.setPackage(provider)
        try {
            tab.launch(launcher, Uri.parse(start), scheme)
        } catch (_: ActivityNotFoundException) {
            finishWith(UNAVAILABLE)
        } catch (_: SecurityException) {
            finishWith(UNAVAILABLE)
        }
    }

    private fun finishWith(result: Int, uri: String? = null) {
        if (!settled) {
            settled = true
            requestId?.let { nativeBrowserResult(it, result, uri) }
        }
        finish()
    }

    override fun onDestroy() {
        if (shown?.get() === this) shown = null
        if (isFinishing && !settled) {
            settled = true
            requestId?.let { nativeBrowserResult(it, CANCELLED, null) }
        }
        super.onDestroy()
    }

    companion object {
        private const val RETURNED = 0
        private const val CANCELLED = 1
        private const val UNSUPPORTED = 2
        private const val UNAVAILABLE = 3
        private var shown: WeakReference<BrowserSignInActivity>? = null

        internal fun dismiss(id: String) {
            val current = shown?.get()
            if (current != null && current.requestId == id) current.finishWith(CANCELLED)
        }

        internal fun ownerClosed() {
            shown?.get()?.finishWith(CANCELLED)
        }
    }
}
