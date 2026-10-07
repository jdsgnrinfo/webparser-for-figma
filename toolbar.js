"use strict";
(() => {
  // src/extension/toolbar.ts
  (() => {
    const HOST_ID = "__figma_capture_ext_toolbar__";
    const isFirefox = navigator.userAgent.includes("Firefox");
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-h2d-ignore", "true");
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        --bg: #1c1c1e;
        --pill-bg: #2c2c2e;
        --btn-hover: #3a3a3c;
        --accent: #0d99ff;
        --danger: #ff3b30;
        --success: #30d158;
        --warning: #ff9f0a;
        --info: #8e8e93;
        --text: rgba(255,255,255,0.9);
        --text-muted: rgba(255,255,255,0.5);
      }

      /* ─── Inner stroke utility ─── */
      .inner-stroke {
        position: relative;
      }
      .inner-stroke::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1px;
        background: linear-gradient(180deg, #424242 0%, #0F0F0F 100%);
        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        pointer-events: none;
        z-index: 1;
      }
      .inner-stroke > * {
        position: relative;
        z-index: 2;
      }

      /* ─── Panel ─── */
      .panel {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px;
        background: var(--bg);
        border-radius: 16px;
        box-shadow: 0 6px 16px rgba(0,0,0,0.5);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;
        font-size: 13px;
        font-weight: 500;
        z-index: 2147483647;
        user-select: none;
        cursor: grab;
        opacity: 0;
        transform: translateX(-50%) scale(0.85) translateY(-10px);
        animation: panelEnter 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        will-change: transform, opacity;
      }
      .panel:active { cursor: grabbing; }

      .panel.exiting {
        animation: panelExit 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        pointer-events: none;
      }

      @keyframes panelEnter {
        0%   { opacity: 0; transform: translateX(-50%) scale(0.85) translateY(-10px); }
        100% { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
      }
      @keyframes panelExit {
        0%   { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) scale(0.9) translateY(-8px); }
      }

      /* ─── Logo ─── */
      .logo-wrap {
        width: 32px;
        height: 32px;
        margin-left: 8px;
        margin-right: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
        border-radius: 10px;
        transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .logo-wrap svg {
        width: 100%;
        height: 100%;
        display: block;
      }

      /* ─── Controls ─── */
      .controls {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        background: var(--pill-bg);
        border-radius: 12px;
      }

      /* ─── Buttons (iOS tactile) ─── */
      .tool-btn {
        width: 42px;
        height: 42px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
                    background-color 0.25s ease,
                    color 0.25s ease;
        position: relative;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
      }
      .tool-btn svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        pointer-events: none;
      }

      .tool-btn:hover {
        background: var(--btn-hover);
        color: var(--text);
        transform: scale(1.06);
      }
      .tool-btn:hover svg {
        transform: scale(1.1);
      }

      .tool-btn:active {
        transform: scale(0.88);
        transition: transform 0.08s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .tool-btn.active {
        background: var(--accent);
        color: #fff;
        box-shadow: 0 0 0 1px rgba(13,153,255,0.3),
                    0 4px 14px rgba(13,153,255,0.25);
        transform: scale(1);
      }
      .tool-btn.active:hover {
        background: #1a8cff;
        transform: scale(1.04);
      }
      .tool-btn.active:active {
        transform: scale(0.92);
      }

      .tool-btn.close-btn:hover {
        background: var(--danger);
        color: #fff;
        box-shadow: 0 4px 14px rgba(255,59,48,0.25);
      }

      .tool-btn.disabled {
        opacity: 0.4;
        pointer-events: none;
        filter: grayscale(100%);
        transform: scale(1) !important;
      }

      /* Tooltip */
      .tool-btn::after {
        content: attr(data-tooltip);
        position: absolute;
        top: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%) scale(0.9);
        background: rgba(30,30,30,0.92);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: #fff;
        padding: 6px 12px;
        border-radius: 10px;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        z-index: 1;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      }
      .tool-btn:hover::after {
        opacity: 1;
        transform: translateX(-50%) scale(1);
      }

      /* ─── Toast (iOS notification style) ─── */
      .toast {
        position: absolute;
        top: calc(100% + 14px);
        left: 50%;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        background: rgba(28,28,30,0.95);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: 14px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.35);
        opacity: 0;
        pointer-events: none;
        transform: translateX(-50%) translateY(12px) scale(0.92);
        transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                    transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;
        font-size: 13px;
        font-weight: 500;
        color: #fff;
        white-space: nowrap;
        z-index: 2147483646;
        will-change: transform, opacity;
      }
      .toast.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0) scale(1);
        pointer-events: auto;
      }

      /* ─── Toast Icon ─── */
      .toast-icon {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        opacity: 0;
        transform: scale(0.5) rotate(-12deg);
        transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1) 0ms,
                    transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0ms;
      }
      .toast.visible .toast-icon {
        opacity: 1;
        transform: scale(1) rotate(0deg);
      }

      /* iOS-style spinner for processing states */
      .toast-icon .spinner {
        width: 14px;
        height: 14px;
        animation: spinnerRotate 0.8s linear infinite;
      }
      .toast-icon .spinner-track {
        fill: none;
        stroke: rgba(142, 142, 147, 0.2);
        stroke-width: 2;
      }
      .toast-icon .spinner-head {
        fill: none;
        stroke: var(--info);
        stroke-width: 2;
        stroke-linecap: round;
        stroke-dasharray: 20 40;
        animation: spinnerDash 1.5s ease-in-out infinite;
      }

      @keyframes spinnerRotate {
        0%   { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      @keyframes spinnerDash {
        0%   { stroke-dasharray: 1 40; stroke-dashoffset: 0; }
        50%  { stroke-dasharray: 15 40; stroke-dashoffset: -7; }
        100% { stroke-dasharray: 1 40; stroke-dashoffset: -20; }
      }

      .toast-icon.success { background: rgba(48, 209, 88, 0.15); color: var(--success); }
      .toast-icon.error   { background: rgba(255, 159, 10, 0.15); color: var(--warning); }
      .toast-icon.info    { background: rgba(142, 142, 147, 0.15); color: var(--info); }

      .toast-icon svg {
        width: 12px;
        height: 12px;
        fill: currentColor;
      }

      /* ─── Toast Text ─── */
      .toast-text {
        line-height: 1.4;
        opacity: 0;
        transform: translateX(8px);
        transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1) 60ms,
                    transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 60ms;
      }
      .toast.visible .toast-text {
        opacity: 1;
        transform: translateX(0);
      }

      /* Soft text transition for same-type state changes */
      .toast-text.changing {
        opacity: 0;
        transform: translateY(3px);
        transition: opacity 0.15s ease,
                    transform 0.2s ease;
      }

      /* ─── Toast Divider ─── */
      .toast-divider {
        width: 1px;
        height: 18px;
        background: rgba(255,255,255,0.12);
        margin: 0 4px;
        opacity: 0;
        transition: opacity 0.25s ease 120ms;
      }
      .toast.visible .toast-divider {
        opacity: 1;
      }

      /* ─── Toast Action ─── */
      .toast-action {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border: none;
        border-radius: 8px;
        background: rgba(255,255,255,0.08);
        color: #fff;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        opacity: 0;
        transform: scale(0.9);
        transition: opacity 0.25s ease 140ms,
                    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) 140ms,
                    background-color 0.2s ease;
        white-space: nowrap;
      }
      .toast.visible .toast-action {
        opacity: 1;
        transform: scale(1);
      }
      .toast-action:hover {
        background: rgba(255,255,255,0.15);
        transform: scale(1.05);
      }
      .toast-action:active {
        transform: scale(0.92);
        transition: transform 0.08s ease;
      }
      .toast-action.danger {
        color: var(--danger);
        background: rgba(255,59,48,0.15);
      }
      .toast-action.danger:hover {
        background: rgba(255,59,48,0.25);
      }

      /* ─── Selection Highlight (iOS focus) ─── */
      .highlight {
        position: fixed;
        pointer-events: none;
        border: 2.5px solid var(--accent);
        border-radius: 6px;
        background: rgba(13, 153, 255, 0.12);
        z-index: 2147483646;
        box-shadow: 0 0 0 9999px rgba(0,0,0,0.15);
        opacity: 0;
        transform: scale(0.98);
        transition: top 0.15s cubic-bezier(0.4, 0, 0.2, 1),
                    left 0.15s cubic-bezier(0.4, 0, 0.2, 1),
                    width 0.15s cubic-bezier(0.4, 0, 0.2, 1),
                    height 0.15s cubic-bezier(0.4, 0, 0.2, 1),
                    opacity 0.2s ease,
                    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        will-change: transform, opacity, top, left, width, height;
      }
      .highlight.visible {
        opacity: 1;
        transform: scale(1);
      }
    `;
    shadow.appendChild(style);

    const SVG_NS = "http://www.w3.org/2000/svg";

    function makeSvg(size, viewBox, pathData, color) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      svg.setAttribute("viewBox", viewBox);
      for (const d of pathData) {
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", d);
        p.setAttribute("fill", color || "currentColor");
        svg.appendChild(p);
      }
      return svg;
    }

    function makeLogoIcon() {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.setAttribute("viewBox", "0 0 193.56 125.26");
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", "M179.64,21.34c-6.18,0-11.41,11.95-13.23,28.48-3.62-23.5-16.98-40.95-32.92-40.95s-29.23,17.35-32.89,40.76C95.74,21.28,75.32,0,50.85,0,22.77,0,0,28.04,0,62.63s22.77,62.63,50.85,62.63c24.47,0,44.89-21.28,49.75-49.63,3.67,23.41,17,40.76,32.89,40.76s29.3-17.45,32.92-40.95c1.82,16.53,7.05,28.48,13.23,28.48,7.68,0,13.91-18.48,13.91-41.28s-6.23-41.28-13.91-41.28Z");
      path.setAttribute("fill", "#ffffff");

      svg.appendChild(path);
      return svg;
    }

    function makeSpinner() {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("width", "14");
      svg.setAttribute("height", "14");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.classList.add("spinner");

      const track = document.createElementNS(SVG_NS, "circle");
      track.setAttribute("cx", "8");
      track.setAttribute("cy", "8");
      track.setAttribute("r", "6");
      track.classList.add("spinner-track");

      const head = document.createElementNS(SVG_NS, "circle");
      head.setAttribute("cx", "8");
      head.setAttribute("cy", "8");
      head.setAttribute("r", "6");
      head.classList.add("spinner-head");

      svg.appendChild(track);
      svg.appendChild(head);
      return svg;
    }

    const iconPaths = {
      screen: ["M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v7a1.5 1.5 0 0 1-1.5 1.5H9v2h2a.5.5 0 0 1 0 1H5a.5.5 0 0 1 0-1h2v-2H3.5A1.5 1.5 0 0 1 2 10.5v-7ZM3.5 3a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-9Z"],
      select: ["M3 2a1 1 0 0 0-1 1v2.5a.5.5 0 0 1-1 0V3a2 2 0 0 1 2-2h2.5a.5.5 0 0 1 0 1H3Zm7.5-1a.5.5 0 0 1 .5-.5H13a2 2 0 0 1 2 2v2.5a.5.5 0 0 1-1 0V3a1 1 0 0 0-1-1h-2.5a.5.5 0 0 1-.5-.5ZM1.5 10a.5.5 0 0 1 .5.5V13a1 1 0 0 0 1 1h2.5a.5.5 0 0 1 0 1H3a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5Zm13 0a.5.5 0 0 1 .5.5V13a2 2 0 0 1-2 2h-2.5a.5.5 0 0 1 0-1H13a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 .5-.5Z"],
      close: ["M3.47 3.47a.75.75 0 0 1 1.06 0L8 6.94l3.47-3.47a.75.75 0 1 1 1.06 1.06L9.06 8l3.47 3.47a.75.75 0 1 1-1.06 1.06L8 9.06l-3.47 3.47a.75.75 0 0 1-1.06-1.06L6.94 8 3.47 4.53a.75.75 0 0 1 0-1.06Z"]
    };

    const toastIcons = {
      success: ["M12.207 4.793a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L6.5 9.086l4.293-4.293a1 1 0 0 1 1.414 0z"],
      error: ["M8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"],
      info: ["M8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"]
    };

    const panel = document.createElement("div");
    panel.className = "panel inner-stroke";

    // Logo
    const logoWrap = document.createElement("div");
    logoWrap.className = "logo-wrap";
    logoWrap.appendChild(makeLogoIcon());

    // Controls
    const controls = document.createElement("div");
    controls.className = "controls";

    function makeToolBtn(iconKey, tooltip, onClick) {
      const btn = document.createElement("button");
      btn.className = "tool-btn";
      btn.setAttribute("data-tooltip", tooltip);
      btn.appendChild(makeSvg(16, "0 0 16 16", iconPaths[iconKey]));
      btn.addEventListener("click", onClick);
      return btn;
    }

    const btnScreen = makeToolBtn("screen", "Entire screen", () => capture("body", true));
    const btnClose = makeToolBtn("close", "Close", destroy);
    btnClose.classList.add("close-btn");

    // Select button with toggle behavior
    const btnSelect = makeToolBtn("select", "Select element", toggleSelection);

    controls.append(btnScreen, btnSelect, btnClose);

    // Toast
    const toast = document.createElement("div");
    toast.className = "toast inner-stroke";

    const toastIcon = document.createElement("div");
    toastIcon.className = "toast-icon";

    const toastText = document.createElement("span");
    toastText.className = "toast-text";

    const toastDivider = document.createElement("div");
    toastDivider.className = "toast-divider";
    toastDivider.style.display = "none";

    const toastAction = document.createElement("button");
    toastAction.className = "toast-action";
    toastAction.style.display = "none";

    toast.append(toastIcon, toastText, toastDivider, toastAction);
    panel.append(logoWrap, controls, toast);
    shadow.appendChild(panel);

    // Highlight
    const highlight = document.createElement("div");
    highlight.className = "highlight";
    highlight.style.display = "none";
    shadow.appendChild(highlight);

    // Draggable logic
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartX = 0;
    let panelStartY = 0;
    let hasMoved = false;

    panel.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = panel.getBoundingClientRect();
      panelStartX = rect.left;
      panelStartY = rect.top;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const newX = panelStartX + dx;
      const newY = panelStartY + dy;
      if (!hasMoved) {
        hasMoved = true;
        panel.style.transform = "none";
      }
      panel.style.left = newX + "px";
      panel.style.top = newY + "px";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
    });

    let captureAborted = false;
    let stopTimer = null;

    async function capture(selector, autoDestroy = true) {
      if (!window.figma?.capturePage) {
        showStatus("Error: capture script not loaded", "error");
        return;
      }
      captureAborted = false;
      setLoading(true);

      showStatus("Capturing...", "info", "Stop", () => {
        captureAborted = true;
        clearStopTimer();
        hideStatus();
        setLoading(false);
      });

      stopTimer = setTimeout(() => {}, 5e3);

      let ffClipboard = null;
      if (isFirefox) {
        let resolve;
        let reject;
        const blobPromise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        const writePromise = navigator.clipboard.write([new ClipboardItem({ "text/html": blobPromise })]);
        ffClipboard = { resolve, reject, writePromise };
      }

      try {
        const json = await window.figma.capturePage(selector);
        if (captureAborted) {
          ffClipboard?.reject(new Error("aborted"));
          return;
        }
        showStatus("Copying to clipboard...", "info");
        if (ffClipboard) {
          ffClipboard.resolve(await window.figma.wrapForClipboard(json));
          await ffClipboard.writePromise;
        } else {
          await window.figma.writeToClipboard(json);
        }
        showStatus("Copied to clipboard", "success");
        setTimeout(() => {
          if (captureAborted) return;
          showStatus("Now paste into Figma canvas", "success");
          if (autoDestroy) setTimeout(destroy, 3e3);
        }, 3e3);
      } catch (err) {
        if (!captureAborted) {
          showStatus("Error: " + (err.message || String(err)), "error");
        }
        ffClipboard?.reject(err);
        setLoading(false);
      } finally {
        clearStopTimer();
      }
    }

    function clearStopTimer() {
      if (stopTimer !== null) {
        clearTimeout(stopTimer);
        stopTimer = null;
      }
    }

    // Track current toast state for soft transitions
    let currentToastType = null;

    function showStatus(text, type = "info", actionLabel = null, actionCallback = null) {
      const wasVisible = toast.classList.contains("visible");
      const sameType = wasVisible && currentToastType === type;

      // Update action button immediately (no animation needed)
      if (actionLabel && actionCallback) {
        toastAction.textContent = actionLabel;
        toastAction.style.display = "inline-flex";
        toastDivider.style.display = "block";
        toastAction.onclick = () => {
          actionCallback();
          hideStatus();
        };
        if (type === "error" || actionLabel === "Stop") {
          toastAction.classList.add("danger");
        } else {
          toastAction.classList.remove("danger");
        }
      } else {
        toastAction.style.display = "none";
        toastDivider.style.display = "none";
        toastAction.onclick = null;
      }

      if (!wasVisible) {
        // First appearance: full animation
        currentToastType = type;
        toastText.textContent = text;

        toastIcon.replaceChildren();
        toastIcon.className = "toast-icon " + type;
        if (type === "info") {
          toastIcon.appendChild(makeSpinner());
        } else if (toastIcons[type]) {
          const svg = makeSvg(12, "0 0 16 16", toastIcons[type]);
          toastIcon.appendChild(svg);
        }

        toast.classList.add("visible");
        return;
      }

      if (sameType) {
        // Soft transition: only animate text change
        toastText.classList.add("changing");
        setTimeout(() => {
          toastText.textContent = text;
          toastText.classList.remove("changing");
        }, 150);
      } else {
        // Type changed: crossfade icon + text
        currentToastType = type;
        toast.classList.remove("visible");
        setTimeout(() => {
          toastText.textContent = text;

          toastIcon.replaceChildren();
          toastIcon.className = "toast-icon " + type;
          if (type === "info") {
            toastIcon.appendChild(makeSpinner());
          } else if (toastIcons[type]) {
            const svg = makeSvg(12, "0 0 16 16", toastIcons[type]);
            toastIcon.appendChild(svg);
          }

          void toast.offsetWidth;
          toast.classList.add("visible");
        }, 200);
      }
    }

    function hideStatus() {
      currentToastType = null;
      toast.classList.remove("visible");
      setTimeout(() => {
        toastText.textContent = "";
        toastIcon.replaceChildren();
        toastAction.style.display = "none";
        toastDivider.style.display = "none";
      }, 350);
    }

    function setLoading(loading) {
      btnScreen.classList.toggle("disabled", loading);
      btnSelect.classList.toggle("disabled", loading);
    }

    let selecting = false;
    let selectedEl = null;

    function toggleSelection() {
      if (selecting) {
        stopSelection();
        hideStatus();
      } else {
        startSelection();
      }
    }

    function startSelection() {
      if (selecting) return;
      selecting = true;
      btnSelect.classList.add("active");
      document.addEventListener("mousemove", onSelectionMove, true);
      document.addEventListener("click", onSelectionClick, true);
      document.addEventListener("keydown", onSelectionKey, true);
    }

    function stopSelection() {
      selecting = false;
      btnSelect.classList.remove("active");
      highlight.classList.remove("visible");
      setTimeout(() => {
        highlight.style.display = "none";
      }, 200);
      selectedEl = null;
      document.removeEventListener("mousemove", onSelectionMove, true);
      document.removeEventListener("click", onSelectionClick, true);
      document.removeEventListener("keydown", onSelectionKey, true);
    }

    function onSelectionMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === host) return;
      selectedEl = el;
      const rect = el.getBoundingClientRect();
      highlight.style.display = "block";
      void highlight.offsetWidth;
      highlight.classList.add("visible");
      highlight.style.top = rect.top + "px";
      highlight.style.left = rect.left + "px";
      highlight.style.width = rect.width + "px";
      highlight.style.height = rect.height + "px";
    }

    function onSelectionClick(e) {
      e.preventDefault();
      e.stopPropagation();
      const el = selectedEl;
      stopSelection();
      if (el) {
        const tempId = "__figcap_" + Math.random().toString(36).slice(2, 10);
        const hadId = el.id;
        el.id = tempId;
        capture(`#${tempId}`).finally(() => {
          if (hadId) el.id = hadId;
          else el.removeAttribute("id");
        });
      }
    }

    function onSelectionKey(e) {
      if (e.key === "Escape") {
        stopSelection();
        hideStatus();
      }
    }

    function destroy() {
      stopSelection();
      panel.classList.add("exiting");
      setTimeout(() => {
        host.remove();
      }, 300);
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !selecting) destroy();
    });
  })();
})();