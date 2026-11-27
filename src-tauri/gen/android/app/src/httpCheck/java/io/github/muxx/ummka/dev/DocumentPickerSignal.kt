package io.github.muxx.ummka.dev

import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File

/** Only present in the disposable emulator test package. */
class DocumentPickerSignal : BroadcastReceiver() {
    private external fun signal(command: Int)
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            START -> {
                if (android.os.Build.VERSION.SDK_INT < 29) error("This fixture requires MediaStore Downloads")
                val canary = File(context.cacheDir, "picker-private-canary.txt")
                canary.writeText("fixture")
                val ownUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", canary)
                // The negative test below must hit a URI our resolver could otherwise read.
                check(context.contentResolver.openInputStream(ownUri)?.use { it.read() } == 'f'.code)
                for (name in listOf("ummka-first.txt", "ummka-second.txt")) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, name)
                        put(MediaStore.Downloads.MIME_TYPE, "text/plain")
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                    val resolver = context.contentResolver
                    val uri = checkNotNull(resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
                    checkNotNull(resolver.openOutputStream(uri)).use { it.write(name.toByteArray()) }
                    values.clear()
                    values.put(MediaStore.Downloads.IS_PENDING, 0)
                    check(resolver.update(uri, values, null, null) == 1)
                }
                signal(0)
            }
            CANCEL -> signal(1)
            REOPEN -> signal(2)
        }
    }
    companion object {
        private const val START = "ummka.fixture.DOCUMENTS_START"
        private const val CANCEL = "ummka.fixture.DOCUMENTS_CANCEL"
        private const val REOPEN = "ummka.fixture.DOCUMENTS_REOPEN"
    }
}
