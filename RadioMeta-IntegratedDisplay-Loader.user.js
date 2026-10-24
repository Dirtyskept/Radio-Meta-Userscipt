// ==UserScript==
// @name         Radio Meta - Integrated Display Loader (Universal)
// @namespace    RadioMeta-Community
// @version      1.3.0
// @description  Loads the DLL-hosted Radio Meta display loader on Emby Web, with a safe compatibility fallback.
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

    var page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    var pathname = String(page.location && page.location.pathname || "");
    if (!/(^|\/)web(?:\/|$)/i.test(pathname)) {
        return;
    }

    // Do not reuse or modify the DLL loader's state flag. The older userscript did
    // this and could leave the DLL loader seeing "loading" and returning early.
    var ownStateKey = "__radioMetaUserscriptBootstrapState_v130";
    var ownErrorKey = "__radioMetaUserscriptBootstrapError_v130";
    var loaderStateKey = "__radioMetaDisplayLoaderState_v1366";
    var helperKey = "__radioMetaIntegratedDisplay_v1323";

    if (page[helperKey] === true) {
        page[ownStateKey] = "loaded";
        return;
    }
    if (page[ownStateKey] === "loading" || page[ownStateKey] === "loaded") {
        return;
    }

    var finished = false;
    var loaderModuleRequested = false;
    var directFallbackStarted = false;
    var directFallbackAttempts = 0;
    var waitStartedAt = Date.now();
    var apiWaitLimitMs = 30000;
    var apiPollDelayMs = 250;
    var loaderMonitorStartedAt = 0;
    var loaderMonitorLimitMs = 45000;
    var pollTimer = null;
    var attemptTimer = null;
    var retryTimer = null;
    var apiTimer = null;

    page[ownStateKey] = "loading";
    clearOwnError();

    function clearOwnError() {
        try {
            delete page[ownErrorKey];
        } catch (_) {
            page[ownErrorKey] = "";
        }
    }

    function stopTimer(name) {
        if (name === "pollTimer" && pollTimer !== null) {
            page.clearTimeout(pollTimer);
            pollTimer = null;
        } else if (name === "attemptTimer" && attemptTimer !== null) {
            page.clearTimeout(attemptTimer);
            attemptTimer = null;
        } else if (name === "retryTimer" && retryTimer !== null) {
            page.clearTimeout(retryTimer);
            retryTimer = null;
        } else if (name === "apiTimer" && apiTimer !== null) {
            page.clearTimeout(apiTimer);
            apiTimer = null;
        }
    }

    function stopAllTimers() {
        stopTimer("pollTimer");
        stopTimer("attemptTimer");
        stopTimer("retryTimer");
        stopTimer("apiTimer");
    }

    function safeErrorMessage(error) {
        var message = error && error.message ? String(error.message) : String(error || "Unknown error");
        message = message.replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]");
        message = message.replace(/([?&](?:api_key|api-key|token|access_token|x-emby-token)=)[^&#\s]+/gi, "$1[redacted]");
        return message.slice(0, 300);
    }

    function markLoaded(message) {
        if (finished) return;
        finished = true;
        stopAllTimers();
        page[ownStateKey] = "loaded";
        clearOwnError();
        if (message && page.console && typeof page.console.info === "function") {
            page.console.info("[Radio Meta] " + message);
        }
    }

    function fail(error) {
        if (page[helperKey] === true) {
            markLoaded("display helper initialized.");
            return;
        }
        if (finished) return;
        finished = true;
        stopAllTimers();
        page[ownStateKey] = "failed";
        page[ownErrorKey] = safeErrorMessage(error);
        if (page.console && typeof page.console.warn === "function") {
            page.console.warn(
                "[Radio Meta] Userscript could not initialize the display helper. Confirm the Radio Meta plugin is installed and its embedded resources are available.",
                page[ownErrorKey]
            );
        }
    }

    function getWebBasePath() {
        var path = String(page.location && page.location.pathname || "/");
        var lower = path.toLowerCase();
        var webPosition = lower.lastIndexOf("/web/");
        if (webPosition >= 0) return path.slice(0, webPosition);
        if (/\/web$/i.test(path)) return path.slice(0, -4);
        return "";
    }

    function getResourceUrl(resourceName) {
        return getWebBasePath() + "/web/ConfigurationPage?name=" + encodeURIComponent(resourceName);
    }

    function hasAmdLoader() {
        return typeof page.require === "function" &&
            typeof page.define === "function" &&
            !!(page.define && page.define.amd);
    }

    function hasEmbyImporter() {
        return !!(page.Emby && typeof page.Emby.importModule === "function");
    }

    function requestModule(resourceName, timeoutMs, callback) {
        var settled = false;
        var timer = page.setTimeout(function () {
            finish(new Error("Timed out waiting for " + resourceName + " to load."));
        }, timeoutMs);

        function finish(error) {
            if (settled) return;
            settled = true;
            page.clearTimeout(timer);
            callback(error || null);
        }

        try {
            if (hasAmdLoader()) {
                // Absolute same-origin path is proven to work with Emby's AMD loader
                // and correctly handles Emby installations behind a base path.
                page.require.call(page, [getResourceUrl(resourceName)], function () {
                    finish(null);
                });
                return;
            }

            if (hasEmbyImporter()) {
                var result = page.Emby.importModule("ConfigurationPage?name=" + resourceName);
                if (result && typeof result.then === "function") {
                    Promise.resolve(result).then(function () {
                        finish(null);
                    }, finish);
                } else {
                    // Some Emby builds return no promise. Allow the module factory a
                    // brief opportunity to run; final success is based on helper state.
                    page.setTimeout(function () { finish(null); }, 300);
                }
                return;
            }

            finish(new Error("Emby's AMD loader and importModule API are not available."));
        } catch (error) {
            finish(error);
        }
    }

    function monitorDllLoader() {
        if (finished) return;
        if (page[helperKey] === true) {
            markLoaded("DLL-hosted display loader initialized the helper.");
            return;
        }

        var loaderState = String(page[loaderStateKey] || "");
        if (loaderState === "failed") {
            startDirectFallback("DLL-hosted loader reported failure");
            return;
        }

        if (loaderMonitorStartedAt && Date.now() - loaderMonitorStartedAt >= loaderMonitorLimitMs) {
            startDirectFallback("DLL-hosted loader did not initialize the helper before timeout");
            return;
        }

        pollTimer = page.setTimeout(monitorDllLoader, 250);
    }

    function startDllLoader() {
        if (finished || loaderModuleRequested) return;
        if (page[helperKey] === true) {
            markLoaded("display helper was already initialized.");
            return;
        }

        loaderModuleRequested = true;
        loaderMonitorStartedAt = Date.now();
        requestModule("RadioMetaDisplayLoader.js", 10000, function (error) {
            if (finished) return;
            if (page[helperKey] === true) {
                markLoaded("DLL-hosted display loader initialized the helper.");
                return;
            }

            if (error) {
                // Older plugin builds may embed the helper but not the new loader.
                // Fall back to loading the helper itself through AMD, without writing
                // the shared DLL loader state flag.
                startDirectFallback(error);
                return;
            }

            monitorDllLoader();
        });
    }

    function startDirectFallback(reason) {
        if (finished || directFallbackStarted) return;
        directFallbackStarted = true;
        directFallbackAttempts = 0;
        if (page.console && typeof page.console.info === "function") {
            page.console.info("[Radio Meta] Falling back to the embedded display helper for compatibility.");
        }
        loadDirectHelper(reason);
    }

    function loadDirectHelper(reason) {
        if (finished) return;
        if (page[helperKey] === true) {
            markLoaded("display helper initialized.");
            return;
        }

        directFallbackAttempts += 1;
        requestModule("RadioMetaIntegratedDisplay.js", 10000, function (error) {
            if (finished) return;
            if (page[helperKey] === true) {
                markLoaded("embedded display helper initialized.");
                return;
            }

            if (error && directFallbackAttempts < 3) {
                retryTimer = page.setTimeout(function () {
                    retryTimer = null;
                    loadDirectHelper(reason);
                }, directFallbackAttempts === 1 ? 1000 : 2500);
                return;
            }

            if (!error) {
                // AMD callbacks occur after the module factory normally executes.
                // Check once more shortly afterward before reporting a failure.
                pollTimer = page.setTimeout(function () {
                    pollTimer = null;
                    if (page[helperKey] === true) {
                        markLoaded("embedded display helper initialized.");
                    } else if (directFallbackAttempts < 3) {
                        loadDirectHelper(reason);
                    } else {
                        fail(new Error("The helper module loaded but did not register its expected global."));
                    }
                }, 300);
                return;
            }

            fail(new Error("Both the DLL-hosted loader and direct helper fallback failed: " + safeErrorMessage(error)));
        });
    }

    function waitForEmbyLoader() {
        if (finished) return;
        if (page[helperKey] === true) {
            markLoaded("display helper was already initialized.");
            return;
        }
        if (hasAmdLoader() || hasEmbyImporter()) {
            startDllLoader();
            return;
        }
        if (Date.now() - waitStartedAt >= apiWaitLimitMs) {
            // This may be an unrelated site with a /web/ route; avoid a noisy warning.
            finished = true;
            stopAllTimers();
            page[ownStateKey] = "not-emby";
            clearOwnError();
            return;
        }
        apiPollDelayMs = Math.min(Math.round(apiPollDelayMs * 1.5), 1500);
        apiTimer = page.setTimeout(waitForEmbyLoader, apiPollDelayMs);
    }

    waitForEmbyLoader();
}());
