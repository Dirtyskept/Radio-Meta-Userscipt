// ==UserScript==
// @name         Radio Meta - Integrated Display Loader (Universal)
// @namespace    RadioMeta-Community
// @version      1.2.0
// @description  Loads Radio Meta's integrated display helper on Emby Web without patching nowplayingbar.js.
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

    // Universal host matching is needed for self-hosted Emby servers. Only proceed
    // on web-client paths; the page's Emby.importModule API is the positive check.
    if (!/(^|\/)web(?:\/|$)/i.test(window.location.pathname || "")) {
        return;
    }

    var page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    // Keep this key compatible with the earlier Radio Meta WebLoader and release.
    var stateKey = "__radioMetaDisplayLoaderState_v1366";
    var errorKey = "__radioMetaDisplayLoaderError";

    if (page[stateKey] === "loading" || page[stateKey] === "loaded") {
        return;
    }

    var apiWaitStartedAt = Date.now();
    var apiWaitLimitMs = 20000;
    var apiPollDelayMs = 250;
    var apiPollTimer = null;
    var retryTimer = null;
    var importAttempts = 0;
    var maxImportAttempts = 3;
    var importTimeoutMs = 12000;
    var finished = false;

    page[stateKey] = "loading";

    function clearPreviousError() {
        try {
            delete page[errorKey];
        } catch (_) {
            page[errorKey] = "";
        }
    }

    function safeErrorMessage(error) {
        var message = error && error.message ? String(error.message) : String(error || "Unknown error");
        // Do not leave full URLs or query strings in the public diagnostic state.
        message = message.replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]");
        message = message.replace(/([?&](?:api_key|api-key|token|access_token|x-emby-token)=)[^&#\s]+/gi, "$1[redacted]");
        return message.slice(0, 300);
    }

    function fail(error) {
        finished = true;
        page[stateKey] = "failed";
        page[errorKey] = safeErrorMessage(error);
        console.warn(
            "Radio Meta userscript could not load the display helper. Check that the Radio Meta plugin is installed and its embedded resource is available.",
            page[errorKey]
        );
    }

    function stopIfNotEmby() {
        if (finished) return;
        finished = true;
        if (apiPollTimer !== null) window.clearTimeout(apiPollTimer);
        // A /web/ path alone is not enough to identify Emby. Silently stop rather
        // than warning on unrelated sites that happen to use the same path.
        page[stateKey] = "not-emby";
        clearPreviousError();
    }

    function statusCode(error) {
        if (!error) return 0;
        var candidates = [
            error.status,
            error.statusCode,
            error.response && error.response.status,
            error.xhr && error.xhr.status,
            error.target && error.target.status
        ];
        for (var i = 0; i < candidates.length; i += 1) {
            var value = Number(candidates[i]);
            if (value >= 100 && value <= 599) return value;
        }
        var message = error.message ? String(error.message) : String(error);
        var match = message.match(/\b(?:HTTP\s*)?(401|403|404|410)\b/i);
        return match ? Number(match[1]) : 0;
    }

    function isPermanentLoadFailure(error) {
        var status = statusCode(error);
        if (status === 401 || status === 403 || status === 404 || status === 410) return true;
        var message = error && error.message ? String(error.message) : String(error || "");
        return /\b(?:not found|could not find (?:the )?(?:module|resource)|resource unavailable)\b/i.test(message);
    }

    function handleImportFailure(error) {
        if (finished) return;
        if (isPermanentLoadFailure(error) || importAttempts >= maxImportAttempts) {
            fail(error);
            return;
        }
        // Transient import/network failures get only two bounded retries.
        var backoffMs = importAttempts === 1 ? 1000 : 2000;
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(loadHelper, backoffMs);
    }

    function markLoaded(message) {
        if (finished) return;
        finished = true;
        page[stateKey] = "loaded";
        clearPreviousError();
        console.info(message);
    }

    function loadHelper() {
        if (finished) return;
        retryTimer = null;

        var emby = page.Emby;
        if (!emby || typeof emby.importModule !== "function") {
            waitForEmby();
            return;
        }

        importAttempts += 1;
        var result;
        try {
            // Resolve through Emby's own loader so the helper comes from the
            // currently open server, including reverse-proxy/base-path setups.
            result = emby.importModule("ConfigurationPage?name=RadioMetaIntegratedDisplay.js");
        } catch (error) {
            handleImportFailure(error);
            return;
        }

        if (!result || typeof result.then !== "function") {
            // Some supported Emby Web builds do not return a Promise here.
            markLoaded("Radio Meta integrated display helper requested by universal userscript.");
            return;
        }

        var attemptFinished = false;
        var timedOut = false;
        var timeoutTimer = window.setTimeout(function () {
            if (attemptFinished || finished) return;
            timedOut = true;
            attemptFinished = true;
            // Do not issue another import while this one is still pending.
            fail(new Error("The helper import did not finish within 12 seconds."));
        }, importTimeoutMs);

        Promise.resolve(result).then(function () {
            if (timedOut) {
                // The import finished after its warning timeout; reflect the late success.
                finished = false;
                markLoaded("Radio Meta integrated display helper loaded after a delayed response.");
                return;
            }
            if (attemptFinished || finished) return;
            attemptFinished = true;
            window.clearTimeout(timeoutTimer);
            markLoaded("Radio Meta integrated display helper loaded by universal userscript.");
        }, function (error) {
            if (timedOut || attemptFinished || finished) return;
            attemptFinished = true;
            window.clearTimeout(timeoutTimer);
            handleImportFailure(error);
        });
    }

    function waitForEmby() {
        if (finished) return;
        var emby = page.Emby;
        if (emby && typeof emby.importModule === "function") {
            if (apiPollTimer !== null) window.clearTimeout(apiPollTimer);
            apiPollTimer = null;
            loadHelper();
            return;
        }

        if (Date.now() - apiWaitStartedAt >= apiWaitLimitMs) {
            stopIfNotEmby();
            return;
        }

        if (apiPollTimer !== null) window.clearTimeout(apiPollTimer);
        apiPollTimer = window.setTimeout(function () {
            apiPollTimer = null;
            apiPollDelayMs = Math.min(Math.round(apiPollDelayMs * 1.6), 1500);
            waitForEmby();
        }, apiPollDelayMs);
    }

    waitForEmby();
}());
