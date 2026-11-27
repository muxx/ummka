package io.github.muxx.ummka.dev

import android.app.Application

class UmmkaApplication : Application() {
    private external fun initializeHttp(allowCleartext: Boolean)
    private external fun initializeSessionVault(vault: SessionVault)

    private external fun initializeDocumentResolver(resolver: DeviceDocuments)

    override fun onCreate() {
        super.onCreate()
        System.loadLibrary("ummka_lib")
        initializeHttp(BuildConfig.DEBUG)
        initializeSessionVault(SessionVault(this))
        initializeDocumentResolver(DeviceDocuments(contentResolver))
    }
}
