package io.github.kenhendricks00.celadontv.diagnostics

import android.webkit.JavascriptInterface

/**
 * Implements `window.CeladonTVDiagnostics`, added to the page only while diagnostics are on.
 * The ad filter reports its decisions through it; called on a WebView binder thread.
 */
class DiagnosticsBridge(private val log: DiagnosticsLog) {
    @JavascriptInterface
    fun record(line: String?) {
        if (!line.isNullOrBlank()) log.append(line)
    }

    companion object {
        const val JS_NAME = "CeladonTVDiagnostics"
    }
}
