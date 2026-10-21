// ==UserScript==
// @name         Radio Meta - Integrated Display Loader
// @namespace    https://emby.mekhanik.net/
// @version      1.0.0
// @description  Loads the Radio Meta integrated display helper without patching Emby's nowplayingbar.js.
// @match        https://emby.mekhanik.net/web/*
// @match        http://emby.mekhanik.net/web/*
// @run-at       document-start
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

(function () {
    "use strict";

    // Use the actual Emby page window, not the userscript manager's sandbox.
    var page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    var stateKey = "__radioMetaDisplayLoaderState_v1366";
    var errorKey = "__radioMetaDisplayLoaderError";

    // Share the state key with the existing loader so the helper isn't loaded twice.
    if (page[stateKey] === "loading" || page[stateKey] === "loaded") {
        return;
    }

    var attempts = 0;
    var maxAttempts = 60;

    function retry(error) {
        attempts += 1;
        if (attempts < maxAttempts) {
            window.setTimeout(loadHelper, 1000);
            return;
        }

        page[stateKey] = "failed";
        page[errorKey] = error && error.message ? error.message : String(error || "Unknown error");
        console.warn(
            "Radio Meta userscript could not load RadioMetaIntegratedDisplay.js. " +
            "Confirm the Radio Meta plugin is installed and the Emby Web page can reach its plugin resource endpoint.",
            page[errorKey]
        );
    }

    function loadHelper() {
        var emby = page.Emby;
        if (!emby || typeof emby.importModule !== "function") {
            retry(new Error("Emby.importModule is not available yet."));
            return;
        }

        try {
            var result = emby.importModule("ConfigurationPage?name=RadioMetaIntegratedDisplay.js");
            if (result && typeof result.then === "function") {
                result.then(function () {
                    page[stateKey] = "loaded";
                    try { delete page[errorKey]; } catch (_) { page[errorKey] = ""; }
                    console.info("Radio Meta integrated display helper loaded by userscript.");
                }).catch(retry);
            } else {
                page[stateKey] = "loaded";
                try { delete page[errorKey]; } catch (_) { page[errorKey] = ""; }
                console.info("Radio Meta integrated display helper requested by userscript.");
            }
        } catch (error) {
            retry(error);
        }
    }

    page[stateKey] = "loading";
    loadHelper();
}());
