package io.github.kenhendricks00.celadontv.scripts

data class UserScript(val name: String, val version: String, val source: String) {
    companion object {
        private val HEADER = Regex("""//\s*==UserScript==(.*?)//\s*==/UserScript==""", RegexOption.DOT_MATCHES_ALL)

        fun parse(source: String): UserScript? {
            val header = HEADER.find(source)?.groupValues?.get(1) ?: return null
            val name = header.metaValue("name") ?: return null
            val version = header.metaValue("version") ?: return null
            return UserScript(name, version, source)
        }

        private fun String.metaValue(key: String): String? =
            Regex("""@$key\s+(.+)""").find(this)?.groupValues?.get(1)?.trim()
    }
}

fun compareVersions(a: String, b: String): Int {
    val left = a.split('.').map { it.toIntOrNull() ?: 0 }
    val right = b.split('.').map { it.toIntOrNull() ?: 0 }
    for (i in 0 until maxOf(left.size, right.size)) {
        val diff = left.getOrElse(i) { 0 }.compareTo(right.getOrElse(i) { 0 })
        if (diff != 0) return diff
    }
    return 0
}
