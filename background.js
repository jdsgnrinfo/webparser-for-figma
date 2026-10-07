"use strict";
(() => {
  // src/extension/background.ts
  var isFirefox = typeof browser !== "undefined" && typeof browser.runtime !== "undefined" && typeof browser.runtime.getBrowserInfo === "function";
  var api = typeof browser !== "undefined" ? browser : chrome;
  api.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    const url = tab.url || "";
    if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("about:") || url.startsWith("moz-extension://")) {
      return;
    }
    if (url.startsWith("file://")) {
      if (!isFirefox) {
        const hasFileAccess = await chrome.extension.isAllowedFileSchemeAccess();
        if (!hasFileAccess) {
          await api.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              alert(
                'WebParser for Figma: To use on local files, enable "Allow access to file URLs" in extension settings.\n\nGo to chrome://extensions \u2192 WebParser for Figma \u2192 Details \u2192 toggle "Allow access to file URLs"'
              );
            }
          }).catch(() => {
          });
          return;
        }
      }
    }
    try {
      await api.scripting.executeScript({
        target: { tabId: tab.id },
        func: installCorsBridge
      });
      if (isFirefox) {
        await api.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["injector.js"]
        });
      } else {
        await api.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          files: ["capture.js"]
        });
        await api.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          files: ["toolbar.js"]
        });
      }
    } catch (e) {
      console.error("WebParser for Figma: cannot inject on this page", e);
    }
  });
  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "figma-capture-fetch-image") {
      fetchImageAsBase64(message.url).then((result) => sendResponse(result)).catch((err) => sendResponse({ error: String(err) }));
      return true;
    }
    return false;
  });
  async function fetchImageAsBase64(url) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15e3) });
      if (!response.ok) {
        return { error: `HTTP ${response.status}` };
      }
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const CHUNK = 32768;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      const base64 = btoa(binary);
      const dataUrl = `data:${blob.type || "image/png"};base64,${base64}`;
      return { dataUrl };
    } catch (err) {
      return { error: String(err) };
    }
  }
  function installCorsBridge() {
    if (window.__figmaCorsBridge) return;
    window.__figmaCorsBridge = true;
    const rt = typeof browser !== "undefined" ? browser.runtime : chrome.runtime;
    window.addEventListener("figma-capture-fetch", async (event) => {
      const detail = event.detail;
      if (!detail?.url || !detail?.callbackId) return;
      try {
        const result = await rt.sendMessage({
          type: "figma-capture-fetch-image",
          url: detail.url
        });
        window.dispatchEvent(
          new CustomEvent("figma-capture-fetch-result", {
            detail: { callbackId: detail.callbackId, result }
          })
        );
      } catch (err) {
        window.dispatchEvent(
          new CustomEvent("figma-capture-fetch-result", {
            detail: {
              callbackId: detail.callbackId,
              result: { error: String(err) }
            }
          })
        );
      }
    });
  }
})();
