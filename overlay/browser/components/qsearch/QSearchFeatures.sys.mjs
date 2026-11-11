/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * QSearchFeatures holds every qsearch feature that is not a plain pref:
 *
 *   - layouts (classic / compact / vertical / frameless) and accent colour
 *   - per-site protection overrides
 *   - cookie auto-delete when the last tab of a site closes
 *   - automatic containers for Google, Meta and Amazon
 *   - private windows through a SOCKS proxy (for example Tor)
 *   - panic button, command palette, keyboard shortcuts
 *   - own new tab page, first-run page, update notice
 *
 * QSearchFeatures.init() runs once at startup (called by QSearchPrivacy),
 * QSearchFeatures.onWindow() runs for every browser window.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  ContextualIdentityService:
    "resource://gre/modules/ContextualIdentityService.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  Sanitizer: "resource:///modules/Sanitizer.sys.mjs",
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

// Bumped for every qsearch release built on the same Firefox version.
// The release tag on GitHub is "<firefox version>-<QSEARCH_RELEASE>".
const QSEARCH_RELEASE = "2";
const REPO = "Adrian1337afk/qsearch";
const BUTTON_ID = "qsearch-privacy-button";

export const NEWTAB_URL = "chrome://browser/content/qsearch/newtab.html";
export const WELCOME_URL = "chrome://browser/content/qsearch/welcome.html";

const PREF = {
  layout: "qsearch.layout",
  accent: "qsearch.accent",
  cookieAutoDelete: "qsearch.cookies.autoDelete",
  containers: "qsearch.containers.auto",
  proxyEnabled: "qsearch.proxy.private.enabled",
  proxyHost: "qsearch.proxy.private.host",
  proxyPort: "qsearch.proxy.private.port",
  newtab: "qsearch.newtab.enabled",
  firstRunDone: "qsearch.firstrun.done",
  updateCheck: "qsearch.update.check",
  updateLast: "qsearch.update.lastCheck",
  lastLayout: "qsearch.layout.beforeFrameless",
  rfpExempt: "privacy.resistFingerprinting.exemptedDomains",
  fppOverrides: "privacy.fingerprintingProtection.granularOverrides",
};

export const LAYOUTS = {
  classic: "Classic (tabs above toolbar)",
  compact: "Compact (everything in one row)",
  vertical: "Vertical tabs",
  frameless: "Frameless (toolbar hides itself)",
};

export const ACCENTS = {
  Lime: "#c8ff3d",
  Blue: "#4da3ff",
  Purple: "#a78bfa",
  Pink: "#ff6ac1",
  Orange: "#ff9f43",
  Red: "#ff5c5c",
  Teal: "#2dd4bf",
};

// Sites that get their own container automatically.
const CONTAINER_GROUPS = {
  Google: {
    color: "red",
    icon: "circle",
    pattern: /^google\.[a-z.]+$/,
    domains: ["youtube.com", "youtu.be", "gmail.com", "blogspot.com"],
  },
  Meta: {
    color: "blue",
    icon: "fence",
    domains: [
      "facebook.com",
      "fb.com",
      "messenger.com",
      "instagram.com",
      "threads.net",
      "threads.com",
      "whatsapp.com",
      "meta.com",
    ],
  },
  Amazon: {
    color: "orange",
    icon: "cart",
    pattern: /^amazon\.[a-z.]+$/,
    domains: ["primevideo.com", "audible.com", "twitch.tv"],
  },
};

// Logo images that are files inside the browser. When an accent colour is
// chosen, these addresses are pointed at a logo drawn in that colour.
const LOGO_URLS = [
  "chrome://branding/content/icon16.png",
  "chrome://branding/content/icon32.png",
  "chrome://branding/content/icon48.png",
  "chrome://branding/content/icon64.png",
  "chrome://branding/content/icon128.png",
  "chrome://branding/content/about-logo.png",
  "chrome://branding/content/about-logo@2x.png",
  "chrome://branding/content/about-logo.svg",
  "chrome://global/skin/illustrations/kit-happy.svg",
  "chrome://global/skin/illustrations/kit-concerned.svg",
  "chrome://global/skin/illustrations/kit-in-circle.svg",
  "chrome://browser/skin/sidebar/firefox.svg",
  "chrome://browser/skin/sidebar/foxy.svg",
  "chrome://browser/skin/preferences/fox-ai.svg",
  "chrome://browser/skin/fxa/avatar-fox.svg",
  "chrome://browser/skin/fxa/avatar-fox-circle.svg",
  "chrome://browser/skin/window-firefox.svg",
  "chrome://browser/content/qsearch/logo.svg",
];

