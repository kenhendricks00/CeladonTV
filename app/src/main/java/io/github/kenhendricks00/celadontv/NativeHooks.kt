package io.github.kenhendricks00.celadontv

import android.webkit.JavascriptInterface

/**
 * Implements `window.androidTvNativeHooks`, the bridge Starshot calls when it runs
 * inside Twitch's own Android TV app. Methods are invoked on a WebView binder thread.
 */
class NativeHooks(private val onCloseRequested: () -> Unit) {
    /** Called when Back is pressed on Starshot's home screen. */
    @JavascriptInterface
    fun requestNativeAppClose() = onCloseRequested()

    /**
     * Called after a sign-in, with the new auth token, before Starshot leaves the login page.
     * Twitch's own app stores the token natively; CeladonTV doesn't need it (the page keeps
     * its own session), but the method must exist: without it Starshot's call throws, which
     * leaves the login page on "Looks like something went wrong" after every sign-in.
     */
    @JavascriptInterface
    fun loggedIn(token: String?, extra: String?) = Unit

    /** Called on sign-out, before Starshot reloads its home page. Missing, it would throw too. */
    @JavascriptInterface
    fun loggedOut() = Unit

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
