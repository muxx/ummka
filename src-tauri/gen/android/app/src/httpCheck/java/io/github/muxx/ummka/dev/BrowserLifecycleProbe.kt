package io.github.muxx.ummka.dev

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.annotation.Keep

/** Test-package lifecycle observer. The production Activity still receives results through AndroidX. */
@Keep
internal object BrowserLifecycleProbe : Application.ActivityLifecycleCallbacks {
    private val main = Handler(Looper.getMainLooper())
    private var installed = false
    private var owner: BrowserSignInActivity? = null
    private var recreating: BrowserCheckActivity? = null
    private var oldReceiver: BrowserSignInActivity? = null
    private var returnedLate = false
    private external fun nativeEvent(code: Int)
    private external fun nativeHasOtherWaiting(id: String): Boolean

    fun install(application: Application) {
        if (!installed) {
            application.registerActivityLifecycleCallbacks(this)
            installed = true
        }
    }

    fun recreate(provider: BrowserCheckActivity) {
        nativeEvent(1)
        if (recreating != null) {
            provider.answer("duplicate")
            return
        }
        val receiver = checkNotNull(owner)
        recreating = provider
        main.post { receiver.recreate() }
    }

    fun holdUntilNextRequest(provider: BrowserCheckActivity) {
        val receiver = checkNotNull(owner)
        val id = checkNotNull(receiver.intent.getStringExtra("request"))
        oldReceiver = receiver
        nativeEvent(2)
        main.post(object : Runnable {
            override fun run() {
                if (provider.isDestroyed || provider.isFinishing) return
                if (nativeHasOtherWaiting(id)) {
                    returnedLate = true
                    provider.answer("late")
                } else {
                    main.postDelayed(this, 20)
                }
            }
        })
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (activity !is BrowserSignInActivity) return
        owner = activity
        val provider = recreating
        if (provider != null && savedInstanceState != null) {
            // onCreate of the replacement must register the pending result without launching again.
            main.post { provider.answer("recreated") }
        }
    }

    override fun onActivityDestroyed(activity: Activity) {
        if (activity === owner) owner = null
        if (activity === recreating) recreating = null
        if (activity === oldReceiver && returnedLate) {
            oldReceiver = null
            nativeEvent(3)
        }
    }

    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
}
