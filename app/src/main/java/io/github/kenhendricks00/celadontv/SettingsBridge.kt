package io.github.kenhendricks00.celadontv

import android.webkit.JavascriptInterface

/**
 * Implements `window.CeladonTVNative`, used by the CeladonTV row on Twitch's settings
 * page. It takes nothing from the page; called on a WebView binder thread.
 */
class SettingsBridge(private val onOpenSettings: () -> Unit) {
    @JavascriptInterface
    fun openSettings() = onOpenSettings()

    companion object {
        const val JS_NAME = "CeladonTVNative"
    }
}
