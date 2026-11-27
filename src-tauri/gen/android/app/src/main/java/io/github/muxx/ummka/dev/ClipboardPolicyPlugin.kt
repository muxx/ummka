package io.github.muxx.ummka.dev

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.RestrictionsManager
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class ClipboardPolicyPlugin(activity: Activity) : Plugin(activity) {
    private val key = "copyAndPasteProtection"
    private val context = activity.applicationContext
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED) publish()
        }
    }

    private var listening = false

    private fun allowed(): Boolean {
        val settings = context.getSystemService(RestrictionsManager::class.java)
            ?.applicationRestrictions ?: return false
        return !settings.containsKey(key) || settings.getString(key) == "false"
    }

    private fun publish() {
        val data = JSObject()
        data.put("allowed", try { allowed() } catch (_: RuntimeException) { false })
        trigger("changed", data)
    }

    override fun load(webView: WebView) {
        if (listening) return
        listening = try {
            ContextCompat.registerReceiver(
                context,
                receiver,
                IntentFilter(Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            true
        } catch (_: RuntimeException) {
            false
        }
    }

    @Command
    override fun registerListener(invoke: Invoke) {
        if (listening) super.registerListener(invoke)
        else invoke.reject("Could not observe Android application restrictions")
    }

    override fun onResume(activity: AppCompatActivity) {
        publish()
    }

    override fun onDestroy(activity: AppCompatActivity) {
        if (listening) {
            context.unregisterReceiver(receiver)
            listening = false
        }
    }

    @Command
    fun readAllowed(invoke: Invoke) {
        try {
            invoke.resolveObject(allowed())
        } catch (_: RuntimeException) {
            invoke.reject("Could not read Android application restrictions")
        }
    }
}
