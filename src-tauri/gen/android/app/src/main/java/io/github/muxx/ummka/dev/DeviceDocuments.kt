package io.github.muxx.ummka.dev

import android.content.ContentResolver
import android.content.res.AssetFileDescriptor
import android.net.Uri
import android.os.CancellationSignal
import android.provider.DocumentsContract.Document
import android.provider.OpenableColumns
import androidx.annotation.Keep
import org.json.JSONObject
import java.io.IOException

@Keep
class DeviceDocuments(private val resolver: ContentResolver) {
    fun request(raw: String): DocumentRequest {
        val uri = Uri.parse(raw)
        require(uri.scheme == ContentResolver.SCHEME_CONTENT && !uri.authority.isNullOrEmpty())
        return DocumentRequest(resolver, uri)
    }
}

@Keep
class DocumentRequest(private val resolver: ContentResolver, private val uri: Uri) {
    private val signal = CancellationSignal()
    fun cancel() = signal.cancel()

    fun describe(): String {
        val columns = arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE, Document.COLUMN_MIME_TYPE)
        val result = resolver.query(uri, columns, null, null, null, signal)?.use { cursor ->
            if (!cursor.moveToFirst()) throw IOException("Document unavailable")
            val name = cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME))
                ?: throw IOException("Missing document name")
            val index = cursor.getColumnIndex(OpenableColumns.SIZE)
            val size = if (index >= 0 && !cursor.isNull(index)) cursor.getLong(index) else null
            if (size != null && size < -1) throw IOException("Invalid document size")
            val mimeIndex = cursor.getColumnIndex(Document.COLUMN_MIME_TYPE)
            val mime = if (mimeIndex >= 0) cursor.getString(mimeIndex) else null
            JSONObject().put("name", name).put("size", size?.takeIf { it >= 0 }).put("mime_type", mime)
        } ?: throw IOException("Document unavailable")
        return result.toString()
    }

    fun open(): AssetFileDescriptor =
        resolver.openAssetFileDescriptor(uri, "r", signal) ?: throw IOException("Document unavailable")
}
