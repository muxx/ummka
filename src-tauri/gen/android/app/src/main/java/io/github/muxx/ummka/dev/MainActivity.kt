package io.github.muxx.ummka.dev

import android.content.Intent
import android.os.Bundle
import android.webkit.WebView
import androidx.annotation.Keep
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var content: WebView? = null

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    content = webView
    focusLinkWindow(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    focusLinkWindow(intent)
  }

  private fun focusLinkWindow(intent: Intent?) {
    if (intent?.action != Intent.ACTION_VIEW) return
    // Wry attaches its WebView after onWebViewCreate. An OS-opened link has no
    // preceding touch to give the WebView native input focus on a cold start.
    content?.let { view -> view.post { view.requestFocus() } }
  }

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
