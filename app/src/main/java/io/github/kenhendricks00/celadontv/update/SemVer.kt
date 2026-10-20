package io.github.kenhendricks00.celadontv.update

/** A semantic version (semver.org 2.0.0). A leading "v" is accepted; build metadata is ignored. */
class SemVer private constructor(private val core: List<Int>, private val preRelease: List<String>) : Comparable<SemVer> {

    override fun compareTo(other: SemVer): Int {
        for (i in core.indices) {
            val diff = core[i].compareTo(other.core[i])
            if (diff != 0) return diff
        }
        if (preRelease.isEmpty() || other.preRelease.isEmpty()) return other.preRelease.size.coerceAtMost(1) - preRelease.size.coerceAtMost(1)
        for (i in 0 until minOf(preRelease.size, other.preRelease.size)) {
            val diff = compareIdentifiers(preRelease[i], other.preRelease[i])
            if (diff != 0) return diff
        }
        return preRelease.size.compareTo(other.preRelease.size)
    }

    override fun equals(other: Any?) = other is SemVer && core == other.core && preRelease == other.preRelease

    override fun hashCode() = 31 * core.hashCode() + preRelease.hashCode()

    override fun toString() = core.joinToString(".") + if (preRelease.isEmpty()) "" else "-" + preRelease.joinToString(".")

    companion object {
        private val PATTERN = Regex(
            """^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)""" +
                """(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?""" +
                """(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$""",
        )

        fun parse(text: String): SemVer? {
            val match = PATTERN.matchEntire(text.trim()) ?: return null
            val core = match.groupValues.subList(1, 4).map { it.toIntOrNull() ?: return null }
            val preRelease = match.groupValues[4].takeIf { it.isNotEmpty() }?.split('.') ?: emptyList()
            return SemVer(core, preRelease)
        }

        private fun compareIdentifiers(a: String, b: String): Int {
            val numA = a.toBigIntegerOrNull()
            val numB = b.toBigIntegerOrNull()
            return when {
                numA != null && numB != null -> numA.compareTo(numB)
                numA != null -> -1
                numB != null -> 1
                else -> a.compareTo(b)
            }
        }
    }
}
