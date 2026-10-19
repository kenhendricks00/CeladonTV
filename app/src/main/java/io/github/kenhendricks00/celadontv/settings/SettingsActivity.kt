package io.github.kenhendricks00.celadontv.settings

import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import io.github.kenhendricks00.celadontv.AdBlock
import io.github.kenhendricks00.celadontv.R
import io.github.kenhendricks00.celadontv.scripts.ScriptUpdater.Outcome
import io.github.kenhendricks00.celadontv.scripts.ScriptVariant

class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction().replace(android.R.id.content, SettingsFragment()).commit()
        }
    }

    class SettingsFragment : PreferenceFragmentCompat() {
        private val updateNow get() = requirePreference(AppSettings.KEY_UPDATE_NOW)

        override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
            setPreferencesFromResource(R.xml.preferences, rootKey)
            updateNow.setOnPreferenceClickListener { runUpdate(); true }
            requirePreference(KEY_LICENSES).setOnPreferenceClickListener { showLicenses(); true }
            showVersions()
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
            const val KEY_LICENSES = "licenses"
        }
    }
}
