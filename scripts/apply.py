"""Turn a Firefox ESR source tree into the qsearch source tree.

Usage: python apply.py <firefox_source_dir> <librewolf_settings_dir>

Steps (all idempotent, safe to run again):
  1. generate browser/branding/qsearch          (make_branding.py)
  2. copy overlay/ into the tree                (new files only)
  3. write qsearch/qsearch.cfg, policies.json, local-settings.js
  4. make the small edits that hook the new files into the build
  5. write the mozconfig

LibreWolf patches (patches/librewolf-patches.txt) are applied separately,
once, with `patch -p1`.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def insert_after(path: Path, anchor: str, new: str, *, last: bool = False) -> None:
    """Insert `new` as a line after the first (or last) line containing `anchor`."""
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    lines = text.split("\n")
    hits = [i for i, line in enumerate(lines) if anchor in line]
    if not hits:
        raise SystemExit(f"anchor {anchor!r} not found in {path}")
    at = hits[-1] if last else hits[0]
    lines.insert(at + 1, new)
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print("edited", path)


# "Firefox" is hardcoded in many UI strings (the brand terms only cover some).
# Real Mozilla services and other Firefox editions keep their names.
KEEP_AFTER = (
    r"Relay|Monitor|Profiler|Focus|Send|Nightly|Beta|Developer|Accounts?|Color|"
    r"Lockwise|Private Network|ESR|for (?:Android|iOS|mobile)"
)
FIREFOX_RE = re.compile(rf"(?:Mozilla )?\bFirefox\b(?! (?:{KEEP_AFTER}))")

# Fox / Firefox artwork shown in the UI, replaced by the qsearch logo.
ARTWORK = [
    "toolkit/themes/shared/illustrations/kit-happy.svg",
    "toolkit/themes/shared/illustrations/kit-concerned.svg",
    "toolkit/themes/shared/illustrations/kit-in-circle.svg",
    "browser/themes/shared/sidebar/firefox.svg",
    "browser/themes/shared/sidebar/foxy.svg",
    "browser/themes/shared/preferences/fox-ai.svg",
    "browser/themes/shared/fxa/avatar-fox.svg",
    "browser/themes/shared/fxa/avatar-fox-circle.svg",
    "browser/themes/shared/icons/window-firefox.svg",
    "browser/components/controlcenter/content/assets/fox-concern.svg",
    "browser/components/asrouter/content/assets/smiling-fox-icon.svg",
    "browser/extensions/newtab/data/content/assets/firefox.svg",
    "browser/extensions/newtab/data/content/assets/kit-in-circle.svg",
    "browser/extensions/newtab/data/content/assets/puzzle-fox.svg",
]


def rename_firefox_strings(src: Path) -> None:
    """Replace hardcoded "Firefox" with "qsearch" in all en-US UI strings."""
    changed = 0
    for path in src.rglob("*"):
        if path.suffix not in (".ftl", ".properties", ".dtd"):
            continue
        posix = path.as_posix()
        if "/locales/en-US/" not in posix or "/.git/" in posix:
            continue
        text = path.read_text(encoding="utf-8")
        if "Firefox" not in text:
            continue
        out = []
        for line in text.split("\n"):
            stripped = line.lstrip()
            is_comment = stripped.startswith(("#", "<!--"))
            if is_comment or "http" in line or "Firefox" not in line:
                out.append(line)
            elif path.suffix == ".properties" and "=" in line:
                key, value = line.split("=", 1)
                out.append(key + "=" + FIREFOX_RE.sub("qsearch", value))
            else:
                out.append(FIREFOX_RE.sub("qsearch", line))
        new = "\n".join(out)
        if new != text:
            path.write_text(new, encoding="utf-8", newline="\n")
            changed += 1
    print(f"renamed Firefox -> qsearch in {changed} string files")


# Incognito (private browsing) artwork: the logo in purple.
PRIVATE_ARTWORK = [
    "browser/themes/shared/privatebrowsing/favicon.svg",
    "browser/themes/shared/privatebrowsing/fox-tail.svg",
    "browser/themes/shared/privatebrowsing/pbm-logo.svg",
]


def replace_artwork(src: Path) -> None:
    private_logo = ROOT / "branding" / "logo-private.svg"
    for rel in PRIVATE_ARTWORK:
        if (src / rel).exists():
            shutil.copyfile(private_logo, src / rel)
        else:
            print("artwork not found, skipped:", rel)
    logo = ROOT / "branding" / "logo.svg"
    for rel in ARTWORK:
        target = src / rel
        if target.exists():
            shutil.copyfile(logo, target)
        else:
            print("artwork not found, skipped:", rel)


def main() -> None:
    src = Path(sys.argv[1]).resolve()
    lw_settings = Path(sys.argv[2]).resolve()

    # 1. branding
    subprocess.check_call([sys.executable, str(HERE / "make_branding.py"), str(src)])

    # 2. overlay
    shutil.copytree(ROOT / "overlay", src, dirs_exist_ok=True)

    # 3. config files
    cfg_dir = src / "qsearch"
    base_cfg = (lw_settings / "librewolf.cfg").read_text(encoding="utf-8")
    extra_cfg = (ROOT / "config" / "qsearch-extra.cfg").read_text(encoding="utf-8")
    (cfg_dir / "qsearch.cfg").write_text(base_cfg + extra_cfg, encoding="utf-8", newline="\n")
    shutil.copyfile(ROOT / "config" / "policies.json", cfg_dir / "policies.json")
    shutil.copyfile(ROOT / "config" / "local-settings.js", cfg_dir / "local-settings.js")

    # 4. hooks
    insert_after(
        src / "browser/components/preferences/preferences.js",
        "// AboutPreferences.observe(), which only fires in the redesign path.",
        '''  if (redesignEnabled) {
    const { AboutPreferences } = ChromeUtils.importESModule(
      "resource://newtab/lib/AboutPreferences.sys.mjs"
    );
    new AboutPreferences().observe(window);
  }''',
    )
    insert_after(
        src / "browser/modules/AboutNewTab.sys.mjs",
        "  get newTabURL() {",
        '''    if ((!this._newTabURLOverridden ||
         this._newTabURL === "chrome://browser/content/qsearch/newtab.html") &&
        Services.prefs.getBoolPref("qsearch.newtab.enabled", true)) {
      return Services.prefs.getBoolPref("browser.newtabpage.enabled", true)
        ? "chrome://browser/content/qsearch/newtab.html"
        : "about:blank";
    }''',
    )
    home_settings = src / "browser/extensions/newtab/lib/AboutPreferences.sys.mjs"
    insert_after(
        home_settings,
        'case DEFAULT_HOMEPAGE_URL:',
        '            case "chrome://browser/content/qsearch/newtab.html":',
    )
    insert_after(
        home_settings,
        "_setupHomeGroup(window) {",
        '''    if (Services.prefs.getBoolPref("qsearch.newtab.enabled", true)) {
      const { Preferences } = window;
      const deps = ["homepageNewWindows", "homepageNewTabs"];
      const inactive = ({ homepageNewWindows, homepageNewTabs }) =>
        homepageNewWindows.value !== "home" && homepageNewTabs.value !== "home";
      Preferences.addSetting({
        id: "qsearchHomeDisabledNotice",
        deps,
        visible: inactive,
      });
      const items = [{
        id: "qsearchHomeDisabledNotice",
        control: "moz-message-bar",
        l10nId: "qsearch-home-disabled",
        controlAttrs: { type: "info" },
      }];
      for (const [name, type] of [
        ["search", "bool"], ["shortcuts", "bool"], ["shortcutRows", "int"],
        ["activity", "bool"], ["logo", "bool"], ["clock", "bool"], ["stats", "bool"],
      ]) {
        const pref = `qsearch.home.${name}`;
        const id = `qsearch-home-${name.toLowerCase()}`;
        Preferences.add({ id: pref, type });
        Preferences.addSetting({
          id,
          pref,
          deps,
          disabled: inactive,
        });
        items.push(type === "int" ? {
          id,
          l10nId: id,
          control: "moz-select",
          options: [1, 2, 3, 4].map(value => ({
            value,
            l10nId: "home-prefs-sections-rows-option-srd",
            l10nArgs: { num: value },
          })),
        } : { id, l10nId: id, control: "moz-toggle" });
      }
      return {
        headingLevel: 2,
        l10nId: "qsearch-home-title",
        iconSrc: "chrome://browser/skin/home.svg",
        subcategory: "contents",
        items,
      };
    }''',
    )
    home_text = home_settings.read_text(encoding="utf-8")
    home_text = home_text.replace(
        "this.store.getState()?.Prefs",
        "this.store?.getState()?.Prefs",
    )
    home_text = home_text.replace(
        "return DEFAULT_HOMEPAGE_URL;",
        'return Services.prefs.getBoolPref("qsearch.newtab.enabled", true)\n'
        '                ? "chrome://browser/content/qsearch/newtab.html"\n'
        "                : DEFAULT_HOMEPAGE_URL;",
    )
    home_settings.write_text(home_text, encoding="utf-8", newline="\n")
    appearance = src / "browser/components/preferences/config/appearance.mjs"
    insert_after(
        appearance,
        'const FORCED_COLORS_QUERY =',
        '''
Preferences.add({ id: "qsearch.layout", type: "string" });
Preferences.addSetting({ id: "qsearch-layout-picker", pref: "qsearch.layout" });
''',
    )
    insert_after(
        appearance,
        "    items: [",
        '''      {
        id: "qsearch-layout-picker",
        l10nId: "qsearch-layout-label",
        control: "moz-select",
        options: ["classic", "compact", "vertical", "frameless"].map(value => ({
          control: "moz-option",
          l10nId: `qsearch-layout-${value}`,
          controlAttrs: { value },
        })),
      },''',
    )
    insert_after(
        src / "browser/locales/en-US/browser/preferences/preferences.ftl",
        "file, You can obtain one at http://mozilla.org/MPL/2.0/.",
        '''
qsearch-layout-label =
    .label = Browser layout
qsearch-layout-classic =
    .label = Classic
qsearch-layout-compact =
    .label = Compact
qsearch-layout-vertical =
    .label = Vertical
qsearch-layout-frameless =
    .label = Frameless
''',
    )
    insert_after(
        src / "browser/locales/en-US/browser/preferences/preferences.ftl",
        "    .label = Frameless",
        '''
qsearch-home-title =
    .label = qsearch Home
qsearch-home-disabled =
    .message = Set new windows or new tabs to qsearch Home to use these settings.
qsearch-home-search =
    .label = Search box
qsearch-home-shortcuts =
    .label = Shortcuts
qsearch-home-shortcutrows =
    .label = Shortcut rows
qsearch-home-activity =
    .label = Recent activity
qsearch-home-logo =
    .label = qsearch logo
qsearch-home-clock =
    .label = Date and time
qsearch-home-stats =
    .label = Blocked tracker counts
''',
    )
    insert_after(src / "moz.build", 'include("build/templates.mozbuild")', '\nDIRS += ["qsearch"]')
    insert_after(src / "browser/components/moz.build", '"protocolhandler",', '    "qsearch",')
    insert_after(
        src / "browser/components/BrowserComponents.manifest",
        "ResetPBMPanel.sys.mjs ResetPBMPanel.init",
        "category browser-before-ui-startup moz-src:///browser/components/qsearch/QSearchPrivacy.sys.mjs QSearchPrivacy.init",
    )
    insert_after(
        src / "browser/components/BrowserComponents.manifest",
        "ReportBrokenSite.sys.mjs ReportBrokenSite.init",
        "category browser-window-delayed-startup moz-src:///browser/components/qsearch/QSearchFeatures.sys.mjs QSearchFeatures.onWindow",
    )
    insert_after(
        src / "browser/installer/package-manifest.in",
        "@RESPATH@/defaults/pref/PdfJsDefaultPrefs.js",
        "\n; qsearch configuration\n@RESPATH@/defaults/pref/local-settings.js\n@RESPATH@/distribution/policies.json\n@RESPATH@/qsearch.cfg",
    )
    insert_after(
        src / "browser/themes/shared/jar.inc.mn",
        "skin/classic/browser/browser-shared.css",
        "  skin/classic/browser/qsearch.css                             (../shared/qsearch.css)",
    )
    insert_after(
        src / "browser/themes/shared/browser-shared.css",
        "@import url(",
        '@import url("chrome://browser/skin/qsearch.css");',
        last=True,
    )
    # Own profile folder (%APPDATA%\qsearch), never shared with Firefox.
    insert_after(
        src / "browser/moz.configure",
        'imply_option("MOZ_APP_VENDOR"',
        'imply_option("MOZ_APP_PROFILE", "qsearch")',
    )

    # Settings > Home: remove the "Support ..." sponsored-content block.
    insert_after(
        src / "browser/extensions/newtab/lib/AboutPreferences.sys.mjs",
        'id: "supportFirefox",',
        "      visible: () => false, // qsearch: no sponsored content",
    )

    # No Firefox wording or fox artwork in the UI.
    rename_firefox_strings(src)
    replace_artwork(src)

    # Settings: the "qsearch support" button opens the GitHub page instead of
    # a Mozilla help article.
    prefs_page = src / "browser/components/preferences/preferences.xhtml"
    text = prefs_page.read_text(encoding="utf-8")
    button = '''slot="secondary-nav"
        support-page="preferences"'''
    if button in text:
        prefs_page.write_text(
            text.replace(
                button,
                '''slot="secondary-nav"
        href="https://github.com/Adrian1337afk/qsearch"''',
                1,
            ),
            encoding="utf-8",
            newline="\n",
        )
        print("edited", prefs_page)

    # Installer: Windows "Installed apps" shows the publisher written here.
    shared_nsh = src / "browser/installer/windows/nsis/shared.nsh"
    text = shared_nsh.read_text(encoding="utf-8")
    publisher = '''"Publisher" "Mozilla" 0'''
    if publisher in text:
        shared_nsh.write_text(
            text.replace(publisher, '''"Publisher" "qdran" 0''', 1),
            encoding="utf-8",
            newline="\n",
        )
        print("edited", shared_nsh)

    # 5. mozconfig
    shutil.copyfile(ROOT / "config" / "mozconfig", src / "mozconfig")
    print("qsearch tree ready:", src)


if __name__ == "__main__":
    main()
