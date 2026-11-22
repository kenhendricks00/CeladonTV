package io.github.kenhendricks00.celadontv.settings

import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.EditTextPreference
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import io.github.kenhendricks00.celadontv.AdBlock
import io.github.kenhendricks00.celadontv.BuildConfig
import io.github.kenhendricks00.celadontv.R
import io.github.kenhendricks00.celadontv.diagnostics.Diagnostics
import io.github.kenhendricks00.celadontv.scripts.ScriptUpdater.Outcome
import io.github.kenhendricks00.celadontv.scripts.ScriptVariant
import io.github.kenhendricks00.celadontv.update.AppUpdateFlow

class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction().replace(android.R.id.content, SettingsFragment()).commit()
        }
    }

    class SettingsFragment : PreferenceFragmentCompat() {
        private val updateNow get() = requirePreference(AppSettings.KEY_UPDATE_NOW)
        private val appUpdates by lazy { AppUpdateFlow(requireActivity()) }

        override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
            setPreferencesFromResource(R.xml.preferences, rootKey)
            updateNow.setOnPreferenceClickListener { runUpdate(); true }
            requirePreference(KEY_SUPPORT).setOnPreferenceClickListener { showSupport(); true }
            requirePreference(KEY_LICENSES).setOnPreferenceClickListener { showLicenses(); true }
            requirePreference(AppSettings.KEY_SAVE_DIAGNOSTICS).setOnPreferenceClickListener { saveDiagnostics(); true }
            requirePreference(AppSettings.KEY_DIAGNOSTICS).setOnPreferenceChangeListener { _, enabled ->
                if (enabled == false) Diagnostics.log(requireContext()).clear()
                true
            }
            requirePreference(AppSettings.KEY_CHECK_APP_UPDATE).apply {
                summary = getString(R.string.pref_check_app_update_summary, BuildConfig.VERSION_NAME)
                setOnPreferenceClickListener { appUpdates.checkNow(); true }
            }
            listOf(AppSettings.KEY_CHAT_HIDDEN_WORDS, AppSettings.KEY_CHAT_HIDDEN_USERS).forEach(::showHiddenList)
            showVersions()
        }

        /** A hidden words or users field shows its entries, tidied, or "None". */
        private fun showHiddenList(key: String) {
            val field = checkNotNull(findPreference<EditTextPreference>(key)) { "Missing preference $key" }
            field.setSummaryProvider {
                AppSettings.splitList((it as EditTextPreference).text).joinToString(", ").ifEmpty { getString(R.string.pref_chat_hidden_none) }
            }
            field.setOnBindEditTextListener { it.setSingleLine(true) }
        }

        override fun onResume() {
            super.onResume()
            appUpdates.onResume()
        }

        private fun showVersions() {
            val store = AdBlock.store(requireContext())
            updateNow.summary = ScriptVariant.entries.joinToString("   ") { "${it.key} ${store.load(it).version}" }
        }

        private fun runUpdate() {
            updateNow.isEnabled = false
            updateNow.summary = getString(R.string.pref_update_now_running)
            AdBlock.update(requireContext()) { outcomes ->
                activity?.runOnUiThread {
                    if (!isAdded) return@runOnUiThread
                    updateNow.isEnabled = true
                    showVersions()
                    Toast.makeText(requireContext(), describe(outcomes), Toast.LENGTH_LONG).show()
                }
            }
        }

        private fun describe(outcomes: Map<ScriptVariant, Outcome>) = outcomes.entries.joinToString("\n") { (variant, outcome) ->
            when (outcome) {
                is Outcome.Updated -> getString(R.string.update_updated, variant.key, outcome.version)
                is Outcome.UpToDate -> getString(R.string.update_up_to_date, variant.key, outcome.version)
                is Outcome.Failed -> getString(R.string.update_failed, variant.key, outcome.error.message)
            }
        }

        private fun saveDiagnostics() {
            val message = try {
                Diagnostics.save(requireContext())?.let { getString(R.string.diagnostics_saved, it) } ?: getString(R.string.diagnostics_empty)
            } catch (e: Exception) {
                getString(R.string.diagnostics_failed, e.message)
            }
            Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show()
        }

        /** TVs rarely have a usable browser, so the donation pages are shown as QR codes to scan. */
        private fun showSupport() {
            val body = layoutInflater.inflate(R.layout.dialog_support, null)
            fun bind(id: Int, code: Int, name: Int, url: Int) = body.findViewById<View>(id).apply {
                findViewById<ImageView>(R.id.support_code).setImageResource(code)
                findViewById<TextView>(R.id.support_name).setText(name)
                findViewById<TextView>(R.id.support_url).setText(url)
            }
            bind(R.id.support_kofi, R.drawable.donate_qr_kofi, R.string.donate_kofi, R.string.donate_kofi_url)
            bind(R.id.support_bmac, R.drawable.donate_qr_bmac, R.string.donate_bmac, R.string.donate_bmac_url)
            AlertDialog.Builder(requireContext())
                .setTitle(R.string.pref_support)
                .setView(body)
                .setPositiveButton(R.string.support_close, null)
                .show()
        }

        private fun showLicenses() {
            val text = requireContext().assets.open("scripts/LICENSE-TwitchAdSolutions.txt").bufferedReader().use { it.readText() }
            AlertDialog.Builder(requireContext())
                .setTitle(R.string.pref_licenses)
                .setMessage(text)
                .setPositiveButton(android.R.string.ok, null)
                .show()
        }

        private fun requirePreference(key: String): Preference = checkNotNull(findPreference(key)) { "Missing preference $key" }

        private companion object {
            const val KEY_SUPPORT = "support"
            const val KEY_LICENSES = "licenses"
        }
    }
}
