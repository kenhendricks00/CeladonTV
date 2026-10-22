package io.github.kenhendricks00.celadontv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ProgressBar
import io.github.kenhendricks00.celadontv.diagnostics.Diagnostics
import io.github.kenhendricks00.celadontv.diagnostics.DiagnosticsBridge
import io.github.kenhendricks00.celadontv.settings.AppSettings
import io.github.kenhendricks00.celadontv.settings.SettingsActivity
import io.github.kenhendricks00.celadontv.update.AppUpdateFlow

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var injector: ScriptInjector
    private lateinit var settings: AppSettings
    private lateinit var appUpdates: AppUpdateFlow
    private lateinit var loading: View
    private lateinit var loadingProgress: ProgressBar
    private lateinit var offline: View
    private val connectivity by lazy { getSystemService(ConnectivityManager::class.java) }
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = retryIfOffline()

        override fun onBlockedStatusChanged(network: Network, blocked: Boolean) {
            if (!blocked) retryIfOffline()
        }

        private fun retryIfOffline() = runOnUiThread { if (isOffline()) retry() }
    }

    private var backLongPressed = false
    private var diagnosticsBridge: DiagnosticsBridge? = null

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
            addJavascriptInterface(SettingsBridge(::openSettingsFromPage), SettingsBridge.JS_NAME)
        }
        setContentView(R.layout.activity_main)
        findViewById<FrameLayout>(R.id.root).addView(webView, 0)
        loading = findViewById(R.id.loading)
        loadingProgress = findViewById(R.id.loading_progress)
        offline = findViewById(R.id.offline)
        findViewById<Button>(R.id.offline_retry).setOnClickListener { retry() }
        connectivity.registerDefaultNetworkCallback(networkCallback)
        injector = ScriptInjector(webView)
        syncDiagnostics()
        injector.apply(pageScripts())
        webView.loadUrl(TwitchTv.HOME_URL)
        webView.requestFocus()
        AdBlock.updateIfDue(this, settings)
        appUpdates = AppUpdateFlow(this)
        appUpdates.checkIfDue()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        appUpdates.onResume()
        syncDiagnostics()
        if (injector.apply(pageScripts())) webView.reload()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        connectivity.unregisterNetworkCallback(networkCallback)
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
                if (isOffline()) finish() else webView.evaluateJavascript(TwitchTv.BACK_SCRIPT, null)
            }
        }
        return true
    }

    // The marker script makes turning diagnostics on or off change the script list, which
    // reloads the page so the bridge below is added or removed.
    private fun pageScripts() = listOf(readScriptAsset(SETTINGS_ROW_SCRIPT)) + AdBlock.scripts(this, settings) + Emotes.scripts(this, settings) +
        listOfNotNull(DIAGNOSTICS_MARKER.takeIf { settings.diagnostics })

    /** Adds `window.CeladonTVDiagnostics` only while the user has diagnostics turned on. */
    private fun syncDiagnostics() {
        if (settings.diagnostics && diagnosticsBridge == null) {
            diagnosticsBridge = DiagnosticsBridge(Diagnostics.log(this)).also { webView.addJavascriptInterface(it, DiagnosticsBridge.JS_NAME) }
        } else if (!settings.diagnostics && diagnosticsBridge != null) {
            webView.removeJavascriptInterface(DiagnosticsBridge.JS_NAME)
            diagnosticsBridge = null
        }
    }

    private fun openSettings() = startActivity(Intent(this, SettingsActivity::class.java))

    /** The bridge can't be limited to an origin, so only act while Twitch's TV app is the loaded page. */
    private fun openSettingsFromPage() = runOnUiThread {
        if (webView.url?.startsWith(TwitchTv.ORIGIN) == true) openSettings()
    }

    /** Fades out the loading screen once Twitch's page has loaded. */
    private fun hideLoading() {
        if (loading.visibility != View.VISIBLE) return
        loading.animate().alpha(0f).setDuration(250).withEndAction { loading.visibility = View.GONE }
    }

    private fun isOffline() = offline.visibility == View.VISIBLE

    /** Replaces the WebView's error page; the WebView is hidden so D-pad focus stays on Retry. */
    private fun showOffline() {
        loading.animate().cancel()
        loading.visibility = View.GONE
        webView.visibility = View.INVISIBLE
        offline.visibility = View.VISIBLE
        findViewById<Button>(R.id.offline_retry).requestFocus()
    }

    private fun retry() {
        offline.visibility = View.GONE
        loadingProgress.progress = 0
        loading.alpha = 1f
        loading.visibility = View.VISIBLE
        webView.visibility = View.VISIBLE
        webView.requestFocus()
        webView.reload()
    }

    private inner class Client : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            diagnosticsBridge?.record("page started: " + url.substringBefore('?'))
            injector.onPageStarted(url)
        }

        override fun onPageFinished(view: WebView, url: String) {
            if (url.startsWith(TwitchTv.ORIGIN)) hideLoading()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showOffline()
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            request.url.scheme != "https" && request.url.scheme != "http"

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.w(TAG, "WebView renderer gone; recreating")
            diagnosticsBridge?.record("WebView renderer gone")
            recreate()
            return true
        }
    }

    private inner class ChromeClient : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            loadingProgress.progress = newProgress
        }

        /** Replaces WebView's default poster (a large gray play button) shown before a video starts. */
        override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            if (BuildConfig.DEBUG) Log.d(TAG, "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
            return true
        }
    }

    private companion object {
        const val TAG = "CeladonTV"
        const val SETTINGS_ROW_SCRIPT = "celadontv-settings-row.js"
        const val DIAGNOSTICS_MARKER = "window.__ctvDiagnostics = true;"
    }
}
