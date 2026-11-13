
// ---- qsearch: privacy defaults for GeckoView (appended by android/apply_android.py) ----
// Telemetry, studies, crash reports
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.server", "data:,");
pref("toolkit.telemetry.newProfilePing.enabled", false);
pref("toolkit.telemetry.shutdownPingSender.enabled", false);
pref("toolkit.telemetry.updatePing.enabled", false);
pref("toolkit.telemetry.bhrPing.enabled", false);
pref("toolkit.telemetry.firstShutdownPing.enabled", false);
pref("toolkit.telemetry.coverage.opt-out", true);
pref("toolkit.coverage.opt-out", true);
pref("toolkit.coverage.endpoint.base", "");
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.usage.uploadEnabled", false);
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);
pref("app.normandy.api_url", "");
pref("breakpad.reportURL", "");
pref("browser.tabs.crashReporting.sendReport", false);
// Background connections
pref("network.captive-portal-service.enabled", false);
pref("network.connectivity-service.enabled", false);
pref("network.prefetch-next", false);
pref("network.dns.disablePrefetch", true);
pref("network.dns.disablePrefetchFromHTTPS", true);
pref("network.predictor.enabled", false);
pref("network.http.speculative-parallel-limit", 0);
pref("browser.safebrowsing.downloads.remote.enabled", false);
// Tracking and fingerprinting surface
pref("dom.security.https_only_mode", true);
pref("privacy.globalprivacycontrol.enabled", true);
pref("privacy.query_stripping.enabled", true);
pref("privacy.query_stripping.enabled.pbmode", true);
pref("network.http.referer.XOriginTrimmingPolicy", 2);
pref("media.peerconnection.ice.default_address_only", true);
pref("beacon.enabled", false);
pref("dom.private-attribution.submission.enabled", false);
// ---- end qsearch ----
