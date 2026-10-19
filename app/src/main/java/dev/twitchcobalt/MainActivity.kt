package dev.twitchcobalt

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import dev.twitchcobalt.settings.AppSettings
import dev.twitchcobalt.settings.SettingsActivity

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var injector: ScriptInjector
    private lateinit var settings: AppSettings

    private var backLongPressed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        settings = AppSettings(this)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.textZoom = 100
            webViewClient = Client()
            webChromeClient = ChromeClient()
            addJavascriptInterface(
                NativeHooks(onCloseRequested = { runOnUiThread(::finish) }),
                NativeHooks.JS_NAME,
            )
        }
        setContentView(webView)
        injector = ScriptInjector(webView)
        injector.apply(AdBlock.scripts(this, settings))
        webView.loadUrl(TwitchTv.HOME_URL)
        webView.requestFocus()
        AdBlock.updateIfDue(this, settings)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        if (injector.apply(AdBlock.scripts(this, settings))) webView.reload()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        when (event.keyCode) {
            KeyEvent.KEYCODE_BACK -> return handleBack(event)
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> {
                if (event.action == KeyEvent.ACTION_UP) openSettings()
                return true
            }
        }
        val script = TwitchTv.mediaKeyScript(event.keyCode)
        if (script != null) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) webView.evaluateJavascript(script, null)
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    /** Short press goes back inside Starshot; long press opens settings. */
    private fun handleBack(event: KeyEvent): Boolean {
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (event.repeatCount == 0) backLongPressed = false
                if (event.isLongPress && !backLongPressed) {
                    backLongPressed = true
                    openSettings()
                }
            }
            KeyEvent.ACTION_UP -> if (!backLongPressed && !event.isCanceled) {
                webView.evaluateJavascript(TwitchTv.BACK_SCRIPT, null)
            }
        }
        return true
    }

    private fun openSettings() = startActivity(Intent(this, SettingsActivity::class.java))

    private inner class Client : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) = injector.onPageStarted(url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            request.url.scheme != "https" && request.url.scheme != "http"

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.w(TAG, "WebView renderer gone; recreating")
            recreate()
            return true
        }
    }

    private class ChromeClient : WebChromeClient() {
        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            if (BuildConfig.DEBUG) Log.d(TAG, "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
            return true
        }
    }

    private companion object {
        const val TAG = "TwitchCobalt"
    }
}
