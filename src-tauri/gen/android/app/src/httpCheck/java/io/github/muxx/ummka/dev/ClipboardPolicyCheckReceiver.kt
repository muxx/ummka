package io.github.muxx.ummka.dev

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle

/** Only the device-owner fixture on the disposable emulator declares this receiver. */
class ClipboardPolicyCheckReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val settings = Bundle()
        when (val value = intent.getStringExtra("value")) {
            "true", "false" -> settings.putString("copyAndPasteProtection", value)
            "malformed" -> settings.putString("copyAndPasteProtection", "False")
            "boolean" -> settings.putBoolean("copyAndPasteProtection", false)
            "unset" -> Unit
            else -> return
        }
        context.getSystemService(DevicePolicyManager::class.java).setApplicationRestrictions(
            ComponentName(context, HttpCheckAdmin::class.java), context.packageName, settings)
        resultCode = Activity.RESULT_OK
    }
}
