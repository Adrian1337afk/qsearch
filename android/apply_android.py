#!/usr/bin/env python3
"""Turn a stock Firefox ESR tree into the qsearch Android tree.

Usage: python3 android/apply_android.py /path/to/firefox

Idempotent: every edit is skipped when it is already in place, and fails
loudly when the text it expects is no longer in the source.

The approach (BuildConfig switches, default prefs, resource overrides in the
Fenix tree) follows IronFox (https://gitlab.com/ironfox-oss/IronFox), the
Android counterpart of LibreWolf. No IronFox code is copied.
"""
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP_ID_BASE = "de.qdran"
APP_ID_SUFFIX = ".qsearch"
MARK = "qsearch"


def die(msg):
    sys.exit("apply_android: " + msg)


class Tree:
    def __init__(self, root):
        self.root = Path(root)
        if not (self.root / "mobile/android/fenix").is_dir():
            die(f"{root} is not a Firefox tree with mobile/android/fenix")
        self.changed = []

    def read(self, rel):
        return (self.root / rel).read_text(encoding="utf-8")

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.exists() and p.read_text(encoding="utf-8") == text:
            return
        p.write_text(text, encoding="utf-8", newline="\n")
        self.changed.append(rel)

    def replace(self, rel, old, new, count=1):
        """Replace `old` by `new`; no-op when `new` is already there."""
        text = self.read(rel)
        if new in text:
            return
        if old not in text:
            die(f"{rel}: expected text not found:\n{old}")
        if count and text.count(old) != count:
            die(f"{rel}: expected {count} match(es), found {text.count(old)}:\n{old}")
        self.write(rel, text.replace(old, new))

    def sub(self, rel, pattern, repl, flags=re.S, required=True):
        text = self.read(rel)
        new, n = re.subn(pattern, repl, text, flags=flags)
        if n == 0 and required and repl not in text:
            die(f"{rel}: pattern not found: {pattern}")
        self.write(rel, new)

    def append(self, rel, block):
        text = self.read(rel)
        if block.strip() in text:
            return
        self.write(rel, text.rstrip("\n") + "\n" + block)

    def copy(self, src, rel):
        dst = self.root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists() and dst.read_bytes() == Path(src).read_bytes():
            return
        shutil.copyfile(src, dst)
        self.changed.append(rel)


FENIX = "mobile/android/fenix/app"
SRC = FENIX + "/src/main/java/org/mozilla/fenix"
AC = "mobile/android/android-components/components"


def gecko(t):
    t.append("mobile/android/app/geckoview-prefs.js",
             (HERE / "geckoview-prefs.qsearch.js").read_text(encoding="utf-8"))
    shutil.copyfile(HERE / "mozconfig", t.root / "mozconfig")


QSEARCH_KT = '''/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.qsearch

import android.app.Activity
import android.content.Context
import mozilla.components.concept.engine.webextension.InstallationMethod
import org.mozilla.fenix.ext.components

/**
 * Switches and first-run behaviour that qsearch adds to Fenix.
 */
object QSearch {
    /** Telemetry upload. Never on. */
    val TELEMETRY: Boolean = false

    /** Stories and sponsored stories on the home screen. */
    val POCKET: Boolean = false

    /** The first-run cards (sign in, notifications, terms of use). */
    val ONBOARDING: Boolean = false

    /** The "terms of use" bottom sheet. */
    val TERMS_PROMPT: Boolean = false

    const val UBLOCK_XPI = "https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi"
    private const val PREFS = "qsearch"
    private const val UBLOCK_OFFERED = "ublock_offered"
    private const val OFFER_DELAY_MS = 4000L

    /**
     * Offers uBlock Origin once: the normal add-on permission prompt appears
     * shortly after the first start. Asked again on the next start only when
     * the download failed (for example no network).
     */
    fun offerUblockOnce(activity: Activity) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean(UBLOCK_OFFERED, false)) {
            return
        }
        activity.window.decorView.postDelayed(
            {
                if (!activity.isFinishing && !activity.isDestroyed) {
                    activity.components.core.engine.installWebExtension(
                        url = UBLOCK_XPI,
                        installationMethod = InstallationMethod.MANAGER,
                        onSuccess = { prefs.edit().putBoolean(UBLOCK_OFFERED, true).apply() },
                        onError = { error ->
                            if (error::class.simpleName == "UserCancelled") {
                                prefs.edit().putBoolean(UBLOCK_OFFERED, true).apply()
                            }
                        },
                    )
                }
            },
            OFFER_DELAY_MS,
        )
    }
}
'''

IMPORT_QSEARCH = "import org.mozilla.fenix.qsearch.QSearch\n"


def add_import(t, rel, after):
    text = t.read(rel)
    if IMPORT_QSEARCH in text:
        return
    if after not in text:
        die(f"{rel}: import anchor not found: {after}")
    t.write(rel, text.replace(after, after + IMPORT_QSEARCH, 1))


def step_10_identity(t):
    g = FENIX + "/build.gradle"
    t.replace(g, 'applicationId "org.mozilla"', f'applicationId "{APP_ID_BASE}"')
    t.replace(g,
              'applicationIdSuffix ".firefox"\n            def deepLinkSchemeValue = "fenix"',
              f'applicationIdSuffix "{APP_ID_SUFFIX}"\n            def deepLinkSchemeValue = "qsearch"')
    # Firefox shares a Linux user id with its old releases; qsearch must not.
    text = t.read(g)
    text = text.replace('                    "sharedUserId": "org.mozilla.firefox.sharedID",\n', "")
    t.write(g, text)
    for bt in ("release", "beta"):
        m = f"{FENIX}/src/{bt}/AndroidManifest.xml"
        t.replace(m,
                  '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n'
                  '    android:sharedUserId="${sharedUserId}">',
                  '<manifest xmlns:android="http://schemas.android.com/apk/res/android">')
    t.replace(g,
              "    buildConfigField 'boolean', 'CRASH_REPORTING', 'true'\n"
              "    buildConfigField 'boolean', 'TELEMETRY', 'true'",
              "    buildConfigField 'boolean', 'CRASH_REPORTING', 'false'\n"
              "    buildConfigField 'boolean', 'TELEMETRY', 'false'")