/**
 * The qsearch logo as SVG source.
 *
 * @param {string} color - Colour of the "Q".
 * @returns {string}
 */
function logoSVG(color) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="#0b0b0c"/>` +
    `<circle cx="15" cy="15" r="7.5" fill="none" stroke="${color}" stroke-width="3"/>` +
    `<path d="M19.5 19.5 25 25" stroke="${color}" stroke-width="3" stroke-linecap="round"/>` +
    `</svg>`
  );
}

const BLANK_PAGES = new Set([
  "about:blank",
  "about:newtab",
  "about:home",
  NEWTAB_URL,
]);

function getPref(name, fallback) {
  switch (typeof fallback) {
    case "boolean":
      return Services.prefs.getBoolPref(name, fallback);
    case "number":
      return Services.prefs.getIntPref(name, fallback);
    default:
      return Services.prefs.getStringPref(name, fallback);
  }
}

/**
 * Registrable domain ("example.co.uk") of a web URI, or null for anything
 * that is not http(s).
 *
 * @param {nsIURI} uri
 * @returns {string|null}
 */
function siteOf(uri) {
  if (!uri || !uri.schemeIs("http") && !uri.schemeIs("https")) {
    return null;
  }
  try {
    return Services.eTLD.getBaseDomain(uri);
  } catch (ex) {
    // IP addresses and single-label hosts have no registrable domain.
    return uri.host || null;
  }
}

function browserWindows() {
  return [...Services.wm.getEnumerator("navigator:browser")];
}

export const QSearchFeatures = {
  _initialized: false,
  _containerIds: null,
  _accentSheet: null,
  _logoOverride: null,

  // ---------------------------------------------------------------- startup

  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    this._applyLayoutPrefs();
    this._applyNewTab();
    this._registerProxyFilter();
    Services.obs.addObserver(this, "http-on-modify-request");

    Services.prefs.addObserver(PREF.layout, () => {
      this._applyLayoutPrefs();
      browserWindows().forEach(win => this._applyLayout(win));
      // Firefox rebuilds the toolbar when the tab orientation changes;
      // tidy up once it has finished.
      lazy.setTimeout(() => this._tidyToolbar(), 600);
    });
    this._applyAccentSheet();
    this._applyAccentLogo().catch(console.error);
    Services.prefs.addObserver(PREF.accent, () => {
      this._applyAccentSheet();
      this._applyAccentLogo().catch(console.error);
      browserWindows().forEach(win => this._applyAccent(win));
    });
    Services.prefs.addObserver(PREF.newtab, () => this._applyNewTab());
    Services.prefs.addObserver("browser.newtabpage.enabled", () => this._applyNewTab());

    lazy.SearchService.promiseInitialized
      .then(() => this._setBuiltInBangs())
      .catch(console.error);
  },

  /**
   * Called for every browser window (browser-window-delayed-startup).
   *
   * @param {Window} win
   */
  onWindow(win) {
    this.init();
    this._applyLayout(win);
    this._applyAccent(win);
    this._addShortcuts(win);
    this._trackToolboxHeight(win);
    this._ensureButton();
    // Show an empty address bar on the first-run page, like on a new tab.
    win.gInitialPages?.push(WELCOME_URL);

    win.gBrowser.tabContainer.addEventListener("TabClose", event =>
      this._onTabClose(win, event.target)
    );

    if (!getPref(PREF.firstRunDone, false)) {
      Services.prefs.setBoolPref(PREF.firstRunDone, true);
      win.gBrowser.selectedTab = win.gBrowser.addTrustedTab(WELCOME_URL);
    }
    this._maybeCheckForUpdate(win);
  },

  /**
   * Put the qsearch button into the toolbar once. Switching the tab
   * orientation rebuilds the toolbar's default layout and would drop it.
   * After that first time the user is free to move or remove it.
   */
  _ensureButton() {
    const PLACED = "qsearch.button.placed";
    if (getPref(PLACED, false)) {
      return;
    }
    this._tidyToolbar();
    Services.prefs.setBoolPref(PLACED, true);
  },

  /**
   * Put the toolbar into the qsearch order:
   *
   *   sidebar, back, forward, reload, address bar, <everything else>
   *
   * Firefox's own rebuild on a tab orientation change leaves back/forward on
   * the wrong side of the address bar and can drop the reload button. Widgets
   * not named here keep their relative order.
   */
  _tidyToolbar() {
    const CUI = lazy.CustomizableUI;
    const AREA = CUI.AREA_NAVBAR;
    const LEADING = [
      "sidebar-button",
      "back-button",
      "forward-button",
      "stop-reload-button",
      "urlbar-container",
    ];
    try {
      let rest = CUI.getWidgetIdsInArea(AREA).filter(
        id => !LEADING.includes(id) && id != BUTTON_ID
      );
      // The qsearch button sits right after the address bar.
      let order = [...LEADING, BUTTON_ID, ...rest];
      CUI.beginBatchUpdate();
      try {
        order.forEach((id, position) => {
          if (CUI.getPlacementOfWidget(id)?.area == AREA) {
            CUI.moveWidgetWithinArea(id, position);
          } else if (LEADING.includes(id) || id == BUTTON_ID) {
            CUI.addWidgetToArea(id, AREA, position);
          }
        });
      } finally {
        CUI.endBatchUpdate();
      }
    } catch (ex) {
      console.error(ex);
    }
  },

  // ----------------------------------------------------------------- layout

  get layout() {
    let layout = getPref(PREF.layout, "vertical");
    return Object.hasOwn(LAYOUTS, layout) ? layout : "vertical";
  },

  setLayout(layout) {
    if (Object.hasOwn(LAYOUTS, layout)) {
      Services.prefs.setStringPref(PREF.layout, layout);
    }
  },

  /** Ctrl+Alt+C: switch the frameless layout on, or back to the previous one. */
  toggleFrameless() {
    if (this.layout == "frameless") {
      this.setLayout(getPref(PREF.lastLayout, "compact"));
    } else {
      Services.prefs.setStringPref(PREF.lastLayout, this.layout);
      this.setLayout("frameless");
    }
  },

  /**
   * Vertical tabs are a Firefox pref, the other layouts are pure CSS.
   * Firefox manages the sidebar prefs itself (it hides the sidebar strip when
   * tabs go horizontal), so they are written only when the layout changes.
   */
  _applyLayoutPrefs() {
    const APPLIED = "qsearch.layout.applied";
    let layout = this.layout;
    if (getPref(APPLIED, "") == layout) {
      return;
    }
    let vertical = layout == "vertical";
    // Firefox moves the tab strip and shows or hides the sidebar on its own
    // when this pref changes.
    Services.prefs.setBoolPref("sidebar.verticalTabs", vertical);
    if (vertical) {
      // Collapse the vertical tab strip to icons until the pointer is on it.
      Services.tm.dispatchToMainThread(() =>
        Services.prefs.setStringPref("sidebar.visibility", "expand-on-hover")
      );
    }
    Services.prefs.setStringPref(APPLIED, layout);
  },

  _applyLayout(win) {
    let layout = this.layout;
    win.document.documentElement.setAttribute("qsearch-layout", layout);
    if (layout != "vertical") {
      // With horizontal tabs the sidebar strip is only a launcher; keep it
      // out of the way until the user opens it with the sidebar button.
      try {
        win.SidebarController._state.launcherVisible = false;
      } catch (ex) {
        // Sidebar not initialised yet: it starts hidden anyway.
      }
    }
  },

  /** The frameless layout needs the toolbar height to pull the page up. */
  _trackToolboxHeight(win) {
    let toolbox = win.document.getElementById("navigator-toolbox");
    if (!toolbox) {
      return;
    }
    let root = win.document.documentElement;
    let update = () =>
      root.style.setProperty(
        "--qsearch-toolbox-height",
        `${toolbox.getBoundingClientRect().height}px`
      );
    new win.ResizeObserver(update).observe(toolbox);
    update();
  },

  // ----------------------------------------------------------------- accent

  get accent() {
    return getPref(PREF.accent, "");
  },

  /**
   * @param {string} color - CSS hex colour, or "" for the default lime.
   */
  setAccent(color) {
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
      return;
    }
    Services.prefs.setStringPref(PREF.accent, color);
  },

  /**
   * Carry the chosen accent into every internal page (Settings, Add-ons,
   * menus, dialogs ...) with a user style sheet that overrides Firefox's
   * accent colour tokens. Web pages are not touched: the sheet only matches
   * chrome:// and about: documents, and not about:blank / about:srcdoc,
   * which belong to web content.
   */
  _applyAccentSheet() {
    let sheets = Cc["@mozilla.org/content/style-sheet-service;1"].getService(
      Ci.nsIStyleSheetService
    );
    if (this._accentSheet) {
      if (sheets.sheetRegistered(this._accentSheet, sheets.USER_SHEET)) {
        sheets.unregisterSheet(this._accentSheet, sheets.USER_SHEET);
      }
      this._accentSheet = null;
    }
    let color = this.accent;
    if (!color) {
      return; // default lime comes from qsearch.css
    }
    let css = `
      @-moz-document url-prefix("chrome://"), regexp("about:(?!blank|srcdoc).*") {
        :root {
          --qsearch-accent-user: ${color};
          --color-accent-primary: ${color} !important;
          --color-accent-primary-hover: color-mix(in srgb, ${color} 85%, white) !important;
          --color-accent-primary-active: color-mix(in srgb, ${color} 70%, white) !important;
          --focus-outline-color: ${color} !important;
          /* Every accent on offer is a light colour: dark text on top. */
          --button-text-color-primary: #0b0b0c !important;
        }
      }`;
    this._accentSheet = Services.io.newURI(
      `data:text/css;charset=utf-8,${encodeURIComponent(css)}`
    );
    sheets.loadAndRegisterSheet(this._accentSheet, sheets.USER_SHEET);
  },

  /**
   * Recolour the logo wherever it is a file (Settings, address bar, About,
   * tab icons). A logo in the accent colour is written to the profile and
   * the built-in image addresses are overridden to point at it. Pages that
   * are already open show the new colour after a reload.
   */
  async _applyAccentLogo() {
    this._logoOverride?.destruct();
    this._logoOverride = null;

    let color = this.accent;
    if (color) {
      let dir = PathUtils.join(PathUtils.profileDir, "qsearch");
      await IOUtils.makeDirectory(dir, { ignoreExisting: true });
      // One file per colour: a changed colour is a new address, so no
      // cached copy of the old colour can be shown for it.
      let file = PathUtils.join(dir, `logo-${color.slice(1).toLowerCase()}.svg`);
      await IOUtils.writeUTF8(file, logoSVG(color));
      if (color != this.accent) {
        return; // changed again while writing; the newer call wins
      }
      let fileURL = PathUtils.toFileURI(file);
      let aomStartup = Cc[
        "@mozilla.org/addons/addon-manager-startup;1"
      ].getService(Ci.amIAddonManagerStartup);
      this._logoOverride = aomStartup.registerChrome(
        Services.io.newURI(fileURL),
        LOGO_URLS.map(url => ["override", url, fileURL])
      );
    }
    // Forget decoded copies of the previous colour.
    try {
      Cc["@mozilla.org/image/tools;1"]
        .getService(Ci.imgITools)
        .getImgCacheForDocument(null)
        .clearCache(true);
    } catch (ex) {
      console.error(ex);
    }
  },

  _applyAccent(win) {
    let style = win.document.documentElement.style;
    if (this.accent) {
      style.setProperty("--qsearch-accent-user", this.accent);
    } else {
      style.removeProperty("--qsearch-accent-user");
    }
  },

  // ------------------------------------------------------- per-site privacy

  currentSite(win) {
    return siteOf(win.gBrowser.selectedBrowser.currentURI);
  },

  /** Sites where fingerprinting resistance is switched off (Maximum mode). */
  _relaxedSites() {
    return getPref(PREF.rfpExempt, "")
      .split(",")
      .map(s => s.trim())
      .filter(s => s && !s.startsWith("*.") && s != "example.invalid");
  },

  isRelaxed(site) {
    return this._relaxedSites().includes(site);
  },

  setRelaxed(site, relaxed) {
    let sites = new Set(this._relaxedSites());
    relaxed ? sites.add(site) : sites.delete(site);
    let list = [];
    for (let s of sites) {
      list.push(s, `*.${s}`);
    }
    Services.prefs.setStringPref(PREF.rfpExempt, list.join(","));
  },

  /** Sites that get every fingerprinting protection even in Strict mode. */
  _hardenedOverrides() {
    try {
      let parsed = JSON.parse(getPref(PREF.fppOverrides, "") || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (ex) {
      return [];
    }
  },

  isHardened(site) {
    return this._hardenedOverrides().some(o => o.firstPartyDomain == site);
  },

  setHardened(site, hardened) {
    let overrides = this._hardenedOverrides().filter(
      o => o.firstPartyDomain != site
    );
    if (hardened) {
      overrides.push({ firstPartyDomain: site, overrides: "+AllTargets" });
    }
    Services.prefs.setStringPref(
      PREF.fppOverrides,
      overrides.length ? JSON.stringify(overrides) : ""
    );
  },

  // ------------------------------------------------------ cookie auto-delete

  _sitePrincipal(site) {
    return Services.scriptSecurityManager.createContentPrincipalFromOrigin(
      `https://${site}`
    );
  },

  keepsCookies(site) {
    return (
      Services.perms.testPermissionFromPrincipal(
        this._sitePrincipal(site),
        "cookie"
      ) == Services.perms.ALLOW_ACTION
    );
  },

  setKeepCookies(site, keep) {
    let principal = this._sitePrincipal(site);
    if (keep) {
      Services.perms.addFromPrincipal(
        principal,
        "cookie",
        Services.perms.ALLOW_ACTION
      );
    } else {
      Services.perms.removeFromPrincipal(principal, "cookie");
    }
  },

  _siteIsOpen(site) {
    return browserWindows().some(win =>
      win.gBrowser.tabs.some(
        tab => !tab.closing && siteOf(tab.linkedBrowser.currentURI) == site
      )
    );
  },

  _onTabClose(win, tab) {
    if (
      !getPref(PREF.cookieAutoDelete, false) ||
      lazy.PrivateBrowsingUtils.isWindowPrivate(win)
    ) {
      return;
    }
    let site = siteOf(tab.linkedBrowser.currentURI);
    if (!site) {
      return;
    }
    // Wait a moment: the user may reopen the tab or still have the site open.
    lazy.setTimeout(() => {
      if (this._siteIsOpen(site) || this.keepsCookies(site)) {
        return;
      }
      Services.clearData.deleteDataFromSite(
        site,
        {},
        true,
        Ci.nsIClearDataService.CLEAR_COOKIES_AND_SITE_DATA,
        { onDataDeleted() {} }
      );
    }, 5000);
  },

  // -------------------------------------------------------------- containers

  _groupFor(uri) {
    let site = siteOf(uri);
    if (!site) {
      return null;
    }
    for (let [name, group] of Object.entries(CONTAINER_GROUPS)) {
      if (group.domains.includes(site) || group.pattern?.test(site)) {
        return name;
      }
    }
    return null;
  },

  /** Container ids of the qsearch groups, created on first use. */
  _groupContainerIds() {
    if (!this._containerIds) {
      this._containerIds = {};
      let existing = lazy.ContextualIdentityService.getPublicIdentities();
      for (let [name, group] of Object.entries(CONTAINER_GROUPS)) {
        let identity =
          existing.find(i => i.name == name) ??
          lazy.ContextualIdentityService.create(name, group.icon, group.color);
        this._containerIds[name] = identity.userContextId;
      }
    }
    return this._containerIds;
  },

  /**
   * Moves a top-level page load into the container of its group, and out of
   * it again when the user leaves the group's sites. Runs for every request
   * (http-on-modify-request), so everything that is not a top-level document
   * is dismissed first.
   *
   * @param {nsIHttpChannel} channel
   */
  _containerize(channel) {
    let loadInfo = channel.loadInfo;
    if (
      loadInfo.externalContentPolicyType != Ci.nsIContentPolicy.TYPE_DOCUMENT ||
      !getPref(PREF.containers, true) ||
      channel.requestMethod != "GET" ||
      loadInfo.originAttributes.privateBrowsingId > 0
    ) {
      return;
    }
    let browsingContext = loadInfo.browsingContext;
    // Pop-ups opened by a page (for example "Sign in with Google") must stay
    // with their opener or the sign-in breaks.
    if (!browsingContext || browsingContext.parent || browsingContext.opener) {
      return;
    }
    let browser = browsingContext.embedderElement;
    let win = browser?.ownerDocument?.defaultView;
    let tab = win?.gBrowser?.getTabForBrowser(browser);
    if (!tab) {
      return;
    }

    let ids = this._groupContainerIds();
    let current = loadInfo.originAttributes.userContextId || 0;
    let group = this._groupFor(channel.URI);
    let wanted = group ? ids[group] : 0;
    if (current == wanted) {
      return;
    }
    // Never touch containers the user manages themselves.
    if (current != 0 && !Object.values(ids).includes(current)) {
      return;
    }

    let url = channel.URI.spec;
    let wasBlank = BLANK_PAGES.has(browser.currentURI.spec);
    // The reopened load must look exactly like the original one to the
    // target site. If a web page triggered it (a link, a redirect), the new
    // load is triggered by that same origin and carries the same referrer;
    // only a load the user started (address bar, bookmark) stays a
    // system-triggered one. Reopening everything as "typed by the user"
    // would send SameSite cookies on cross-site links and defeat the
    // target site's CSRF protection.
    let triggeringPrincipal = loadInfo.triggeringPrincipal;
    if (!triggeringPrincipal.isSystemPrincipal) {
      triggeringPrincipal = Services.scriptSecurityManager.principalWithOA(
        triggeringPrincipal,
        { ...triggeringPrincipal.originAttributes, userContextId: wanted }
      );
    }
    let referrerInfo = channel.referrerInfo;
    channel.cancel(Cr.NS_BINDING_ABORTED);

    Services.tm.dispatchToMainThread(() => {
      if (tab.closing || !tab.isConnected) {
        return;
      }
      let newTab = win.gBrowser.addTab(url, {
        userContextId: wanted,
        tabIndex: tab._tPos + 1,
        triggeringPrincipal,
        referrerInfo,
      });
      if (tab.selected) {
        win.gBrowser.selectedTab = newTab;
      }
      if (wasBlank) {
        win.gBrowser.removeTab(tab, { animate: false });
      }
    });
  },

  observe(subject, topic) {
    if (topic == "http-on-modify-request") {
      try {
        this._containerize(subject.QueryInterface(Ci.nsIHttpChannel));
      } catch (ex) {
        console.error(ex);
      }
    }
  },

  // ------------------------------------------------ private windows by proxy

  /**
   * WebRTC opens its own UDP connections, which a SOCKS proxy for page loads
   * does not cover: a page could learn the real IP address. While the proxy
   * option is on, WebRTC in private windows may only use the proxy.
   */
  _applyProxyWebRTC() {
    Services.prefs
      .getDefaultBranch("")
      .setBoolPref(
        "media.peerconnection.ice.proxy_only_if_pbmode",
        getPref(PREF.proxyEnabled, false)
      );
  },

  _registerProxyFilter() {
    this._applyProxyWebRTC();
    Services.prefs.addObserver(PREF.proxyEnabled, () =>
      this._applyProxyWebRTC()
    );
    let pps = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(
      Ci.nsIProtocolProxyService
    );
    pps.registerChannelFilter(
      {
        applyFilter(channel, defaultProxyInfo, callback) {
          let proxyInfo = defaultProxyInfo;
          try {
            if (
              getPref(PREF.proxyEnabled, false) &&
              channel.loadInfo.originAttributes.privateBrowsingId > 0
            ) {
              // Host names are resolved by the proxy, never locally. There is
              // no fallback: if the proxy is down, the request fails.
              proxyInfo = pps.newProxyInfo(
                "socks",
                getPref(PREF.proxyHost, "127.0.0.1"),
                getPref(PREF.proxyPort, 9050),
                "",
                "",
                Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST,
                0,
                null
              );
            }
          } catch (ex) {
            console.error(ex);
          }
          callback.onProxyFilterResult(proxyInfo);
        },
      },
      0
    );
  },

  // ------------------------------------------------------------------ panic

  /** Close every tab and wipe all browsing data. No confirmation. */
  async panic() {
    let [first, ...others] = browserWindows();
    others.forEach(win => win.close());
    if (first) {
      let gBrowser = first.gBrowser;
      let blank = gBrowser.addTrustedTab(lazy.AboutNewTab.newTabURL);
      gBrowser.selectedTab = blank;
      gBrowser.removeTabs(
        gBrowser.tabs.filter(tab => tab != blank),
        { animate: false, skipPermitUnload: true }
      );
    }
    await lazy.Sanitizer.sanitize(
      [
        "cache",
        "cookies",
        "offlineApps",
        "history",
        "formdata",
        "downloads",
        "sessions",
      ],
      { ignoreTimespan: true }
    );
  },

  // -------------------------------------------------------------- incognito

  /**
   * Open an incognito window: Firefox's private browsing window. Nothing
   * from it (history, cookies, cache) is kept once it is closed.
   *
   * @param {Window} win - Browser window to open it from.
   */
  openIncognito(win) {
    win.OpenBrowserWindow({ private: true });
  },

  // -------------------------------------------------------------- shortcuts

  _addShortcuts(win) {
    let doc = win.document;
    let commandSet = doc.getElementById("mainCommandSet");
    let keySet = doc.getElementById("mainKeyset");
    if (!commandSet || !keySet) {
      return;
    }
    let add = (id, action, keyAttrs) => {
      let command = doc.createXULElement("command");
      command.id = id;
      command.addEventListener("command", action);
      commandSet.appendChild(command);
      if (keyAttrs) {
        let key = doc.createXULElement("key");
        key.id = `${id}-key`;
        for (let [name, value] of Object.entries(keyAttrs)) {
          key.setAttribute(name, value);
        }
        key.setAttribute("command", id);
        keySet.appendChild(key);
      }
    };

    // Alt+Shift+Delete: panic.
    add("qsearch:panic", () => this.panic(), {
      keycode: "VK_DELETE",
      modifiers: "alt,shift",
    });
    // Ctrl+Alt+C: frameless on/off.
    add("qsearch:frameless", () => this.toggleFrameless(), {
      key: "C",
      modifiers: "accel,alt",
    });
    // Ctrl+Shift+N: incognito window, the shortcut Chromium browsers use.
    // (Firefox's own Ctrl+Shift+P keeps working; "reopen closed window"
    // loses this shortcut and stays in the History menu.)
    add("qsearch:incognito", () => this.openIncognito(win));
    doc
      .getElementById("key_undoCloseWindow")
      ?.setAttribute("command", "qsearch:incognito");
    // Ctrl+K: command palette (address bar in "actions" mode).
    add("qsearch:palette", () => win.gURLBar.search("> "));
    doc.getElementById("key_search")?.setAttribute("command", "qsearch:palette");
  },

  // ---------------------------------------------------------------- new tab

  _applyNewTab() {
    let enabled = getPref(PREF.newtab, true);
    let defaults = Services.prefs.getDefaultBranch("");
    defaults.setStringPref("browser.startup.homepage", enabled ? NEWTAB_URL : "about:home");
    Services.obs.notifyObservers(null, "newtab-url-changed", lazy.AboutNewTab.newTabURL);
  },

  /** "!w cats" in the address bar searches Wikipedia, with any default engine. */
  async _setBuiltInBangs() {
    let bangs = { "Wikipedia (en)": "!w", DuckDuckGo: "!ddg" };
    for (let [name, alias] of Object.entries(bangs)) {
      let engine = lazy.SearchService.getEngineByName(name);
      if (engine && !engine.alias) {
        engine.alias = alias;
      }
    }
  },

  // ----------------------------------------------------------- update notice

  get version() {
    return `${Services.appinfo.version}-${QSEARCH_RELEASE}`;
  },

  /**
   * Once a day, ask GitHub for the newest release and show a notification
   * bar when it is newer than this build. Nothing is downloaded or installed.
   *
   * @param {Window} win
   */
  async _maybeCheckForUpdate(win) {
    const DAY = 24 * 60 * 60;
    let now = Math.floor(Date.now() / 1000);
    if (
      !getPref(PREF.updateCheck, true) ||
      now - getPref(PREF.updateLast, 0) < DAY
    ) {
      return;
    }
    Services.prefs.setIntPref(PREF.updateLast, now);
    try {
      let response = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        { credentials: "omit", cache: "no-store" }
      );
      if (!response.ok) {
        return;
      }
      let release = await response.json();
      let latest = String(release.tag_name ?? "").replace(/^v/, "");
      let comparable = v => v.replace("-", ".");
      if (
        !latest ||
        Services.vc.compare(comparable(latest), comparable(this.version)) <= 0
      ) {
        return;
      }
      let box = win.gBrowser.getNotificationBox();
      box.appendNotification(
        "qsearch-update",
        {
          label: `qsearch ${latest} is available. You are using ${this.version}.`,
          priority: box.PRIORITY_INFO_MEDIUM,
        },
        [
          {
            label: "Open download page",
            callback: () => {
              win.openTrustedLinkIn(
                `https://github.com/${REPO}/releases/latest`,
                "tab"
              );
            },
          },
        ]
      );
    } catch (ex) {
      // Offline or GitHub unreachable: try again tomorrow.
    }
  },

  // ------------------------------------------------------------------- menu

  /**
   * Fill the toolbar button's menu. Rebuilt every time it opens so that it
   * always shows the state of the current site.
   *
   * @param {XULElement} popup
   * @param {object} privacy - QSearchPrivacy (modes), passed in to avoid a
   *   circular import.
   */
  populateMenu(popup, privacy) {
    let win = popup.ownerDocument.defaultView;
    let doc = popup.ownerDocument;
    popup.replaceChildren();

    let item = (parent, label, { type, checked, disabled, tooltip }, action) => {
      let el = doc.createXULElement("menuitem");
      el.setAttribute("label", label);
      if (type) {
        el.setAttribute("type", type);
      }
      if (checked) {
        el.setAttribute("checked", "true");
      }
      if (disabled) {
        el.setAttribute("disabled", "true");
      }
      if (tooltip) {
        el.setAttribute("tooltiptext", tooltip);
      }
      el.addEventListener("command", action);
      parent.appendChild(el);
      return el;
    };
    let separator = parent =>
      parent.appendChild(doc.createXULElement("menuseparator"));
    let submenu = label => {
      let menu = doc.createXULElement("menu");
      menu.setAttribute("label", label);
      let inner = doc.createXULElement("menupopup");
      menu.appendChild(inner);
      popup.appendChild(menu);
      return inner;
    };
    let toggle = pref => () =>
      Services.prefs.setBoolPref(pref, !Services.prefs.getBoolPref(pref, false));

    // Privacy mode.
    for (let [mode, info] of Object.entries(privacy.modes)) {
      item(
        popup,
        info.label,
        { type: "radio", checked: privacy.mode == mode, tooltip: info.description },
        () => privacy.setMode(mode, win)
      );
    }
    separator(popup);

    // This site.
    let site = this.currentSite(win);
    let siteLabel = site ?? "this site";
    item(
      popup,
      `Relax protection on ${siteLabel}`,
      {
        type: "checkbox",
        checked: site && this.isRelaxed(site),
        disabled: !site,
        tooltip: "Fixes a site that breaks in Maximum mode.",
      },
      () => this.setRelaxed(site, !this.isRelaxed(site))
    );
    item(
      popup,
      `Maximum protection on ${siteLabel}`,
      {
        type: "checkbox",
        checked: site && this.isHardened(site),
        disabled: !site,
        tooltip: "All fingerprinting protections on this site, in any mode.",
      },
      () => this.setHardened(site, !this.isHardened(site))
    );
    item(
      popup,
      `Keep cookies of ${siteLabel}`,
      {
        type: "checkbox",
        checked: site && this.keepsCookies(site),
        disabled: !site,
        tooltip: "Never auto-delete this site's cookies.",
      },
      () => this.setKeepCookies(site, !this.keepsCookies(site))
    );
    separator(popup);

    // Features.
    item(
      popup,
      "Delete a site's cookies when its last tab closes",
      { type: "checkbox", checked: getPref(PREF.cookieAutoDelete, false) },
      toggle(PREF.cookieAutoDelete)
    );
    item(
      popup,
      "Containers for Google, Meta and Amazon",
      { type: "checkbox", checked: getPref(PREF.containers, true) },
      () =>
        Services.prefs.setBoolPref(
          PREF.containers,
          !getPref(PREF.containers, true)
        )
    );
    item(
      popup,
      `Private windows through proxy (${getPref(PREF.proxyHost, "127.0.0.1")}:${getPref(PREF.proxyPort, 9050)})`,
      {
        type: "checkbox",
        checked: getPref(PREF.proxyEnabled, false),
        tooltip:
          "Sends incognito windows through a SOCKS proxy such as a running Tor. WebRTC (video calls) in those windows is limited to the proxy.",
      },
      toggle(PREF.proxyEnabled)
    );
    separator(popup);

    // Look.
    let layouts = submenu("Layout");
    for (let [id, label] of Object.entries(LAYOUTS)) {
      item(layouts, label, { type: "radio", checked: this.layout == id }, () =>
        this.setLayout(id)
      );
    }
    let accents = submenu("Accent colour");
    for (let [name, color] of Object.entries(ACCENTS)) {
      let current = (this.accent || ACCENTS.Lime).toLowerCase() == color;
      item(accents, name, { type: "radio", checked: current }, () =>
        this.setAccent(color)
      );
    }
    item(
      popup,
      "qsearch new tab page",
      { type: "checkbox", checked: getPref(PREF.newtab, true) },
      () => Services.prefs.setBoolPref(PREF.newtab, !getPref(PREF.newtab, true))
    );
    separator(popup);

    item(
      popup,
      "New incognito window",
      { tooltip: "Ctrl+Shift+N. Nothing is kept after it is closed." },
      () => this.openIncognito(win)
    );
    item(
      popup,
      "Panic: close tabs and wipe everything",
      { tooltip: "Alt+Shift+Delete. No confirmation." },
      () => this.panic()
    );
  },
};
