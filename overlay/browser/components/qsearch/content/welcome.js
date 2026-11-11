/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* First-run page. Every choice is applied the moment it is clicked. */

"use strict";

const { QSearchFeatures, LAYOUTS, ACCENTS, NEWTAB_URL } =
  ChromeUtils.importESModule(
    "moz-src:///browser/components/qsearch/QSearchFeatures.sys.mjs"
  );
const { QSearchPrivacy } = ChromeUtils.importESModule(
  "moz-src:///browser/components/qsearch/QSearchPrivacy.sys.mjs"
);

const { SearchService } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/search/SearchService.sys.mjs"
);

const $ = id => document.getElementById(id);

/**
 * Add one radio card to a group.
 *
 * @param {string} group - Element id, also used as the radio group name.
 * @param {object} choice
 * @param {string} choice.title
 * @param {string} [choice.text]
 * @param {boolean} choice.checked
 * @param {Function} choice.onPick
 */
function addChoice(group, { title, text, checked, onPick }) {
  let label = document.createElement("label");
  let input = document.createElement("input");
  input.type = "radio";
  input.name = group;
  input.checked = checked;
  input.addEventListener("change", onPick);
  let bold = document.createElement("b");
  bold.textContent = title;
  label.append(input, bold);
  if (text) {
    let small = document.createElement("small");
    small.textContent = text;
    label.append(small);
  }
  $(group).append(label);
}

function bindCheckbox(id, pref, fallback) {
  let box = $(id);
  box.checked = Services.prefs.getBoolPref(pref, fallback);
  box.addEventListener("change", () =>
    Services.prefs.setBoolPref(pref, box.checked)
  );
}

// Privacy mode. The mode is stored without the restart prompt: nothing has
// been browsed yet, so the new defaults apply right away.
for (let [mode, info] of Object.entries(QSearchPrivacy.modes)) {
  addChoice("modes", {
    title: info.label,
    text: info.description,
    checked: QSearchPrivacy.mode == mode,
    onPick: () => Services.prefs.setStringPref("qsearch.privacy.mode", mode),
  });
}

// Search engine: general-purpose engines only. The bang engines (YouTube,
// GitHub, ...) stay available as "!yt", "!gh" in the address bar.
const GENERAL_ENGINES = [
  "DuckDuckGo",
  "Startpage",
  "Brave Search",
  "Qwant",
  "Ecosia",
];

async function showEngines() {
  await SearchService.promiseInitialized;
  let current = await SearchService.getDefault();
  let engines = await SearchService.getVisibleEngines();
  $("engines").replaceChildren();
  for (let name of GENERAL_ENGINES) {
    let engine = engines.find(e => e.name == name);
    if (!engine) {
      continue;
    }
    addChoice("engines", {
      title: engine.name,
      checked: engine.name == current.name,
      onPick: () =>
        SearchService.setDefault(engine, SearchService.CHANGE_REASON.USER),
    });
  }
}
showEngines().catch(console.error);
// Engines added by policy can arrive a moment after the page opens.
setTimeout(() => showEngines().catch(console.error), 3000);

// Layout.
for (let [id, title] of Object.entries(LAYOUTS)) {
  addChoice("layouts", {
    title,
    checked: QSearchFeatures.layout == id,
    onPick: () => QSearchFeatures.setLayout(id),
  });
}

// Accent colour.
for (let [name, color] of Object.entries(ACCENTS)) {
  let label = document.createElement("label");
  label.style.background = color;
  label.title = name;
  let input = document.createElement("input");
  input.type = "radio";
  input.name = "accent";
  input.setAttribute("aria-label", name);
  input.checked = (QSearchFeatures.accent || ACCENTS.Lime) == color;
  input.addEventListener("change", () => {
    QSearchFeatures.setAccent(color);
    document.documentElement.style.setProperty("--accent", color);
  });
  label.append(input);
  $("accents").append(label);
}
if (QSearchFeatures.accent) {
  document.documentElement.style.setProperty("--accent", QSearchFeatures.accent);
}

bindCheckbox("cookies", "qsearch.cookies.autoDelete", false);
bindCheckbox("containers", "qsearch.containers.auto", true);
bindCheckbox("updates", "qsearch.update.check", true);

$("done").addEventListener("click", () => {
  window.location.href = NEWTAB_URL;
});
