package io.github.muxx.ummka.dev

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import androidx.annotation.Keep
import org.json.JSONArray

/** The main Activity owns the temporary URI grants as long as the draft window is alive. */
@Keep
internal class DocumentPicker(private val activity: Activity) {
    private var pending: String? = null

    private external fun nativeWaiting(request: String): Boolean
    private external fun nativeResult(request: String, code: Int, uris: String)

    fun restore(state: Bundle?) {
        pending = state?.getString(STATE)
        pending?.let { if (!nativeWaiting(it)) dismiss(it) }
    }

    fun save(state: Bundle) = state.putString(STATE, pending)

    fun show(id: String, multiple: Boolean) {
        if (!nativeWaiting(id)) return
        if (activity.isFinishing || activity.isDestroyed) {
            nativeResult(id, UNAVAILABLE, "")
            return
        }
        if (pending != null) {
            nativeResult(id, BUSY, "")
            return
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        pending = id
        try {
            // Keep the framework request code so finishActivity can close this external chooser.
            activity.startActivityForResult(intent, REQUEST_CODE)
            return
        } catch (_: ActivityNotFoundException) {
        } catch (_: SecurityException) {
        }
        pending = null
        nativeResult(id, UNAVAILABLE, "")
    }

    fun dismiss(id: String) {
        // Android can deliver a late result after dismissal. Retain its id until that callback.
        if (pending == id) activity.finishActivity(REQUEST_CODE)
    }

    fun ownerClosed() {
        val id = pending ?: return
        pending = null
        nativeResult(id, CANCELLED, "")
        activity.finishActivity(REQUEST_CODE)
    }

    fun receive(requestCode: Int, result: Int, intent: Intent?): Boolean {
        if (requestCode != REQUEST_CODE) return false
        val id = pending ?: return true
        pending = null
        if (!nativeWaiting(id)) return true
        if (result != Activity.RESULT_OK || intent == null) {
            nativeResult(id, if (result == Activity.RESULT_CANCELED) CANCELLED else UNAVAILABLE, "")
            return true
        }
        val uris = JSONArray()
        val items = intent.clipData
        if (items != null) {
            for (i in 0 until items.itemCount) uris.put(items.getItemAt(i).uri?.toString().orEmpty())
        } else {
            intent.data?.let { uris.put(it.toString()) }
        }
        nativeResult(id, RETURNED, uris.toString())
        return true
    }

    companion object {
        private const val STATE = "ummka.document-picker.request"
        // AndroidX reserves request codes above 0xffff. This one belongs to our main Activity.
        private const val REQUEST_CODE = 0x554D
        private const val RETURNED = 0
        private const val CANCELLED = 1
        private const val BUSY = 2
        private const val UNAVAILABLE = 3
    }
}
