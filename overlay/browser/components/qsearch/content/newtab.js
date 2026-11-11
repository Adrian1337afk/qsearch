/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* The qsearch new tab page. It is a local, privileged page: it never loads
 * anything from the network. */

"use strict";

const { SearchService } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/search/SearchService.sys.mjs"
);

const $ = id => document.getElementById(id);
const homePrefs = Services.prefs.getBranch("qsearch.home.");
const { NewTabUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/NewTabUtils.sys.mjs"
);
const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
);

// ------------------------------------------------------------------ clock

function tick() {
  let now = new Date();
  $("clock").textContent = now.toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
tick();
setInterval(tick, 15000);

// ----------------------------------------------------------------- search

/**
 * Turn what the user typed into a URL: a bang or keyword ("!w cats"), an
 * address, or a search with the default engine.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
async function resolve(text) {
  let [first, ...rest] = text.split(/\s+/);
  if (rest.length) {
    let engine = await SearchService.getEngineByAlias(first);
    if (engine) {
      return engine.getSubmission(rest.join(" ")).uri.spec;
    }
  }
  let flags =
    Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP |
    Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS;
  return Services.uriFixup.getFixupURIInfo(text, flags).preferredURI.spec;
}

$("search").addEventListener("submit", async event => {
  event.preventDefault();
  let text = $("query").value.trim();
  if (!text) {
    return;
  }
  try {
    window.location.href = await resolve(text);
  } catch (ex) {
    console.error(ex);
  }
});

SearchService.promiseInitialized.then(async () => {
  let engine = await SearchService.getDefault();
  $("query").placeholder = `Search with ${engine.name} or enter address`;
});

// -------------------------------------------------------------- shortcuts

async function showShortcuts() {
  let rows = Math.min(4, Math.max(1, homePrefs.getIntPref("shortcutRows", 1)));
  let nav = $("shortcuts");
  let sites = await NewTabUtils.activityStreamProvider.getTopFrecentSites({
    numItems: rows * 8,
  });
  if (rows !== Math.min(4, Math.max(1, homePrefs.getIntPref("shortcutRows", 1)))) {
    return;
  }
  nav.replaceChildren();
  for (let site of sites) {
    let host;
    try {
      host = new URL(site.url).hostname.replace(/^www\./, "");
    } catch (ex) {
      continue;
    }
    let link = document.createElement("a");
    link.href = site.url;
    link.title = site.title || site.url;
    let icon = document.createElement("img");
    icon.src = `page-icon:${site.url}`;
    icon.alt = "";
    let label = document.createElement("span");
    label.textContent = host;
    link.append(icon, label);
    nav.append(link);
  }
}

// ---------------------------------------------------------- tracker stats

async function showStats() {
  let db = Cc["@mozilla.org/tracking-db-service;1"].getService(
    Ci.nsITrackingDBService
  );
  let total = await db.sumAllEvents();
  let weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let rows = await db.getEventsByDateRange(weekAgo, Date.now());
  let week = rows.reduce((sum, row) => sum + row.getResultByName("count"), 0);

  let format = new Intl.NumberFormat();
  $("stat-week").textContent = format.format(week);
  $("stat-total").textContent = format.format(total);
}

async function showActivity() {
  let pages = await NewTabUtils.activityStreamLinks.getHighlights({ numItems: 8 });
  let list = $("activity-links");
  list.replaceChildren();
  for (let page of pages) {
    let url = URL.parse(page.url);
    if (!url || !["https:", "http:"].includes(url.protocol)) {
      continue;
    }
    let link = document.createElement("a");
    link.href = url.href;
    link.textContent = page.title || url.hostname;
    let item = document.createElement("li");
    item.append(link);
    list.append(item);
  }
}

function applyHomePrefs() {
  for (let [name, element] of [
    ["logo", document.querySelector(".brand")],
    ["clock", $("clock")],
    ["search", $("search")],
    ["shortcuts", $("shortcuts")],
    ["activity", $("activity")],
    ["stats", $("stats")],
  ]) {
    element.hidden = !homePrefs.getBoolPref(name, name !== "activity");
  }
  if (PrivateBrowsingUtils.isContentWindowPrivate(window)) {
    $("activity").hidden = true;
  }
  if (!$("shortcuts").hidden) {
    showShortcuts().catch(console.error);
  }
  if (!$("activity").hidden) {
    showActivity().catch(console.error);
  }
  if (!$("stats").hidden) {
    showStats().catch(console.error);
  }
}

homePrefs.addObserver("", applyHomePrefs);
window.addEventListener("unload", () => homePrefs.removeObserver("", applyHomePrefs), {
  once: true,
});
applyHomePrefs();
