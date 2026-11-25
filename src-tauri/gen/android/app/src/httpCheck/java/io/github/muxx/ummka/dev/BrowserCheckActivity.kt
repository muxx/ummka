package io.github.muxx.ummka.dev

import android.app.Activity
import android.app.Service
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
import androidx.browser.auth.AuthTabIntent

/** The disposable emulator selects the test package as its default browser. */
class BrowserCheckActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        BrowserLifecycleProbe.install(application)
        val scheme = "io.github.muxx.ummka.auth"
        if (intent.getBooleanExtra(AuthTabIntent.EXTRA_LAUNCH_AUTH_TAB, false) &&
            intent.getStringExtra(AuthTabIntent.EXTRA_REDIRECT_SCHEME) == scheme
        ) {
            val start = intent.data
            if (start?.scheme == "https" && start.host == "127.0.0.1" && start.port > 0 &&
                start.path == "/browser-action-check/oauth/gitlab/mobile_login" &&
                start.getQueryParameter("redirect_to") == "$scheme://callback"
            ) {
                val callback = Uri.parse("$scheme://callback").buildUpon()
                    .appendQueryParameter("MMAUTHTOKEN", "fixture-browser-action")
                    .appendQueryParameter("MMCSRF", "fixture-browser-csrf")
                    .appendQueryParameter("srv", "https://127.0.0.1:${start.port}/browser-action-check")
                    .build()
                setResult(RESULT_OK, Intent().setData(callback))
                finish()
                return
            }
            if (start?.scheme == "https" && start.host == "127.0.0.1" && start.port > 0 &&
                start.path == "/browser-action-check/oauth/google/mobile_login" &&
                start.getQueryParameter("redirect_to") == "$scheme://callback"
            ) {
                // Leave this request pending so the main WebView can cancel it.
                return
            }
            when (intent.dataString) {
                "https://127.0.0.1/ummka-browser-check/return" ->
                    setResult(RESULT_OK, Intent().setData(Uri.parse("$scheme://callback?fixture=returned")))
                "https://127.0.0.1/ummka-browser-check/recreate" -> {
                    BrowserLifecycleProbe.recreate(this)
                    return
                }
                "https://127.0.0.1/ummka-browser-check/late" -> {
                    BrowserLifecycleProbe.holdUntilNextRequest(this)
                    return
                }
                "https://127.0.0.1/ummka-browser-check/cancel" -> {
                    // The next launch exercises capability discovery against an unsupported browser.
                    packageManager.setComponentEnabledSetting(
                        ComponentName(this, BrowserCheckService::class.java),
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP,
                    )
                    setResult(RESULT_CANCELED)
                }
            }
        }
        finish()
    }

    fun answer(marker: String) {
        setResult(RESULT_OK, Intent().setData(Uri.parse("io.github.muxx.ummka.auth://callback?fixture=$marker")))
        finish()
    }
}

class BrowserCheckService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
}
