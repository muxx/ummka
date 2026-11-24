package io.github.muxx.ummka.dev

import android.app.Activity
import android.app.Instrumentation
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.os.Bundle
import android.util.Base64
import android.util.Log
import java.io.File

class HttpCheckAdmin : DeviceAdminReceiver()

class HttpCheckInstrumentation : Instrumentation() {
    private external fun runChecks(ports: String, registryPath: String)
    private lateinit var arguments: Bundle

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        this.arguments = requireNotNull(arguments)
        start()
    }

    override fun onStart() {
        val result = Bundle()
        try {
            // The target application initializes the native verifier on its main thread.
            waitForIdleSync()
            val app = targetContext
            val policies = app.getSystemService(DevicePolicyManager::class.java)
            val admin = ComponentName(app, HttpCheckAdmin::class.java)
            val ca = Base64.decode(requireNotNull(arguments.getString("ca")), Base64.DEFAULT)
            check(policies.installCaCert(admin, ca))
            val registry = File.createTempFile("ummka-registry-", ".sqlite", app.cacheDir)
            try {
                runChecks(requireNotNull(arguments.getString("ports")), registry.absolutePath)
            } finally {
                registry.delete()
            }
            result.putString("result", "PASS")
            finish(Activity.RESULT_OK, result)
        } catch (error: Throwable) {
            result.putString("error", Log.getStackTraceString(error))
            finish(Activity.RESULT_CANCELED, result)
        }
    }
}
