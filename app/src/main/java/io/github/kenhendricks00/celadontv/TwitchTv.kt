package io.github.kenhendricks00.celadontv

import android.view.KeyEvent

/**
 * Twitch's 10-foot web client ("Starshot"), the same app the official Android TV client
 * hosts in a WebView. Starshot picks its platform from the first hostname label, and
 * "celadon" is the Android TV codename (android.tv.twitch.tv runs as the generic web build).
 */
object TwitchTv {
    const val ORIGIN = "https://celadon.tv.twitch.tv"
    const val HOME_URL = "$ORIGIN/"

    val BACK_SCRIPT = keydownScript("Escape", 27)

    /**
     * Starshot's Android TV input layer maps DOM keydown events to intents (Escape is
     * back, PlayTV is play, ...). WebView doesn't deliver Back or media keys to the page
     * in that form, so they are forwarded as synthetic keydowns.
     */
    fun mediaKeyScript(keyCode: Int): String? = when (keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY -> keydownScript(PLAY)
        KeyEvent.KEYCODE_MEDIA_PAUSE -> keydownScript(PAUSE)
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK ->
            keydownScript("(v => v && !v.paused)(document.querySelector('video')) ? $PAUSE : $PLAY")
        KeyEvent.KEYCODE_MEDIA_STOP -> keydownScript(keyInit("MediaStop", 413))
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> keydownScript(keyInit("NextTV", 417))
        KeyEvent.KEYCODE_MEDIA_REWIND -> keydownScript(keyInit("PrevTV", 412))
        else -> null
    }

    private val PLAY = keyInit("PlayTV", 415)
    private val PAUSE = keyInit("PauseTV", 19)

    private fun keyInit(key: String, keyCode: Int) = "{key: '$key', keyCode: $keyCode, bubbles: true}"

    private fun keydownScript(init: String) = "document.dispatchEvent(new KeyboardEvent('keydown', $init));"

    private fun keydownScript(key: String, keyCode: Int) = keydownScript(keyInit(key, keyCode))
}
