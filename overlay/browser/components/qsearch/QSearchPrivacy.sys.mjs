/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * QSearchPrivacy implements the two qsearch privacy modes and the toolbar
 * button that switches between them.
 *
 * A mode is a set of *default* pref values. They are written to the default
 * branch on every startup, after autoconfig (qsearch.cfg) has run. Because
 * only defaults are touched, anything the user changes by hand in Settings or
 * about:config keeps winning over the mode.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  QSearchFeatures:
    "moz-src:///browser/components/qsearch/QSearchFeatures.sys.mjs",
});

const MODE_PREF = "qsearch.privacy.mode";
const DEFAULT_MODE = "strict";
const WIDGET_ID = "qsearch-privacy-button";

const MODES = {
  strict: {
    label: "Strict (recommended)",
    description: "Strong protection, websites keep working.",
    prefs: {
      // Fingerprinting: targeted protections, no site breakage.
      "privacy.resistFingerprinting": false,
      "privacy.resistFingerprinting.letterboxing": false,
      "privacy.fingerprintingProtection": true,
      // WebGL is not listed here: in both modes a site must ask permission
      // first (librewolf.webgl.prompt from the LibreWolf webgl patch).
      // Keep history, logins and sessions between restarts.
      "privacy.sanitize.sanitizeOnShutdown": false,
      "privacy.clearOnShutdown_v2.cookiesAndStorage": false,
      "privacy.clearOnShutdown_v2.cache": false,
      "privacy.clearOnShutdown_v2.browsingHistoryAndDownloads": false,
      "privacy.clearOnShutdown_v2.historyFormDataAndDownloads": false,
      "places.history.enabled": true,
      "browser.cache.disk.enable": true,
      "browser.sessionstore.privacy_level": 0,
      "signon.rememberSignons": true,
      // Network.
      "network.trr.mode": 2, // DNS-over-HTTPS, fall back to system DNS
      "media.peerconnection.enabled": true,
      "media.peerconnection.ice.default_address_only": true,
      "network.http.referer.XOriginPolicy": 0,
      "media.autoplay.default": 1, // block audible autoplay only
    },
  },
  max: {
    label: "Maximum",
    description: "Tor-Browser-like. Some websites will break.",
    prefs: {
      // Fingerprinting: everyone looks the same.
      "privacy.resistFingerprinting": true,
      "privacy.resistFingerprinting.letterboxing": true,
      "privacy.fingerprintingProtection": true,
      // Forget everything on exit.
      "privacy.sanitize.sanitizeOnShutdown": true,
      "privacy.clearOnShutdown_v2.cookiesAndStorage": true,
      "privacy.clearOnShutdown_v2.cache": true,
      "privacy.clearOnShutdown_v2.browsingHistoryAndDownloads": true,
      "privacy.clearOnShutdown_v2.historyFormDataAndDownloads": true,
      "places.history.enabled": false,
      "browser.cache.disk.enable": false,
      "browser.sessionstore.privacy_level": 2,
      "signon.rememberSignons": false,
      // Network.
      "network.trr.mode": 3, // DNS-over-HTTPS only, never system DNS
      "media.peerconnection.enabled": false, // no WebRTC at all
      "media.peerconnection.ice.default_address_only": true,
      "network.http.referer.XOriginPolicy": 2,
      "media.autoplay.default": 5, // block all autoplay
    },
  },
};

export const QSearchPrivacy = {
  _initialized: false,

  get modes() {
    return MODES;
  },

  get mode() {
    let mode = Services.prefs.getStringPref(MODE_PREF, DEFAULT_MODE);
    return Object.hasOwn(MODES, mode) ? mode : DEFAULT_MODE;
  },

  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    this._applyMode(this.mode);
    lazy.QSearchFeatures.init();
    Services.prefs.addObserver(MODE_PREF, () => {
      this._applyMode(this.mode);
      this._updateAllButtons();
    });

    lazy.CustomizableUI.createWidget({
      id: WIDGET_ID,
      type: "button",
      label: "qsearch",
      tooltiptext: "qsearch privacy and layout",
      defaultArea: lazy.CustomizableUI.AREA_NAVBAR,
      onCreated: node => this._buildButton(node),
    });
  },

  /**
   * Write the mode's values to the default pref branch.
   *
   * @param {string} mode - Key of MODES.
   */
  _applyMode(mode) {
    let defaults = Services.prefs.getDefaultBranch("");
    for (let [name, value] of Object.entries(MODES[mode].prefs)) {
      try {
        switch (typeof value) {
          case "boolean":
            defaults.setBoolPref(name, value);
            break;
          case "number":
            defaults.setIntPref(name, value);
            break;
          default:
            defaults.setStringPref(name, value);
        }
      } catch (ex) {
        console.error(`QSearchPrivacy: could not set ${name}`, ex);
      }
    }
  },

  /**
   * Switch mode, then offer a restart because a few of the prefs are only
   * read at startup.
   *
   * @param {string} mode - Key of MODES.
   * @param {Window} win - Browser window that triggered the switch.
   */
  setMode(mode, win) {
    if (!Object.hasOwn(MODES, mode) || mode == this.mode) {
      return;
    }
    Services.prefs.setStringPref(MODE_PREF, mode);

    let ps = Services.prompt;
    let flags =
      ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING +
      ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING;
    let choice = ps.confirmEx(
      win,
      "Privacy mode changed",
      `Privacy mode is now "${MODES[mode].label}". ` +
        "Restart qsearch to apply it everywhere.",
      flags,
      "Restart now",
      "Later",
      null,
      null,
      {}
    );
    if (choice == 0) {
      Services.startup.quit(
        Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
      );
    }
  },

  _buildButton(node) {
    let doc = node.ownerDocument;
    node.setAttribute("type", "menu");
    node.setAttribute("label", "qsearch");
    node.setAttribute("wantdropmarker", "false");

    let popup = doc.createXULElement("menupopup");
    popup.id = `${WIDGET_ID}-popup`;
    popup.addEventListener("popupshowing", event => {
      // Submenus fire popupshowing too; only rebuild for the main menu.
      if (event.target == popup) {
        lazy.QSearchFeatures.populateMenu(popup, this);
        this._updateButton(node);
      }
    });
    node.appendChild(popup);
    this._updateButton(node);
  },

  _updateButton(node) {
    let mode = this.mode;
    node.setAttribute("qsearch-mode", mode);
    node.setAttribute(
      "tooltiptext",
      `qsearch privacy and layout (mode: ${MODES[mode].label})`
    );
  },

  _updateAllButtons() {
    for (let win of Services.wm.getEnumerator("navigator:browser")) {
      let node = win.document.getElementById(WIDGET_ID);
      if (node) {
        this._updateButton(node);
      }
    }
  },
};
