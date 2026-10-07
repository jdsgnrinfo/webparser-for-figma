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
        --unit-top: #2A2B27;
        --unit-bottom: #222320;
        --key-top: #34352F;
        --key-bottom: #2B2C28;
        --key-hover-top: #3A3B35;
        --key-hover-bottom: #30312C;
        --well: #191A17;
        --ink: #E4E5DE;
        --ink-soft: #D8D9D2;
        --ink-muted: #8E9087;
        --lime: #C9F35B;
        --accent: #F2551C;
        --accent-top: #FF6B33;
        --error-ink: #FF9B73;
        --mono: "Space Mono", ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace;
        --highlight: inset 0 0.5px 0 rgba(255,255,255,0.08);
      }

      /* ─── Panel (graphite unit, no strokes, top-edge highlight) ─── */
      .panel {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        background: linear-gradient(180deg, var(--unit-top) 0%, var(--unit-bottom) 100%);
        border-radius: 14px;
        box-shadow: var(--highlight), 0 14px 30px -14px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.35);
        font-family: var(--mono);
        font-size: 12px;
        font-weight: 700;
        color: var(--ink);
        z-index: 2147483647;
        user-select: none;
        opacity: 0;
        transform: translateX(-50%) scale(0.92) translateY(-8px);
        animation: panelEnter 0.4s cubic-bezier(0.34, 1.4, 0.64, 1) forwards;
        will-change: transform, opacity;
      }
      /* ─── Bottom tab with the grab pill (the only drag handle) ─── */
      .grip-tab {
        position: absolute;
        top: calc(100% - 1px);
        left: 50%;
        transform: translateX(-50%);
        width: 72px;
        height: 16px;
        border-radius: 0 0 10px 10px;
        background: var(--unit-bottom);
        box-shadow: 0 10px 18px -12px rgba(0,0,0,0.9);
      }
      .grip-tab::before,
      .grip-tab::after {
        content: "";
        position: absolute;
        top: 0;
        width: 10px;
        height: 10px;
        pointer-events: none;
      }
      .grip-tab::before { left: -10px; background: radial-gradient(circle at 0 100%, transparent 10px, var(--unit-bottom) 10.5px); }
      .grip-tab::after { right: -10px; background: radial-gradient(circle at 100% 100%, transparent 10px, var(--unit-bottom) 10.5px); }
      .grip {
        width: 100%;
        height: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: center;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
      }
      .grip i {
        display: block;
        width: 30px;
        height: 4px;
        margin-bottom: 2px;
        border-radius: 99px;
        background: rgba(228,229,222,0.28);
        transition: width 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
      }
      .grip:hover i { width: 44px; background: rgba(228,229,222,0.55); }
      .grip.grabbing { cursor: grabbing; }
      .grip.grabbing i { width: 44px; background: var(--lime); box-shadow: 0 0 8px rgba(201,243,91,0.55); }
      .grip:focus-visible { outline: none; }
      .grip:focus-visible i { background: var(--lime); }
      .panel.dragged.exiting { animation: panelExitFree 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
      @keyframes panelExitFree {
        0%   { opacity: 1; transform: scale(1) translateY(0); }
        100% { opacity: 0; transform: scale(0.94) translateY(-6px); }
      }

      .panel.exiting {
        animation: panelExit 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        pointer-events: none;
      }

      @keyframes panelEnter {
        0%   { opacity: 0; transform: translateX(-50%) scale(0.92) translateY(-8px); }
        100% { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
      }
      @keyframes panelExit {
        0%   { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) scale(0.94) translateY(-6px); }
      }

      /* ─── Logo (recessed well) ─── */
      .logo-wrap {
        position: relative;
        cursor: pointer;
        text-decoration: none;
        transition: background 0.12s ease;
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        border-radius: 9px;
        background: var(--well);
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.6);
      }
      .logo-wrap:hover { background: #1E1F1B; }
      .logo-wrap:hover svg path { fill: #FFFFFF; }
      .logo-wrap:focus-visible { outline: 1px solid var(--lime); outline-offset: 2px; }
      .logo-wrap svg path { transition: fill 0.12s ease; }
      .logo-wrap svg {
        width: 22px;
        height: 22px;
        display: block;
      }

      /* ─── Controls ─── */
      .controls {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: 6px;
      }
      .tool-btn.close-btn { margin-left: 6px; }

      /* ─── Keys ─── */
      .tool-btn {
        position: relative;
        width: 44px;
        height: 44px;
        border: 0;
        border-radius: 9px;
        padding: 0;
        background: linear-gradient(180deg, var(--key-top), var(--key-bottom));
        color: var(--ink-soft);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--highlight), 0 2px 4px -2px rgba(0,0,0,0.6);
        transition: transform 0.07s ease, box-shadow 0.07s ease, background 0.12s ease, color 0.12s ease;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
      }
      .tool-btn:hover { z-index: 4; }
      .tool-btn svg {
        width: 20px;
        height: 20px;
        pointer-events: none;
      }
      .tool-btn:hover {
        background: linear-gradient(180deg, var(--key-hover-top), var(--key-hover-bottom));
        color: var(--ink);
      }
      .tool-btn:active {
        transform: translateY(1px);
        box-shadow: inset 0 1px 2px rgba(0,0,0,0.5);
      }

      /* Primary key: full-page capture */
      .tool-btn.primary {
        color: #fff;
        background: linear-gradient(180deg, var(--accent-top), var(--accent));
        box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.3), 0 2px 4px -2px rgba(0,0,0,0.6);
      }
      .tool-btn.primary:hover {
        background: linear-gradient(180deg, #FF7A47, #F4612C);
        color: #fff;
      }

      /* Latched key: element selection on */
      .tool-btn.active {
        color: var(--lime);
        background: #151612;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.7);
        transform: translateY(1px);
      }
      .tool-btn.active:hover {
        background: #181915;
        color: var(--lime);
      }

      .tool-btn.close-btn { color: var(--ink-muted); }
      .tool-btn.close-btn:hover { color: var(--ink); }

      /* Busy: keys stay pressed while a capture runs */
      .tool-btn.disabled {
        pointer-events: none;
        transform: translateY(1px);
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);
        opacity: 0.85;
      }

      /* Tooltip: same surface as the toolbar */
      .tool-btn::after,
      .logo-wrap::after {
        content: attr(data-tooltip);
        position: absolute;
        top: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%) translateY(-3px);
        padding: 7px 10px;
        border-radius: 9px;
        background: linear-gradient(180deg, var(--unit-top), var(--unit-bottom));
        box-shadow: var(--highlight), 0 12px 26px -12px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.35);
        color: var(--ink);
        font-family: var(--mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease 0.2s, transform 0.2s ease 0.2s;
        z-index: 5;
      }
      .tool-btn:hover::after,
      .logo-wrap:hover::after {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* ─── Status toast: icon · text · divider · action ─── */
      .toast {
        position: absolute;
        top: calc(100% + 24px);
        left: 50%;
        display: flex;
        align-items: center;
        gap: 10px;
        height: 40px;
        padding: 0 6px;
        box-sizing: border-box;
        background: var(--unit-bottom);
        border-radius: 12px;
        box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.07), 0 12px 26px -14px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.3);
        opacity: 0;
        pointer-events: none;
        transform: translateX(-50%) translateY(-4px);
        transition: opacity 0.22s ease, transform 0.22s ease-out;
        font-family: var(--mono);
        font-size: 12px;
        font-weight: 700;
        color: var(--ink);
        white-space: nowrap;
        z-index: 1;
        will-change: transform, opacity;
      }
      .toast.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
        pointer-events: auto;
      }

      .toast-icon {
        width: 28px;
        height: 28px;
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background: #151612;
        color: var(--lime);
      }
      .toast-icon svg { width: 16px; height: 16px; display: block; }
      .toast-icon.error { background: var(--accent); color: #fff; }
      .toast-icon.select { color: #fff; }
      .toast-icon.idle { color: var(--ink-muted); }

      /* Animated state icons */
      .toast-icon .spin { animation: wpSpin 0.8s linear infinite; }
      .toast-icon .draw path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: wpDraw 0.35s ease-out forwards; }
      .toast-icon .shake { animation: wpShake 0.45s ease-in-out; }
      .toast-icon .pulse { animation: wpPulse 1.2s ease-in-out infinite; }
      @keyframes wpSpin { to { transform: rotate(360deg); } }
      @keyframes wpDraw { to { stroke-dashoffset: 0; } }
      @keyframes wpShake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-3px); }
        40% { transform: translateX(3px); }
        60% { transform: translateX(-2px); }
        80% { transform: translateX(2px); }
      }
      @keyframes wpPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(0.82); opacity: 0.6; }
      }

      .toast-text {
        padding-right: 8px;
        line-height: 1.4;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }
      .toast.is-error .toast-text { color: var(--error-ink); }
      .toast-text.changing {
        opacity: 0;
        transform: translateY(3px);
      }

      /* No strokes: the divider is only spacing */
      .toast-divider {
        width: 0;
        height: 22px;
        margin: 0 -2px;
      }

      .toast-action {
        display: inline-flex;
        align-items: center;
        height: 28px;
        padding: 0 10px;
        border: 0;
        border-radius: 7px;
        background: linear-gradient(180deg, var(--key-top), var(--key-bottom));
        box-shadow: var(--highlight);
        color: var(--ink);
        font-family: var(--mono);
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.12s ease, transform 0.07s ease;
      }
      .toast-action:hover { background: linear-gradient(180deg, var(--key-hover-top), var(--key-hover-bottom)); }
      .toast-action:active { transform: translateY(1px); box-shadow: inset 0 1px 2px rgba(0,0,0,0.5); }
      .toast-action.danger { color: var(--error-ink); }

      /* ─── Selection highlight ─── */
      .highlight {
        position: fixed;
        pointer-events: none;
        border: 1.5px solid var(--accent);
        border-radius: 6px;
        background: rgba(242, 85, 28, 0.1);
        z-index: 2147483646;
        box-shadow: 0 0 0 9999px rgba(0,0,0,0.18);
        opacity: 0;
        transition: top 0.12s ease, left 0.12s ease, width 0.12s ease, height 0.12s ease, opacity 0.15s ease;
        will-change: opacity, top, left, width, height;
      }
      .highlight.visible {
        opacity: 1;
      }
    `;
    shadow.appendChild(style);

    const SVG_NS = "http://www.w3.org/2000/svg";

    function svgEl(tag, attrs) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      return node;
    }
    function makeIcon(viewBox, parts, className) {
      const svg = svgEl("svg", { viewBox, fill: "none", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round" });
      if (className) svg.setAttribute("class", className);
      for (const [tag, attrs] of parts) svg.appendChild(svgEl(tag, attrs));
      return svg;
    }
    const keyIcons = {
      screen: () => makeIcon("0 0 24 24", [
        ["rect", { x: 3, y: 4, width: 18, height: 12, rx: 1.5, "stroke-width": 1.3 }],
        ["path", { d: "M8 20h8M12 16v4", "stroke-width": 1.3 }]
      ]),
      select: () => makeIcon("0 0 24 24", [
        ["path", { d: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4", "stroke-width": 1.3 }],
        ["path", { d: "M10 10l6 2.5-2.5 1-1 2.5z", "stroke-width": 1.3 }]
      ]),
      close: () => makeIcon("0 0 24 24", [
        ["path", { d: "M6 6l12 12M18 6L6 18", "stroke-width": 1.5 }]
      ])
    };
    // Animated state icons for the status toast
    const toastIconBuilders = {
      info: () => makeIcon("0 0 16 16", [
        ["circle", { cx: 8, cy: 8, r: 6, "stroke-opacity": 0.25, "stroke-width": 1.4 }],
        ["path", { d: "M8 2a6 6 0 0 1 6 6", "stroke-width": 1.4 }]
      ], "spin"),
      success: () => makeIcon("0 0 16 16", [
        ["path", { d: "M3.5 8.5l3 3 6-7", "stroke-width": 1.5 }]
      ], "draw"),
      error: () => makeIcon("0 0 16 16", [
        ["path", { d: "M8 4v4.5", "stroke-width": 1.5 }],
        ["circle", { cx: 8, cy: 11.8, r: 1.2, fill: "currentColor", stroke: "none" }]
      ], "shake"),
      select: () => makeIcon("0 0 16 16", [
        ["circle", { cx: 8, cy: 8, r: 5, "stroke-width": 1.2 }],
        ["circle", { cx: 8, cy: 8, r: 1.6, fill: "currentColor", stroke: "none" }],
        ["path", { d: "M8 0.5v2.5M8 13v2.5M0.5 8h2.5M13 8h2.5", "stroke-width": 1.2 }]
      ], "pulse"),
      idle: () => makeIcon("0 0 16 16", [
        ["rect", { x: 4.5, y: 4.5, width: 7, height: 7, rx: 1, fill: "currentColor", stroke: "none" }]
      ])
    };
    function setToastIcon(type) {
      toastIcon.replaceChildren();
      toastIcon.className = "toast-icon " + type;
      const build = toastIconBuilders[type];
      if (build) toastIcon.appendChild(build());
      toast.classList.toggle("is-error", type === "error");
    }
    function makeLogoIcon() {
      // WebParser isotype
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 189.26 187.34");
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", "M108.83,160.31l-28.45-.04-.05,27.07H0S.03,0,.03,0h189.18s.05,187.33.05,187.33h-80.42s-.01-27.02-.01-27.02ZM108.82,108.25v29.26s26.65-.02,26.65-.02l.08,22.86,26.63-.05V27.06s-135.06,0-135.06,0v133.29s26.31-.06,26.31-.06l.02-22.79,26.91-.03-.04-29.3,28.49.07Z");
      path.setAttribute("fill", "#E4E5DE");
      svg.appendChild(path);
      return svg;
    }

    const panel = document.createElement("div");
    panel.className = "panel inner-stroke";

    // Logo
    const logoWrap = document.createElement("a");
    logoWrap.className = "logo-wrap";
    logoWrap.href = "https://github.com/jdsgnrinfo/webparser-for-figma";
    logoWrap.target = "_blank";
    logoWrap.rel = "noopener noreferrer";
    logoWrap.draggable = false;
    logoWrap.setAttribute("aria-label", "WebParser for Figma on GitHub");
    logoWrap.setAttribute("data-tooltip", "GitHub");
    logoWrap.appendChild(makeLogoIcon());

    // Controls
    const controls = document.createElement("div");
    controls.className = "controls";

    function makeToolBtn(iconKey, tooltip, onClick) {
      const btn = document.createElement("button");
      btn.className = "tool-btn";
      btn.setAttribute("data-tooltip", tooltip);
      btn.appendChild(keyIcons[iconKey]());
      btn.addEventListener("click", onClick);
      return btn;
    }

    const btnScreen = makeToolBtn("screen", "Entire screen", () => capture("body"));
    btnScreen.classList.add("primary");
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
    // Bottom tab with the grab pill
    const gripTab = document.createElement("div");
    gripTab.className = "grip-tab";
    const grip = document.createElement("button");
    grip.className = "grip";
    grip.type = "button";
    grip.setAttribute("aria-label", "Move toolbar");
    grip.appendChild(document.createElement("i"));
    gripTab.appendChild(grip);

    panel.append(logoWrap, controls, gripTab, toast);
    shadow.appendChild(panel);

    // Highlight
    const highlight = document.createElement("div");
    highlight.className = "highlight";
    highlight.style.display = "none";
    shadow.appendChild(highlight);

    // Draggable logic: the panel is detached from its centering transform (and its
    // enter animation, which would keep re-applying it) the moment it is grabbed, then
    // follows the pointer from the exact point where it was picked up.
    let drag = null;

    function detachPanel() {
      if (panel.classList.contains("dragged")) return;
      // Grabbed while still appearing: measure its final size, not a scaled frame
      try {
        panel.getAnimations().forEach((animation) => animation.finish());
      } catch (_err) {
      }
      const rect = panel.getBoundingClientRect();
      panel.style.animation = "none";
      panel.style.opacity = "1";
      panel.style.transform = "none";
      panel.style.left = rect.left + "px";
      panel.style.top = rect.top + "px";
      panel.classList.add("dragged");
    }

    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      // Keep the exact point that was grabbed under the pointer, even if the panel
      // was still scaled by its enter animation when it was picked up
      const seen = panel.getBoundingClientRect();
      detachPanel();
      const rect = panel.getBoundingClientRect();
      const offsetX = (e.clientX - seen.left) * (rect.width / (seen.width || rect.width));
      const offsetY = (e.clientY - seen.top) * (rect.height / (seen.height || rect.height));
      panel.style.left = e.clientX - offsetX + "px";
      panel.style.top = e.clientY - offsetY + "px";
      // The tab hangs below the panel: keep it on screen too
      drag = { id: e.pointerId, offsetX, offsetY, width: rect.width, height: rect.height + gripTab.offsetHeight - 1 };
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("grabbing");
      e.preventDefault();
    });

    grip.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const maxX = Math.max(0, window.innerWidth - drag.width);
      const maxY = Math.max(0, window.innerHeight - drag.height);
      const x = Math.min(Math.max(e.clientX - drag.offsetX, 0), maxX);
      const y = Math.min(Math.max(e.clientY - drag.offsetY, 0), maxY);
      panel.style.left = x + "px";
      panel.style.top = y + "px";
    });

    function endDrag(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      try {
        grip.releasePointerCapture(drag.id);
      } catch (_err) {
      }
      drag = null;
      grip.classList.remove("grabbing");
    }
    grip.addEventListener("pointerup", endDrag);
    grip.addEventListener("pointercancel", endDrag);
    grip.addEventListener("lostpointercapture", endDrag);

    let captureAborted = false;
    let stopTimer = null;

    async function capture(selector) {
      if (!window.figma?.capturePage) {
        showStatus("Error: capture script not loaded", "error");
        return;
      }
      captureAborted = false;
      setLoading(true);

      showStatus("Capturing...", "info", "Stop", () => {
        captureAborted = true;
        clearStopTimer();
        setLoading(false);
        flashStatus("Capture cancelled");
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
        setLoading(false);
        showStatus("Copied to clipboard", "success");
        // The toolbar stays open: it only closes with the close button, Esc, or
        // after a few minutes without use
        setTimeout(() => {
          if (captureAborted || busy) return;
          showStatus("Now paste into Figma canvas", "success");
          setTimeout(() => {
            if (currentToastType === "success" && !busy) hideStatus();
          }, 4e3);
        }, 2500);
      } catch (err) {
        if (!captureAborted) {
          const retry = selector === "body" ? () => setTimeout(() => capture(selector), 400) : null;
          showStatus("Error: " + (err.message || String(err)), "error", retry ? "Retry" : null, retry);
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

        setToastIcon(type);

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

          setToastIcon(type);

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

    let busy = false;
    function setLoading(loading) {
      busy = loading;
      bumpIdle();
      btnScreen.classList.toggle("disabled", loading);
      btnSelect.classList.toggle("disabled", loading);
    }

    let selecting = false;
    let selectedEl = null;

    function toggleSelection() {
      if (selecting) {
        cancelSelection();
      } else {
        startSelection();
      }
    }

    function cancelSelection() {
      if (!selecting) return;
      stopSelection();
      flashStatus("Selection cancelled");
    }

    function startSelection() {
      if (selecting) return;
      selecting = true;
      btnSelect.classList.add("active");
      showStatus("Click an element to capture", "select", "Cancel", () => cancelSelection());
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

    function isOwnUI(e) {
      return typeof e.composedPath === "function" && e.composedPath().includes(host);
    }

    function onSelectionMove(e) {
      if (isOwnUI(e)) {
        highlight.classList.remove("visible");
        selectedEl = null;
        return;
      }
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
      // A click on the toolbar or its toast (Cancel, Close...) is handled by them
      if (isOwnUI(e)) return;
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
        // Esc cancels the selection only; it must not also close the toolbar
        e.stopPropagation();
        cancelSelection();
      }
    }

    // Shows a neutral state (cancelled) briefly. Waits for a toast that is being
    // hidden by its action button to finish, so the new text is not wiped.
    function flashStatus(text) {
      setTimeout(() => {
        showStatus(text, "idle");
        setTimeout(() => {
          if (currentToastType === "idle") hideStatus();
        }, 1800);
      }, 400);
    }

    // Closes by itself only after a few minutes without any use
    const IDLE_CLOSE_MS = 3 * 60 * 1000;
    let idleTimer = null;
    let destroyed = false;
    function bumpIdle() {
      if (destroyed) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (busy || selecting) bumpIdle();
        else destroy();
      }, IDLE_CLOSE_MS);
    }
    panel.addEventListener("pointermove", bumpIdle, { passive: true });
    panel.addEventListener("pointerdown", bumpIdle, { passive: true });
    bumpIdle();

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(idleTimer);
      stopSelection();
      // A moved panel had its animation switched off inline; let the exit one run
      if (panel.classList.contains("dragged")) panel.style.animation = "";
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