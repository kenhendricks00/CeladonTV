package io.github.kenhendricks00.celadontv.update

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.DialogInterface
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.widget.ProgressBar
import android.widget.Toast
import androidx.annotation.RequiresApi
import androidx.appcompat.app.AlertDialog
import io.github.kenhendricks00.celadontv.R
import io.github.kenhendricks00.celadontv.settings.AppSettings
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** The D-pad update UI: check, ask, download with progress, verify, then hand off to the system installer. */
class AppUpdateFlow(private val activity: Activity) {
    private val updater = AppUpdater(activity.applicationContext)
    private val settings = AppSettings(activity)
    private var pendingInstall: File? = null
    private var busy = false

    /** Removes any APK left by an earlier update, then runs a silent check at most once a day if enabled. */
    fun checkIfDue() {
        if (pendingInstall == null) updater.deleteDownloads()
        if (!settings.appUpdateCheck || System.currentTimeMillis() - settings.lastAppUpdateCheck < CHECK_INTERVAL_MS) return
        check(quiet = true)
    }

    fun checkNow() = check(quiet = false)

    /** Retries an install that was waiting for permission to install unknown apps. */
    fun onResume() {
        val apk = pendingInstall ?: return
        if (!updater.canInstallPackages()) return
        pendingInstall = null
        launchInstaller(apk)
    }

    private fun check(quiet: Boolean) {
        if (busy) return
        busy = true
        updater.deleteDownloads()
        if (!quiet) toast(R.string.app_update_checking)
        executor.execute {
            val result = runCatching { updater.check() }
            settings.lastAppUpdateCheck = System.currentTimeMillis()
            ui {
                busy = false
                result.onSuccess { check ->
                    when (check) {
                        is AppUpdater.Check.Available -> offer(check.release)
                        is AppUpdater.Check.UpToDate -> if (!quiet) toast(R.string.app_update_up_to_date)
                    }
                }.onFailure {
                    Log.w(TAG, "Update check failed", it)
                    if (!quiet) toast(R.string.app_update_check_failed)
                }
            }
        }
    }

    private fun offer(release: Release) {
        val notes = Release.notesExcerpt(release.notes)
        val dialog = AlertDialog.Builder(activity)
            .setTitle(activity.getString(R.string.app_update_available, release.version.toString()))
            .setMessage(notes.ifEmpty { activity.getString(R.string.app_update_no_notes) })
            .setPositiveButton(R.string.app_update_update) { _, _ -> download(release) }
            .setNegativeButton(R.string.app_update_later, null)
            .show()
        dialog.getButton(DialogInterface.BUTTON_POSITIVE).requestFocus()
    }

    private fun download(release: Release) {
        busy = true
        var cancelled = false
        val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            val padding = (24 * resources.displayMetrics.density).toInt()
            setPadding(padding, padding / 2, padding, 0)
        }
        val dialog = AlertDialog.Builder(activity)
            .setTitle(activity.getString(R.string.app_update_downloading, release.version.toString()))
            .setView(progress)
            .setCancelable(false)
            .setNegativeButton(android.R.string.cancel) { _, _ -> cancelled = true }
            .show()
        executor.execute {
            val result = runCatching {
                updater.download(release, isCancelled = { cancelled }) { bytes ->
                    ui { progress.progress = (bytes * 100 / release.apk.size).toInt() }
                }
            }
            ui {
                busy = false
                if (dialog.isShowing) dialog.dismiss()
                result.onSuccess(::install).onFailure {
                    if (it is ApkDownload.CancelledException) return@onFailure
                    Log.w(TAG, "Update download failed", it)
                    error(activity.getString(R.string.app_update_failed, it.message ?: it.javaClass.simpleName))
                }
            }
        }
    }

    private fun install(apk: File) {
        if (updater.canInstallPackages() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return launchInstaller(apk)
        pendingInstall = apk
        AlertDialog.Builder(activity)
            .setTitle(R.string.app_update_permission_title)
            .setMessage(R.string.app_update_permission_message)
            .setPositiveButton(R.string.app_update_open_settings) { _, _ ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) openUnknownSourcesSettings()
            }
            .setNegativeButton(R.string.app_update_later) { _, _ ->
                pendingInstall = null
                updater.deleteDownloads()
            }
            .show()
            .getButton(DialogInterface.BUTTON_POSITIVE).requestFocus()
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun openUnknownSourcesSettings() {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
        try {
            activity.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            pendingInstall = null
            updater.deleteDownloads()
            error(activity.getString(R.string.app_update_permission_manual))
        }
    }

    private fun launchInstaller(apk: File) {
        try {
            activity.startActivity(updater.installIntent(apk))
        } catch (e: ActivityNotFoundException) {
            updater.deleteDownloads()
            error(activity.getString(R.string.app_update_failed, e.message ?: "no installer"))
        }
    }

    private fun error(message: String) {
        if (activity.isFinishing || activity.isDestroyed) return
        AlertDialog.Builder(activity)
            .setTitle(R.string.app_update_failed_title)
            .setMessage(message)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun toast(message: Int) = Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()

    private fun ui(block: () -> Unit) = activity.runOnUiThread {
        if (!activity.isFinishing && !activity.isDestroyed) block()
    }

    private companion object {
        const val TAG = "AppUpdate"
        val CHECK_INTERVAL_MS = TimeUnit.HOURS.toMillis(24)
        val executor = Executors.newSingleThreadExecutor()
    }
}
