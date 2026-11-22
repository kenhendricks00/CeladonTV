package io.github.kenhendricks00.celadontv

import android.webkit.JavascriptInterface
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeHooksTest {
    /**
     * Every `window.androidTvNativeHooks` method Starshot's Android TV build calls, with its
     * argument count. A missing one throws in the page: `loggedIn` missing left every first
     * sign-in on Twitch's "something went wrong" screen.
     */
    private val calledByStarshot = mapOf(
        "requestNativeAppClose" to 0,
        "loggedIn" to 2,
        "loggedOut" to 0,
        "videoPlayerStateChanged" to 1,
        "setPlaybackPosition" to 2,
    )

    @Test
    fun exposesEveryMethodStarshotCalls() {
        val exposed = NativeHooks::class.java.methods.filter { it.isAnnotationPresent(JavascriptInterface::class.java) }
        for ((name, arity) in calledByStarshot) {
            val method = exposed.singleOrNull { it.name == name }
            assertTrue("androidTvNativeHooks.$name is not exposed to the page", method != null)
            assertEquals("androidTvNativeHooks.$name argument count", arity, method!!.parameterCount)
        }
    }

    @Test
    fun signingInAndOutDoNothingNatively() {
        var closed = false
        val hooks = NativeHooks(onCloseRequested = { closed = true })
        hooks.loggedIn("token", "")
        hooks.loggedIn(null, null)
        hooks.loggedOut()
        assertTrue("signing in or out never closes the app", !closed)
    }
}
