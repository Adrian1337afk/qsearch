/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Makes a qsearch page follow the accent colour: the --accent CSS variable,
 * every <img class="qs-logo"> and the tab icon. Updates live when the colour
 * is changed anywhere. */

"use strict";

(() => {
  const PREF = "qsearch.accent";
  const DEFAULT = "#c8ff3d";

  function logo(color) {
    let svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
      `<rect width="32" height="32" rx="7" fill="#0b0b0c"/>` +
      `<circle cx="15" cy="15" r="7.5" fill="none" stroke="${color}" stroke-width="3"/>` +
      `<path d="M19.5 19.5 25 25" stroke="${color}" stroke-width="3" stroke-linecap="round"/>` +
      `</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function apply() {
    let color = Services.prefs.getStringPref(PREF, "");
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      color = DEFAULT;
    }
    document.documentElement.style.setProperty("--accent", color);
    let uri = logo(color);
    for (let img of document.querySelectorAll("img.qs-logo")) {
      img.src = uri;
    }
    let icon = document.querySelector('link[rel="icon"]');
    if (icon) {
      icon.href = uri;
    }
  }

  apply();
  Services.prefs.addObserver(PREF, apply);
  window.addEventListener("unload", () =>
    Services.prefs.removeObserver(PREF, apply)
  );
})();
