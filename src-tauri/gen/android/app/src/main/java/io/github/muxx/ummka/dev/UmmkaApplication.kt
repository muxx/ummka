package io.github.muxx.ummka.dev

import android.app.Application

class UmmkaApplication : Application() {
    private external fun initializeHttp(allowCleartext: Boolean)

    override fun onCreate() {
        super.onCreate()
        System.loadLibrary("ummka_lib")
        initializeHttp(BuildConfig.DEBUG)
    }
}
