package io.github.muxx.ummka.dev

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract.Document
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import java.io.File
import java.io.FileNotFoundException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Installed only in the isolated HTTP-check APK. No device documents are read. */
class DocumentSourceFixture : ContentProvider() {
    override fun onCreate() = true
    override fun getType(uri: Uri) = "application/octet-stream"
    private val openState = AtomicInteger()
    @Volatile private var writer: ParcelFileDescriptor? = null

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, order: String?): Cursor {
        val size: Long? = when (uri.lastPathSegment) {
            "range" -> 5L
            "short" -> 9L
            "open-state" -> openState.get().toLong()
            "pipe-closed" -> {
                val fd = writer
                if (fd == null) 0L else {
                    val poll = StructPollfd().apply {
                        this.fd = fd.fileDescriptor
                        events = OsConstants.POLLOUT.toShort()
                    }
                    Os.poll(arrayOf(poll), 0)
                    if ((poll.revents.toInt() and OsConstants.POLLERR) != 0) {
                        fd.close()
                        writer = null
                        1L
                    } else 0L
                }
            }
            else -> null
        }
        return MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE, Document.COLUMN_MIME_TYPE)).apply {
            addRow(arrayOf<Any?>("облако.bin", size, getType(uri)))
        }
    }

    // ContentResolver routes openAssetFileDescriptor("r") through typed assets.
    override fun openTypedAssetFile(uri: Uri, mimeTypeFilter: String, opts: Bundle?, signal: CancellationSignal?): AssetFileDescriptor {
        require(mimeTypeFilter == "*/*")
        if (uri.lastPathSegment == "await-open") {
            val stopped = CountDownLatch(1)
            val cancel = requireNotNull(signal)
            cancel.setOnCancelListener {
                openState.set(2)
                stopped.countDown()
            }
            openState.set(1)
            check(stopped.await(10, TimeUnit.SECONDS))
            cancel.throwIfCanceled()
            throw FileNotFoundException()
        }
        if (uri.lastPathSegment == "range" || uri.lastPathSegment == "whole") {
            val file = File(requireNotNull(context).cacheDir, "ummka-document-fixture.bin")
            file.writeBytes("PRIVATEhelloTRAILER".toByteArray())
            val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            return if (uri.lastPathSegment == "range") AssetFileDescriptor(fd, 7, 5)
                else AssetFileDescriptor(fd, 0, AssetFileDescriptor.UNKNOWN_LENGTH)
        }
        val pipe = ParcelFileDescriptor.createReliablePipe()
        when (uri.lastPathSegment) {
            "paused" -> writer = pipe[1]
            "failure" -> pipe[1].closeWithError("fixture document unavailable")
            "stream", "short" -> ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { it.write("cloud".toByteArray()) }
            else -> {
                pipe.forEach { it.close() }
                throw FileNotFoundException()
            }
        }
        return AssetFileDescriptor(pipe[0], 0, AssetFileDescriptor.UNKNOWN_LENGTH)
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException()
    override fun delete(uri: Uri, selection: String?, args: Array<out String>?): Int = throw UnsupportedOperationException()
    override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?): Int = throw UnsupportedOperationException()
}
