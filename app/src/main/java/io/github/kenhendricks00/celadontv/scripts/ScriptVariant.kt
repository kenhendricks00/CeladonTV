package io.github.kenhendricks00.celadontv.scripts

private const val UPSTREAM = "https://raw.githubusercontent.com/ryanbr/TwitchAdSolutions/master"

enum class ScriptVariant(val key: String, val fileName: String, val updateUrl: String) {
    VAFT("vaft", "vaft.user.js", "$UPSTREAM/vaft/vaft.user.js"),
    VIDEO_SWAP_NEW("video-swap-new", "video-swap-new.user.js", "$UPSTREAM/video-swap-new/video-swap-new.user.js");

    companion object {
        val DEFAULT = VAFT

        fun fromKey(key: String?): ScriptVariant = entries.firstOrNull { it.key == key } ?: DEFAULT
    }
}
