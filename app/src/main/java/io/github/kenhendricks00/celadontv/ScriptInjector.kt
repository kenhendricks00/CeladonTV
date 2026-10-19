package io.github.kenhendricks00.celadontv

import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Keeps the WebView's document-start scripts equal to the requested list. Changes
 * take effect on the next page load.
 */
class ScriptInjector(private val webView: WebView) {
    private var handlers: List<ScriptHandler> = emptyList()
    private var scripts: List<String>? = null

    /** Returns true if the script list changed. */
    fun apply(newScripts: List<String>): Boolean {
        if (newScripts == scripts) return false
        handlers.forEach(ScriptHandler::remove)
        handlers = if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            newScripts.map { WebViewCompat.addDocumentStartJavaScript(webView, it, setOf(TwitchTv.ORIGIN)) }
        } else {
            emptyList()
        }
        scripts = newScripts
        return true
    }

    /** Best-effort fallback for WebViews older than document-start script support (~M88). */
    fun onPageStarted(url: String) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) || !url.startsWith(TwitchTv.ORIGIN)) return
        scripts?.forEach { webView.evaluateJavascript(it, null) }
    }
}