def step_20_strings(t):
    """Product name in every locale. "Mozilla" stays where it names
    Mozilla's own services (account, add-ons site)."""
    for base in (FENIX + "/src", AC):
        for p in (t.root / base).rglob("res/values*/*strings.xml"):
            rel = p.relative_to(t.root).as_posix()
            if "/src/test" in rel or "/androidTest/" in rel:
                continue
            text = p.read_text(encoding="utf-8")
            new = re.sub(r"Firefox(?![A-Za-z_])", "qsearch", text)
            new = new.replace(">qsearch Fenix<", ">qsearch<")
            if new != text:
                t.write(rel, new)


def step_30_privacy(t):
    t.write(SRC + "/qsearch/QSearch.kt", QSEARCH_KT)
    s = SRC + "/utils/Settings.kt"
    key = "appContext.getPreferenceKey(R.string.%s),\n        %s,\n"
    for pref, old, new in (
        ("pref_key_telemetry", "default = true", "default = false"),
        ("pref_key_https_only", "default = false", "default = true"),
        ("pref_key_tracking_protection_standard_option", "true", "false"),
        ("pref_key_tracking_protection_strict_default", "false", "true"),
        ("pref_key_privacy_enable_global_privacy_control", "false", "true"),
    ):
        t.replace(s, key % (pref, old), key % (pref, new))
    t.replace(s,
              "key = appContext.getPreferenceKey(R.string.pref_key_enable_contile),\n        default = true,",
              "key = appContext.getPreferenceKey(R.string.pref_key_enable_contile),\n        default = false,")
    t.replace(s,
              "val shouldShowByDefaultConditions = featureEnabled && !hasUserBeenOnboarded",
              "val shouldShowByDefaultConditions = QSearch.ONBOARDING && featureEnabled && !hasUserBeenOnboarded")
    add_import(t, s, "import org.mozilla.fenix.nimbus.FxNimbus\n")

    x = FENIX + "/src/main/res/xml/tracking_protection_preferences.xml"
    for pref, old, new in (("standard_option", "true", "false"), ("strict_default", "false", "true")):
        tail = ('\n        android:dependency="@string/pref_key_tracking_protection"'
                f'\n        android:key="@string/pref_key_tracking_protection_{pref}"')
        t.replace(x, f'android:defaultValue="{old}"' + tail, f'android:defaultValue="{new}"' + tail)

    p = SRC + "/home/pocket/ContentRecommendationsFeatureHelper.kt"
    t.replace(p,
              "        return CONTENT_RECOMMENDATIONS_SUPPORTED_LOCALE.contains(langTag)",
              "        return QSearch.POCKET && CONTENT_RECOMMENDATIONS_SUPPORTED_LOCALE.contains(langTag)")
    add_import(t, p, "import mozilla.components.support.locale.LocaleManager\n")

    r = SRC + "/termsofuse/store/TermsOfUsePromptRepository.kt"
    t.replace(r,
              "        !settings.hasAcceptedTermsOfService &&",
              "        QSearch.TERMS_PROMPT && !settings.hasAcceptedTermsOfService &&")
    add_import(t, r, "import org.mozilla.fenix.utils.Settings\n")

    gl = SRC + "/components/GleanHelper.kt"
    t.replace(gl,
              "        uploadEnabled = isTelemetryUploadEnabled,",
              "        uploadEnabled = QSearch.TELEMETRY && isTelemetryUploadEnabled,")
    add_import(t, gl, "import org.mozilla.fenix.nimbus.FxNimbus\n")

    h = SRC + "/HomeActivity.kt"
    anchor = "        StartupTimeline.onActivityCreateEndHome(this) // DO NOT MOVE ANYTHING BELOW HERE."
    t.replace(h, anchor, "        QSearch.offerUblockOnce(this)\n" + anchor)
    add_import(t, h, "import org.mozilla.fenix.ext.components\n")


def step_40_search(t):
    m = AC + "/feature/search/src/main/java/mozilla/components/feature/search/middleware/SearchMiddleware.kt"
    t.replace(m,
              "            regionDefaultSearchEngineId = regionBundle.await().defaultSearchEngineId,",
              "            // qsearch: DuckDuckGo is the default engine wherever it is offered.\n"
              "            regionDefaultSearchEngineId = filteredRegionSearchEngines\n"
              '                .firstOrNull { it.id == "ddg" || it.name == "DuckDuckGo" }?.id\n'
              "                ?: regionBundle.await().defaultSearchEngineId,")


def step_50_icons(t):
    import make_android_icons
    make_android_icons.run(t, HERE.parent / "branding")


def main():
    if len(sys.argv) != 2:
        die("usage: apply_android.py /path/to/firefox")
    t = Tree(sys.argv[1])
    steps = [gecko]
    steps += [f for name, f in sorted(globals().items())
              if name.startswith("step_") and callable(f)]
    for step in steps:
        step(t)
    print(f"apply_android: {len(t.changed)} file(s) changed")
    for rel in t.changed:
        print("  " + rel)


if __name__ == "__main__":
    main()
