package io.github.muxx.ummka.dev

import android.app.Activity
import android.app.Instrumentation
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.os.Bundle
import android.util.Base64
import android.util.Log
import androidx.annotation.Keep
import java.io.File
import java.security.KeyStore
import java.util.UUID

class HttpCheckAdmin : DeviceAdminReceiver()

class HttpCheckInstrumentation : Instrumentation() {
    private external fun runChecks(ports: String, registryPath: String, accountPort: Int)
    private external fun checkVault(phase: String)
    private lateinit var arguments: Bundle

    @Keep
    private fun reportStage(stage: String) {
        sendStatus(1, Bundle().apply { putString("ummka_stage", stage) })
    }

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        this.arguments = requireNotNull(arguments)
        start()
    }

    override fun onStart() {
        val result = Bundle()
        try {
            // The target application initializes the native verifier on its main thread.
            val phase = arguments.getString("vault")
            if (phase == null) reportStage("activity-idle")
            waitForIdleSync()
            if (arguments.getString("checkpoint") == "permalink") {
                result.putString("checkpoint", "permalink")
                finish(Activity.RESULT_OK, result)
                return
            }
            val app = targetContext
            if (phase != null) {
                val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                val alias = "${app.packageName}.mattermost.sessions.v1"
                if (phase == "seed") check(!keys.containsAlias(alias))
                checkVault(phase)
                check(keys.getKey(alias, null)?.let { it.encoded == null } == true)
                if (phase == "confirm") {
                    keys.deleteEntry(alias)
                    checkVault("missing_key")
                    check(!keys.containsAlias(alias))
                }
                result.putString("phase", "$phase ${android.os.Process.myPid()}")
                finish(Activity.RESULT_OK, result)
                return
            }
            reportStage("install-ca")
            val policies = app.getSystemService(DevicePolicyManager::class.java)
            val admin = ComponentName(app, HttpCheckAdmin::class.java)
            val ca = Base64.decode(requireNotNull(arguments.getString("ca")), Base64.DEFAULT)
            check(policies.installCaCert(admin, ca))
            val workspace = File(app.cacheDir, "ummka-storage-" + UUID.randomUUID())
            check(workspace.mkdir())
            val registry = File(workspace, "installations.sqlite")
            try {
                reportStage("native-setup")
                runChecks(requireNotNull(arguments.getString("ports")), registry.absolutePath, requireNotNull(arguments.getString("accountPort")).toInt())
            } finally {
                check(workspace.deleteRecursively())
            }
            result.putString("result", "PASS")
            finish(Activity.RESULT_OK, result)
        } catch (error: Throwable) {
            result.putString("error", Log.getStackTraceString(error))
            finish(Activity.RESULT_CANCELED, result)
        }
    }
}
