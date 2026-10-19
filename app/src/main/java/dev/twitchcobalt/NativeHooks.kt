package dev.twitchcobalt

import android.webkit.JavascriptInterface

/**
 * Implements `window.androidTvNativeHooks`, the bridge Starshot calls when it runs
 * inside Twitch's own Android TV app. Methods are invoked on a WebView binder thread.
 */
class NativeHooks(private val onCloseRequested: () -> Unit) {
    /** Called when Back is pressed on Starshot's home screen. */
    @JavascriptInterface
    fun requestNativeAppClose() = onCloseRequested()

    // Starshot calls these whenever the bridge exists. WebView already keeps the screen
    // on during playback, so there is nothing to do with them.
    @JavascriptInterface
    fun videoPlayerStateChanged(state: String?) = Unit

    @JavascriptInterface
    fun setPlaybackPosition(state: String?, position: Double) = Unit

    companion object {
        const val JS_NAME = "androidTvNativeHooks"
    }
}
