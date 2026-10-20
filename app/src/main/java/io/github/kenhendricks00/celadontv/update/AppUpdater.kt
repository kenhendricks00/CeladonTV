package io.github.kenhendricks00.celadontv.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.FileProvider
import io.github.kenhendricks00.celadontv.BuildConfig
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Finds, downloads, verifies, and hands newer CeladonTV releases to the system installer. */
class AppUpdater(private val context: Context) {

    sealed interface Check {
        data class Available(val release: Release) : Check
        data class UpToDate(val latest: SemVer?) : Check
    }

    private val updatesDir = File(context.cacheDir, "updates")
    val apkFile = File(updatesDir, Release.ASSET_NAME)

    fun check(): Check {
        val installed = checkNotNull(SemVer.parse(BuildConfig.VERSION_NAME)) { "Unparseable versionName ${BuildConfig.VERSION_NAME}" }
        val release = Release.fromGitHubJson(fetchLatestJson()) ?: return Check.UpToDate(null)
        return if (release.version > installed) Check.Available(release) else Check.UpToDate(release.version)
    }

    fun download(release: Release, isCancelled: () -> Boolean, onProgress: (Long) -> Unit): File {
        deleteDownloads()
        ApkDownload.download(release.apk, apkFile, isCancelled, onProgress)
        try {
            verify(apkFile)
        } catch (e: Exception) {
            apkFile.delete()
            throw e
        }
        return apkFile
    }

    /** The APK must be this app, not a downgrade Android would refuse, and signed by exactly the installed app's certificates. */
    fun verify(apk: File) {
        val pm = context.packageManager
        val archive = pm.getPackageArchiveInfo(apk.path, signingFlags())
            ?: throw IOException("The downloaded file isn't a valid APK")
        if (archive.packageName != context.packageName) throw IOException("The download is a different app (${archive.packageName})")
        val installed = pm.getPackageInfo(context.packageName, signingFlags())
        if (versionCode(archive) < versionCode(installed)) throw IOException("The download has an older version code than the installed app")
        val expected = signerDigests(installed)
        if (expected.isEmpty() || signerDigests(archive) != expected) {
            throw IOException("The download isn't signed with the same key as the installed app")
        }
    }

    fun canInstallPackages(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    fun installIntent(apk: File): Intent =
        Intent(Intent.ACTION_VIEW)
            .setDataAndType(FileProvider.getUriForFile(context, "${context.packageName}.updates", apk), APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)

    fun deleteDownloads() {
        updatesDir.listFiles()?.forEach(File::delete)
    }

    private fun fetchLatestJson(): String {
        val connection = URL(LATEST_RELEASE_API).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("Accept", "application/vnd.github+json")
            connection.setRequestProperty("User-Agent", "CeladonTV/${BuildConfig.VERSION_NAME}")
            val code = connection.responseCode
            if (code == HttpURLConnection.HTTP_NOT_FOUND) return "{}"
            if (code != HttpURLConnection.HTTP_OK) throw IOException("GitHub returned HTTP $code")
            return connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        } finally {
            connection.disconnect()
        }
    }

    @Suppress("DEPRECATION")
    private fun signingFlags() =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    @Suppress("DEPRECATION")
    private fun signerDigests(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.signingInfo?.apkContentsSigners else info.signatures
        return signatures.orEmpty().map { sig ->
            MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }
        }.toSet()
    }

    @Suppress("DEPRECATION")
    private fun versionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

    companion object {
        private const val LATEST_RELEASE_API = "https://api.github.com/repos/kenhendricks00/CeladonTV/releases/latest"
        private const val APK_MIME = "application/vnd.android.package-archive"
    }
}
