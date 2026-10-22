// ==UserScript==
// @name         Radio Meta - Integrated Display Loader (Universal)
// @namespace    RadioMeta-Community
// @version      1.1.0
// @description  Loads the Radio Meta integrated display helper on this Emby server without patching nowplayingbar.js.
// @match        http://*/web/*
// @match        https://*/web/*
// @match        http://*/*/web/*
// @match        https://*/*/web/*
// @run-at       document-start
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

(function () {
    "use strict";

    // Scope execution to Emby Web paths, including installations behind a base URL
    // such as /emby/web/index.html. The @match rules intentionally do not name a host.
    if (!/(^|\/)web(?:\/|$)/i.test(window.location.pathname || "")) {
        return;
    }

    // Use the page's actual window rather than the userscript-manager sandbox.
    var page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    var stateKey = "__radioMetaDisplayLoaderState_v1366";
    var errorKey = "__radioMetaDisplayLoaderError";

    // Share state with the previous Radio Meta WebLoader so the helper is not loaded twice.
    if (page[stateKey] === "loading" || page[stateKey] === "loaded") {
        return;
    }

    var attempts = 0;
    var maxAttempts = 60;
    var retryTimer = null;

    function clearPreviousError() {
        try {
            delete page[errorKey];
        } catch (_) {
            page[errorKey] = "";
        }
    }

    function fail(error) {
        page[stateKey] = "failed";
        page[errorKey] = error && error.message ? error.message : String(error || "Unknown error");
        console.warn(
            "Radio Meta userscript could not load RadioMetaIntegratedDisplay.js. " +
            "Confirm the Radio Meta plugin is installed and its ConfigurationPage resource is available.",
            page[errorKey]
        );
    }

    function retry(error) {
        attempts += 1;
        if (attempts >= maxAttempts) {
            fail(error || new Error("Emby was not ready after 60 attempts."));
            return;
        }

        if (retryTimer !== null) {
            window.clearTimeout(retryTimer);
        }
        retryTimer = window.setTimeout(loadHelper, 1000);
    }

    function markLoaded(message) {
        page[stateKey] = "loaded";
        clearPreviousError();
        console.info(message);
    }

    function loadHelper() {
        retryTimer = null;

        var emby = page.Emby;
        if (!emby || typeof emby.importModule !== "function") {
            retry(new Error("Emby.importModule is not available yet."));
            return;
        }

        try {
            // Emby's importModule resolves the resource against this server's own
            // configured base URL, so the script never needs a hardcoded hostname.
            var result = emby.importModule("ConfigurationPage?name=RadioMetaIntegratedDisplay.js");

            if (result && typeof result.then === "function") {
                result.then(function () {
                    markLoaded("Radio Meta integrated display helper loaded by universal userscript.");
                }).catch(retry);
            } else {
                // Some Emby Web versions do not return a Promise from importModule.
                markLoaded("Radio Meta integrated display helper requested by universal userscript.");
            }
        } catch (error) {
            retry(error);
        }
    }

    page[stateKey] = "loading";
    loadHelper();
}());
