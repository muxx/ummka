package io.github.muxx.ummka.dev

import android.content.Intent
import android.os.Bundle
import androidx.annotation.Keep
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  @Keep
  fun presentBrowserSignIn(id: String, url: String, scheme: String) {
    startActivity(Intent(this, BrowserSignInActivity::class.java)
      .putExtra("request", id).putExtra("start", url).putExtra("scheme", scheme))
  }

  @Keep
  fun dismissBrowserSignIn(id: String) {
    BrowserSignInActivity.dismiss(id)
  }

  override fun onDestroy() {
    if (!isChangingConfigurations) BrowserSignInActivity.ownerClosed()
    super.onDestroy()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
