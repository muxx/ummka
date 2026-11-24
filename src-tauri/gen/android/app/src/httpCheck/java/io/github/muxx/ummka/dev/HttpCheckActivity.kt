package io.github.muxx.ummka.dev

import android.app.Activity
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.os.Bundle
import android.util.Base64
import android.util.Log

class HttpCheckAdmin : DeviceAdminReceiver()

class HttpCheckActivity : Activity() {
    private external fun runChecks(ports: String)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Thread {
            try {
                val policies = getSystemService(DevicePolicyManager::class.java)
                val admin = ComponentName(this, HttpCheckAdmin::class.java)
                val ca = Base64.decode(requireNotNull(intent.getStringExtra("ca")), Base64.DEFAULT)
                check(policies.installCaCert(admin, ca))
                runChecks(requireNotNull(intent.getStringExtra("ports")))
                Log.i("UmmkaHttpCheck", "PASS")
            } catch (error: Throwable) {
                Log.e("UmmkaHttpCheck", "FAIL", error)
            } finally {
                runOnUiThread { finish() }
            }
        }.start()
    }
}
