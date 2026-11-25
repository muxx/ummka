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
