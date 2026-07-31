// ABOUTME: Preview-site logger injected into user preview apps (served from assets.emergent.sh).
// ABOUTME: Intercepts console/network/resource/build errors and postMessages them to the parent preview panel.
// preview-site-logger.js
(function () {
  const parentOrigin = "*";

  // Payload size caps — keep postMessage payloads small and limit data exposure
  const MAX_BODY_CHARS = 500; // captured API response bodies
  const MAX_OUTER_HTML_CHARS = 1000; // resource element markup

  function sendToParent(type, data, severity = "info") {
    // Logging must NEVER break the host app. postMessage can throw (e.g. DataCloneError on a
    // non-serializable payload); swallow it so a logging failure can't reject the app's own
    // fetch/XHR or surface as an uncaught error in the previewed page.
    try {
      window.parent.postMessage(
        {
          source: "preview-logger",
          type: type,
          category: getCategoryFromType(type),
          severity: severity,
          data: data,
          timestamp: new Date().toISOString(),
        },
        parentOrigin,
      );
    } catch (e) {
      /* no-op: never propagate logger errors to the host app */
    }
  }

  function getCategoryFromType(type) {
    const categoryMap = {
      buildError: "build",
      runtimeError: "runtime",
      promiseRejection: "runtime",
      resourceError: "resource",
      networkError: "network",
      networkStatus: "network",
      console: "console",
    };
    return categoryMap[type] || "other";
  }

  // Intercept console methods
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
  };

  ["log", "error", "warn", "info", "debug"].forEach(method => {
    console[method] = function (...args) {
      originalConsole[method].apply(console, args);

      const severity = method === "error" ? "error" : method === "warn" ? "warning" : "info";

      sendToParent(
        "console",
        {
          level: method,
          message: args.map(arg => {
            try {
              return typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg);
            } catch (e) {
              return String(arg);
            }
          }),
        },
        severity,
      );
    };
  });

  // Enhanced build error detection with detailed extraction
  function detectBuildError() {
    let errorDetails = null;

    // 1. Vite Error Overlay (most detailed)
    const viteOverlay = document.querySelector("vite-error-overlay");
    if (viteOverlay && viteOverlay.shadowRoot) {
      const shadowRoot = viteOverlay.shadowRoot;

      // Extract error message
      const messageEl =
        shadowRoot.querySelector(".message-body") ||
        shadowRoot.querySelector(".message") ||
        shadowRoot.querySelector("pre");

      // Extract stack trace
      const stackEl = shadowRoot.querySelector(".stack") || shadowRoot.querySelector(".file");

      // Extract file info
      const fileEl = shadowRoot.querySelector(".file");

      if (messageEl) {
        errorDetails = {
          message: messageEl.textContent.trim(),
          stack: stackEl ? stackEl.textContent.trim() : "",
          file: fileEl ? fileEl.textContent.trim() : "",
          tool: "Vite",
          rawHTML: shadowRoot.innerHTML.substring(0, 5000), // Capture full error for debugging
        };
      }
    }

    // 2. Webpack Error Overlay
    if (!errorDetails) {
      const webpackOverlay =
        document.querySelector('iframe[id*="webpack"]') || document.querySelector("[data-reactroot]"); // React error overlay

      if (webpackOverlay) {
        try {
          let errorText = "";

          // Try to access iframe content
          if (webpackOverlay.tagName === "IFRAME") {
            const iframeDoc = webpackOverlay.contentDocument || webpackOverlay.contentWindow?.document;
            if (iframeDoc) {
              errorText = iframeDoc.body.textContent;
            }
          } else {
            errorText = webpackOverlay.textContent;
          }

          if (errorText) {
            errorDetails = {
              message: errorText.substring(0, 1000),
              tool: "Webpack",
              rawText: errorText.substring(0, 5000),
            };
          }
        } catch (e) {
          errorDetails = {
            message: "Webpack build error detected (unable to extract details due to iframe restrictions)",
            tool: "Webpack",
            error: e.message,
          };
        }
      }
    }

    // 3. Check for error text in body (Next.js, Create React App, etc.)
    if (!errorDetails) {
      const bodyText = document.body?.textContent || "";
      const bodyHTML = document.body?.innerHTML || "";

      const errorIndicators = [
        "Failed to compile",
        "Compilation failed",
        "Build failed",
        "Module not found",
        "Cannot find module",
        "Syntax error",
        "Module parse failed",
        "You may need an appropriate loader",
        "ERROR in",
        "Module build failed",
      ];

      const hasError = errorIndicators.some(indicator => bodyText.includes(indicator) || bodyHTML.includes(indicator));

      if (hasError) {
        // Extract the error block
        const pre = document.querySelector("pre");
        const errorDiv = document.querySelector('[class*="error"]') || document.querySelector('[id*="error"]');

        let errorMessage = "";
        if (pre) {
          errorMessage = pre.textContent;
        } else if (errorDiv) {
          errorMessage = errorDiv.textContent;
        } else {
          // Try to extract error context from body text
          const lines = bodyText.split("\n");
          const errorLineIndex = lines.findIndex(line => errorIndicators.some(indicator => line.includes(indicator)));

          if (errorLineIndex !== -1) {
            // Get surrounding lines for context
            errorMessage = lines
              .slice(Math.max(0, errorLineIndex - 2), Math.min(lines.length, errorLineIndex + 15))
              .join("\n");
          }
        }

        errorDetails = {
          message: errorMessage.trim().substring(0, 2000),
          tool: "Build Tool",
          fullBody: bodyText.substring(0, 3000),
        };
      }
    }

    // 4. Check for React error boundary
    const reactError =
      document.querySelector('[data-test-id="error-boundary"]') || document.querySelector(".react-error-overlay");

    if (!errorDetails && reactError) {
      errorDetails = {
        message: reactError.textContent.trim(),
        tool: "React",
        stack: reactError.querySelector(".stack-trace")?.textContent || "",
      };
    }

    // Send the error if found
    if (errorDetails) {
      sendToParent("buildError", errorDetails, "critical");
      return true;
    }

    return false;
  }

  // Capture runtime errors with full details
  window.addEventListener("error", event => {
    if (event.target !== window) return;

    sendToParent(
      "runtimeError",
      {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack || "",
        errorType: event.error?.name || "Error",
        errorObject: event.error
          ? {
              name: event.error.name,
              message: event.error.message,
              stack: event.error.stack,
            }
          : null,
      },
      "error",
    );
  });

  // Capture unhandled promise rejections with details
  window.addEventListener("unhandledrejection", event => {
    let reason = event.reason;
    let reasonDetails = {};

    if (reason instanceof Error) {
      reasonDetails = {
        name: reason.name,
        message: reason.message,
        stack: reason.stack,
      };
    } else if (typeof reason === "object") {
      try {
        reasonDetails = JSON.parse(JSON.stringify(reason));
      } catch (e) {
        reasonDetails = { toString: String(reason) };
      }
    } else {
      reasonDetails = { value: String(reason) };
    }

    sendToParent(
      "promiseRejection",
      {
        reason: String(reason),
        reasonDetails: reasonDetails,
        stack: reason?.stack || "",
        promise: String(event.promise),
      },
      "error",
    );
  });

  // Capture resource loading errors
  window.addEventListener(
    "error",
    event => {
      if (event.target !== window) {
        const target = event.target;
        const tagName = target.tagName;
        const severity = tagName === "SCRIPT" || tagName === "LINK" ? "error" : "warning";

        sendToParent(
          "resourceError",
          {
            // --- Observability enrichment ---
            resourceType: tagName, // HTML tag type of failed asset (IMG / SCRIPT / LINK / VIDEO)
            resourceUrl: target.src || target.href || target.currentSrc || null, // URL of the failed file (may be missing for cross-origin/iframe)
            stack: null, // Not available (no JS execution in resource loading errors)
            onlineState: navigator.onLine, // Browser network status
            pageUrl: window.location.href, // Page where the resource failed to load
            timestamp: new Date().toISOString(), // Exact time when event was logged

            // --- Existing fields (kept for backward compatibility) ---
            tagName: tagName,
            src: target.src || target.href || target.currentSrc,
            type: "Resource failed to load",
            outerHTML: target.outerHTML ? target.outerHTML.substring(0, MAX_OUTER_HTML_CHARS) : "",
          },
          severity,
        );
      }
    },
    true,
  );

  // --- Network observability enrichment helpers ---

  // Retry tracking: count consecutive failed attempts for the same endpoint
  // within a sliding window. Reset on a successful outcome.
  const RETRY_WINDOW_MS = 30000;
  const retryTracker = new Map(); // key: "METHOD url" -> { count, last }

  function retryKey(method, url) {
    return `${(method || "GET").toUpperCase()} ${url}`;
  }

  function bumpRetry(method, url) {
    const key = retryKey(method, url);
    const now = Date.now();
    const entry = retryTracker.get(key);
    if (entry && now - entry.last < RETRY_WINDOW_MS) {
      entry.count += 1;
      entry.last = now;
    } else {
      retryTracker.set(key, { count: 0, last: now });
    }
    return retryTracker.get(key).count;
  }

  function clearRetry(method, url) {
    retryTracker.delete(retryKey(method, url));
  }

  // Extract url + method from the polymorphic fetch() arguments
  function parseFetchArgs(args) {
    const input = args[0];
    const init = args[1] || {};
    let url, method;
    if (input && typeof input === "object" && "url" in input) {
      // Request object
      url = input.url;
      method = init.method || input.method || "GET";
    } else {
      url = String(input);
      method = init.method || "GET";
    }
    return { url, method: (method || "GET").toUpperCase() };
  }

  // Unified network event emitter matching the observability spec
  function sendNetworkEvent(evt) {
    sendToParent(
      "networkError",
      {
        url: evt.url, // API/request endpoint that was called
        method: evt.method, // HTTP method used (GET/POST/PUT/DELETE)
        type: evt.type, // source of request (fetch / xhr)
        status: typeof evt.status === "number" ? evt.status : 0, // HTTP status (0 if network/CORS/offline failure)
        outcome: evt.outcome, // success / http_error / network_error / abort / timeout
        duration: evt.duration, // total request time in milliseconds
        errorMessage: evt.errorMessage || "", // failure reason message (if request errored)
        retryCount: evt.retryCount || 0, // retry attempts before final result
        pageUrl: window.location.href, // page where request was made from
        timestamp: new Date().toISOString(), // exact time when event was logged

        // --- Existing richer fields kept for debugging ---
        // Bodies are truncated to limit payload size and reduce sensitive-data exposure.
        statusText: evt.statusText,
        responseBody: evt.responseBody ? String(evt.responseBody).substring(0, MAX_BODY_CHARS) : evt.responseBody,
        responseText: evt.responseText ? String(evt.responseText).substring(0, MAX_BODY_CHARS) : evt.responseText,
        headers: evt.headers,
        stack: evt.stack,
      },
      "error",
    );
  }

  // Enhanced network error monitoring
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const { url, method } = parseFetchArgs(args);
    const startTime = Date.now();

    return originalFetch
      .apply(this, args)
      .then(response => {
        const duration = Date.now() - startTime;
        if (!response.ok) {
          const retryCount = bumpRetry(method, url);
          // Clone so we never consume the body the app needs to read
          return response
            .clone()
            .text()
            .then(body => {
              sendNetworkEvent({
                url,
                method,
                type: "fetch",
                status: response.status,
                outcome: "http_error",
                duration,
                errorMessage: `${response.status} ${response.statusText}`,
                retryCount,
                statusText: response.statusText,
                responseBody: body.substring(0, MAX_BODY_CHARS),
                headers: Object.fromEntries(response.headers.entries()),
              });
              return response;
            })
            .catch(() => {
              sendNetworkEvent({
                url,
                method,
                type: "fetch",
                status: response.status,
                outcome: "http_error",
                duration,
                errorMessage: `${response.status} ${response.statusText}`,
                retryCount,
                statusText: response.statusText,
              });
              return response; // If can't read body, return response as-is
            });
        }
        clearRetry(method, url); // successful response resets retry counter
        return response;
      })
      .catch(error => {
        const duration = Date.now() - startTime;
        // error may be null/undefined or a non-Error (e.g. Promise.reject()); read defensively
        // so we never throw a TypeError in place of the app's real rejection.
        const aborted = !!(error && error.name === "AbortError");
        const retryCount = bumpRetry(method, url);
        sendNetworkEvent({
          url,
          method,
          type: "fetch",
          status: 0,
          outcome: aborted ? "abort" : "network_error",
          duration,
          errorMessage: error && error.message ? error.message : String(error),
          retryCount,
          stack: error && error.stack ? error.stack : undefined,
        });
        throw error;
      });
  };

  // Monitor XHR requests
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._url = url;
    this._method = (method || "GET").toUpperCase();
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this._startTime = Date.now();

    this.addEventListener("error", function () {
      sendNetworkEvent({
        url: this._url,
        method: this._method,
        type: "xhr",
        status: this.status || 0,
        outcome: "network_error",
        duration: Date.now() - this._startTime,
        errorMessage: "Request failed",
        retryCount: bumpRetry(this._method, this._url),
      });
    });

    this.addEventListener("abort", function () {
      sendNetworkEvent({
        url: this._url,
        method: this._method,
        type: "xhr",
        status: this.status || 0,
        outcome: "abort",
        duration: Date.now() - this._startTime,
        errorMessage: "Request aborted",
        retryCount: bumpRetry(this._method, this._url),
      });
    });

    this.addEventListener("timeout", function () {
      sendNetworkEvent({
        url: this._url,
        method: this._method,
        type: "xhr",
        status: 0,
        outcome: "timeout",
        duration: Date.now() - this._startTime,
        errorMessage: "Request timed out",
        retryCount: bumpRetry(this._method, this._url),
      });
    });

    this.addEventListener("load", function () {
      const duration = Date.now() - this._startTime;
      if (this.status >= 400) {
        // Reading responseText throws (InvalidStateError) when responseType is json/blob/
        // arraybuffer/document. Guard it so the listener never throws.
        let responseText;
        try {
          responseText = this.responseText;
        } catch (e) {
          responseText = undefined;
        }
        sendNetworkEvent({
          url: this._url,
          method: this._method,
          type: "xhr",
          status: this.status,
          outcome: "http_error",
          duration,
          errorMessage: `${this.status} ${this.statusText}`,
          retryCount: bumpRetry(this._method, this._url),
          statusText: this.statusText,
          responseText: responseText,
        });
      } else {
        clearRetry(this._method, this._url); // success resets retry counter
      }
    });

    return originalXHRSend.apply(this, arguments);
  };

  // Track browser connectivity changes — helps explain clusters of network errors
  function reportConnectivity(isOnline) {
    sendToParent(
      "networkStatus",
      {
        online: isOnline,
        pageUrl: window.location.href,
        timestamp: new Date().toISOString(),
      },
      isOnline ? "info" : "warning",
    );
  }

  window.addEventListener("online", () => reportConnectivity(true));
  window.addEventListener("offline", () => reportConnectivity(false));

  // Check for build errors on load
  window.addEventListener("load", () => {
    setTimeout(() => {
      const hasError = detectBuildError();
      if (!hasError) {
        sendToParent(
          "ready",
          {
            url: window.location.href,
            userAgent: navigator.userAgent,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
          },
          "info",
        );
      }
    }, 100);
  });

  // Periodically check for build errors (for HMR)
  let lastErrorCheck = "";
  setInterval(() => {
    const currentBodyText = document.body?.textContent || "";
    // Only check if body content changed
    if (currentBodyText !== lastErrorCheck) {
      detectBuildError();
      lastErrorCheck = currentBodyText;
    }
  }, 2000);

  // Initial check
  setTimeout(detectBuildError, 100);
})();
