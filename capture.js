"use strict";
(() => {
  // src/lib/media/resolver.ts
  var UNSUPPORTED_IMAGE_TYPES = /* @__PURE__ */ new Set(["image/avif", "image/heif", "image/heic"]);
  var bridgeUnavailable = false;
  var bridgeAnswered = false;
  var BRIDGE_TIMEOUT = 2e4;
  var IMAGE_DECODE_TIMEOUT = 4e3;
  var CaptureError = class extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
      this.name = "CaptureError";
    }
  };
  var ResourceResolver = class {
    constructor(options) {
      this.promises = /* @__PURE__ */ new Map();
      /** Auto-incrementing counter used to mint `rasterized:N` pseudo-URLs. */
      this.rasterizedId = 0;
      this.options = options;
    }
    addPromise(url, promise) {
      this.promises.set(
        url,
        promise.catch((error) => ({
          url,
          blob: null,
          error: String(error)
        }))
      );
    }
    addImage(url, sourceElement) {
      if (!url || this.promises.has(url)) return;
      const promise = this.options.skipRemoteAssetSerialization && isRemoteUrl(url) ? Promise.resolve({ url, blob: null }) : fetchImageAsBlob(url, sourceElement);
      this.addPromise(url, promise);
    }
    addCanvas(canvas) {
      const url = this.getRasterizedImageUrl();
      const promise = canvasToBlob(canvas).then((blob) => ({ url, blob }));
      this.addPromise(url, promise);
      return url;
    }
    addVideo(video) {
      const currentSrc = video.currentSrc;
      if (!currentSrc || this.promises.has(currentSrc)) return;
      const promise = captureVideoFrame(video).then((blob) => ({
        url: currentSrc,
        blob
      }));
      this.addPromise(currentSrc, promise);
    }
    getRasterizedImageUrl() {
      return `rasterized:${this.rasterizedId++}`;
    }
    async getBlobMap() {
      const blobMap = /* @__PURE__ */ new Map();
      for (const [url, promise] of this.promises.entries()) {
        const result = await promise;
        blobMap.set(url, result);
      }
      return blobMap;
    }
  };
  function resolveResources(element, computedStyle, assetCollector) {
    collectImageElement(element, assetCollector);
    collectVideoElement(element, assetCollector);
    collectBackgroundImages(assetCollector, computedStyle);
  }
  function isRemoteUrl(url) {
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("//")) {
      return isRemoteUrl(window.location.href);
    }
    try {
      const hostname = new URL(url, window.location.href).hostname;
      return !(hostname === "0.0.0.0" || hostname === "localhost" || hostname.startsWith("127.") || hostname === "[::1]" || hostname === "::1" || hostname.endsWith(".local"));
    } catch {
      return false;
    }
  }
  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        blob ? resolve(blob) : reject(new Error("Failed to create blob from canvas"));
      }, "image/png");
    });
  }
  function collectBackgroundImages(assetCollector, computedStyle) {
    const matches = computedStyle.backgroundImage?.matchAll(
      /url\("(.*?)"\)/g
    );
    if (!matches) return;
    for (const [, url] of matches) {
      assetCollector.addImage(url);
    }
  }
  function collectImageElement(element, assetCollector) {
    if (element instanceof HTMLImageElement) {
      assetCollector.addImage(element.currentSrc, element);
    }
  }
  function collectVideoElement(element, assetCollector) {
    if (!(element instanceof HTMLVideoElement)) return;
    if (element.poster) {
      assetCollector.addImage(element.poster);
    }
    if (element.currentSrc && !shouldSkipVideo(element)) {
      assetCollector.addVideo(element);
    }
  }
  function shouldSkipVideo(video) {
    if (!video.poster) return false;
    return video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.currentTime === 0 && video.paused;
  }

  /**
   * Create a grey placeholder SVG blob when an image cannot be loaded.
   * Uses the source element's natural dimensions if available.
   */
  function createPlaceholderBlob(sourceElement) {
    let w = 100;
    let h = 100;
    if (sourceElement instanceof HTMLImageElement) {
      w = sourceElement.naturalWidth || 100;
      h = sourceElement.naturalHeight || 100;
    } else if (sourceElement instanceof HTMLVideoElement) {
      w = sourceElement.videoWidth || 100;
      h = sourceElement.videoHeight || 100;
    } else if (sourceElement instanceof HTMLCanvasElement) {
      w = sourceElement.width || 100;
      h = sourceElement.height || 100;
    }
    // Clamp to reasonable max to avoid huge placeholders
    w = Math.min(Math.max(w, 32), 800);
    h = Math.min(Math.max(h, 32), 800);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect width="100%" height="100%" fill="#2c2c2e"/>
      <rect x="${w * 0.35}" y="${h * 0.35}" width="${w * 0.3}" height="${h * 0.3}" rx="3" fill="#3a3a3c" opacity="0.6"/>
      <rect x="${w * 0.42}" y="${h * 0.42}" width="${w * 0.16}" height="${h * 0.16}" rx="2" fill="#48484a" opacity="0.4"/>
    </svg>`;
    return new Blob([svg], { type: "image/svg+xml" });
  }

  /**
   * Rasterize a DOM element (img, video, canvas) directly to PNG using an offscreen canvas.
   * This bypasses CORS restrictions for elements already rendered on the page,
   * as long as the canvas is not tainted.
   */
  async function rasterizeDOMElement(element) {
    try {
      if (!element) return null;

      let width = 100;
      let height = 100;

      if (element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0) {
        width = element.naturalWidth;
        height = element.naturalHeight;
      } else if (element instanceof HTMLVideoElement && element.videoWidth > 0) {
        width = element.videoWidth;
        height = element.videoHeight;
      } else if (element instanceof HTMLCanvasElement) {
        width = element.width;
        height = element.height;
      } else {
        const rect = element.getBoundingClientRect();
        width = rect.width;
        height = rect.height;
      }

      // Clamp dimensions
      width = Math.min(Math.max(width, 32), 2000);
      height = Math.min(Math.max(height, 32), 2000);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      // Draw element to canvas
      if (element instanceof HTMLImageElement || element instanceof HTMLVideoElement || element instanceof HTMLCanvasElement) {
        ctx.drawImage(element, 0, 0, width, height);
      } else {
        // Generic elements not supported by direct drawImage
        return null;
      }

      // Test if canvas is tainted (CORS blocked)
      try {
        canvas.toBlob(() => {}, "image/png");
      } catch (e) {
        // Tainted canvas - cannot extract pixels
        return null;
      }

      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          blob ? resolve(blob) : reject(new Error("toBlob returned null"));
        }, "image/png");
      });
    } catch (err) {
      return null;
    }
  }

  // Large payloads make Figma's paste fail or drop content, so images are kept in their
  // original compressed format and downscaled when far bigger than what is displayed.
  var MAX_IMAGE_DIMENSION = 2560;
  var IMAGE_OPTIMIZE_MIN_BYTES = 300 * 1024;
  async function fetchImageAsBlob(url, sourceElement) {
    const result = await fetchImageAsBlobRaw(url, sourceElement);
    if (result.blob && !result.error) {
      try {
        result.blob = await optimizeImageBlob(result.blob, sourceElement);
      } catch {}
    }
    return result;
  }
  async function optimizeImageBlob(blob, sourceElement) {
    if (blob.size < IMAGE_OPTIMIZE_MIN_BYTES) return blob;
    if (!/^image\/(png|jpeg|webp|bmp)$/.test(blob.type)) return blob;
    const bitmap = await createImageBitmap(blob);
    try {
      let maxDim = MAX_IMAGE_DIMENSION;
      if (sourceElement instanceof Element) {
        const r = sourceElement.getBoundingClientRect();
        const displayed = Math.max(r.width, r.height) * Math.max(2, window.devicePixelRatio || 1);
        if (displayed > 0) maxDim = Math.min(maxDim, Math.max(displayed, 256));
      }
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return blob;
      ctx.drawImage(bitmap, 0, 0, width, height);
      const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/webp";
      const optimized = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
      return optimized && optimized.size < blob.size ? optimized : blob;
    } finally {
      bitmap.close();
    }
  }
  async function fetchImageAsBlobRaw(url, sourceElement) {
    // Inline data: and blob: images can always be read directly by the page
    if (url.startsWith("data:") || url.startsWith("blob:")) {
      try {
        let blob = await (await fetch(url)).blob();
        if (UNSUPPORTED_IMAGE_TYPES.has(blob.type)) {
          blob = await convertUnsupportedImage(blob);
        }
        return { url, blob };
      } catch {}
      if (sourceElement && sourceElement.naturalWidth > 0 && sourceElement.complete) {
        try {
          return { url, blob: await rasterizeLoadedImage(sourceElement) };
        } catch {}
      }
      return { url, blob: createPlaceholderBlob(sourceElement), error: `Failed to read inline image` };
    }
    const sameOrigin = isSameOrigin(url);

    if (sameOrigin) {
      // 1. Network fetch first: keeps the original (compressed / vector) bytes and is
      //    normally served from the HTTP cache since the page already loaded it.
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15e3) });
        if (response.ok) {
          let blob = await response.blob();
          if (UNSUPPORTED_IMAGE_TYPES.has(blob.type)) {
            blob = await convertUnsupportedImage(blob);
          }
          return { url, blob };
        }
      } catch {}

      // 2. Rasterize the already-loaded image
      if (sourceElement && sourceElement.naturalWidth > 0 && sourceElement.complete) {
        try {
          const blob = await rasterizeLoadedImage(sourceElement);
          return { url, blob };
        } catch {}
      }

      // 3. Try DOM rasterization (screenshot of rendered element)
      if (sourceElement) {
        try {
          const blob = await rasterizeDOMElement(sourceElement);
          if (blob) return { url, blob };
        } catch {}
      }

      // 4. Fallback to placeholder
      return { url, blob: createPlaceholderBlob(sourceElement), error: `Failed to fetch same-origin image: ${url}` };
    }

    // Cross-origin path
    // 1. Try extension bridge (background script fetch)
    // A failed fetch (404, CORS, slow image) only affects that image; the bridge is
    // disabled only when it never answers at all (e.g. Firefox without injector).
    if (!bridgeUnavailable) {
      try {
        const blob = await fetchViaExtensionBridge(url);
        if (blob) {
          bridgeAnswered = true;
          let result = blob;
          if (UNSUPPORTED_IMAGE_TYPES.has(result.type)) {
            result = await convertUnsupportedImage(result).catch(() => result);
          }
          return { url, blob: result };
        }
        if (!bridgeAnswered) bridgeUnavailable = true;
      } catch {
        bridgeAnswered = true;
      }
    }

    // 2. Try DOM rasterization for cross-origin images already rendered
    if (sourceElement && sourceElement.naturalWidth > 0 && sourceElement.complete) {
      try {
        const blob = await rasterizeDOMElement(sourceElement);
        if (blob) return { url, blob };
      } catch {}

      try {
        const blob = await rasterizeLoadedImage(sourceElement);
        return { url, blob };
      } catch {}
    }

    // 3. Search for another instance of the same image on the page
    const existingImg = findLoadedImageOnPage(url);
    if (existingImg) {
      try {
        const blob = await rasterizeDOMElement(existingImg);
        if (blob) return { url, blob };
      } catch {}

      try {
        const blob = await rasterizeLoadedImage(existingImg);
        return { url, blob };
      } catch {}
    }

    // 4. Final fallback: grey placeholder
    return { url, blob: createPlaceholderBlob(sourceElement), error: `Cross-origin image, bridge unavailable: ${url}` };
  }
  function fetchViaExtensionBridge(url) {
    return new Promise((resolve, reject) => {
      const callbackId = `figma-fetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, BRIDGE_TIMEOUT);
      function onResult(event) {
        const detail = event.detail;
        if (detail?.callbackId !== callbackId) return;
        cleanup();
        if (detail.result?.error) {
          reject(new Error(detail.result.error));
          return;
        }
        if (detail.result?.dataUrl) {
          fetch(detail.result.dataUrl).then((r) => r.blob()).then(resolve).catch(reject);
        } else {
          resolve(null);
        }
      }
      function cleanup() {
        clearTimeout(timeout);
        window.removeEventListener("figma-capture-fetch-result", onResult);
      }
      window.addEventListener("figma-capture-fetch-result", onResult);
      window.dispatchEvent(
        new CustomEvent("figma-capture-fetch", {
          detail: { url, callbackId }
        })
      );
    });
  }
  function rasterizeLoadedImage(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return Promise.reject(new Error("Failed to get canvas context"));
    }
    ctx.drawImage(img, 0, 0);
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          blob ? resolve(blob) : reject(new Error("toBlob returned null"));
        }, "image/png");
      } catch (e) {
        reject(e);
      }
    });
  }
  function findLoadedImageOnPage(url) {
    const images = document.querySelectorAll("img");
    for (const img of images) {
      if ((img.currentSrc === url || img.src === url) && img.complete && img.naturalWidth > 0) {
        return img;
      }
    }
    return null;
  }
  async function convertUnsupportedImage(blob) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to get canvas context for image conversion");
      }
      ctx.drawImage(image, 0, 0);
      return await canvasToBlob(canvas);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  function isSameOrigin(url) {
    try {
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  async function loadCrossOriginVideo(video) {
    const src = video.currentSrc ?? video.src;
    if (isSameOrigin(src) || video.crossOrigin !== null) return null;
    const clonedVideo = document.createElement("video");
    clonedVideo.crossOrigin = "anonymous";
    clonedVideo.src = src;
    clonedVideo.muted = true;
    clonedVideo.preload = "auto";
    clonedVideo.style.position = "absolute";
    clonedVideo.style.visibility = "hidden";
    clonedVideo.style.pointerEvents = "none";
    return new Promise((resolve, reject) => {
      const targetTime = video.currentTime;
      let seeked = false;
      let frameReady = false;
      let frameCallbackId = null;
      const timeout = setTimeout(onTimeout, 1e4);
      clonedVideo.addEventListener("error", onError);
      if (targetTime === 0) {
        seeked = true;
        frameCallbackId = clonedVideo.requestVideoFrameCallback(onFrameReady);
        clonedVideo.play().then(() => clonedVideo.pause()).catch(onError);
      } else if (clonedVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
        seekToTarget();
      } else {
        clonedVideo.addEventListener("loadedmetadata", seekToTarget, {
          once: true
        });
      }
      function seekToTarget() {
        clonedVideo.currentTime = targetTime;
        clonedVideo.addEventListener("seeked", onSeeked, { once: true });
        frameCallbackId = clonedVideo.requestVideoFrameCallback(onFrameReady);
      }
      function onFrameReady() {
        frameReady = true;
        maybeResolve();
      }
      function onSeeked() {
        seeked = true;
        maybeResolve();
      }
      function maybeResolve() {
        if (seeked && frameReady) {
          cleanup();
          resolve(clonedVideo);
        }
      }
      function cleanup() {
        clearTimeout(timeout);
        clonedVideo.removeEventListener("error", onError);
        clonedVideo.removeEventListener("loadedmetadata", seekToTarget);
        clonedVideo.removeEventListener("seeked", onSeeked);
        if (frameCallbackId !== null) {
          clonedVideo.cancelVideoFrameCallback(frameCallbackId);
        }
      }
      function onError() {
        const errorCode = clonedVideo.error?.code;
        const errorMessage = clonedVideo.error?.message;
        const err = new Error(
          `Video error: code: ${errorCode}, message: ${errorMessage} (readyState: ${clonedVideo.readyState})`
        );
        cleanup();
        cleanupVideo(clonedVideo);
        reject(err);
      }
      function onTimeout() {
        cleanup();
        cleanupVideo(clonedVideo);
        reject(new CaptureError("Video loading timeout", "VIDEO_TIMEOUT"));
      }
    });
  }
  function cleanupVideo(video) {
    video.src = "";
  }
  async function captureVideoFrame(video) {
    // 1. Try DOM rasterization first (screenshot of current frame)
    try {
      const domBlob = await rasterizeDOMElement(video);
      if (domBlob) return domBlob;
    } catch {}

    // 2. Fallback to cross-origin clone method
    const crossOriginVideo = await loadCrossOriginVideo(video);
    const sourceVideo = crossOriginVideo ?? video;
    try {
      if (sourceVideo.videoWidth === 0 || sourceVideo.videoHeight === 0) {
        throw new Error("Video has invalid dimensions");
      }
      const canvas = document.createElement("canvas");
      canvas.width = sourceVideo.videoWidth;
      canvas.height = sourceVideo.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }
      ctx.drawImage(sourceVideo, 0, 0);
      return canvasToBlob(canvas);
    } finally {
      if (crossOriginVideo) {
        cleanupVideo(crossOriginVideo);
      }
    }
  }

  // src/lib/encoding.ts
  async function uint8ArrayToDataUrl(data) {
    return new Promise((resolve, reject) => {
      const reader = Object.assign(new FileReader(), {
        onload: () => resolve(reader.result),
        onerror: () => reject(reader.error)
      });
      reader.readAsDataURL(
        new File([data], "", { type: "application/octet-stream" })
      );
    });
  }
  async function blobToBase64Object(blob) {
    if (blob == null) return null;
    const arrayBuffer = await blob.arrayBuffer();
    const dataUrl = await uint8ArrayToDataUrl(new Uint8Array(arrayBuffer));
    return {
      type: blob.type,
      base64Blob: dataUrl
    };
  }
  async function treeToJson(tree) {
    const serializedAssets = {};
    for (const [key, asset] of tree.assets.entries()) {
      serializedAssets[key] = {
        ...asset,
        blob: await blobToBase64Object(asset.blob)
      };
    }
    return JSON.stringify({
      ...tree,
      assets: serializedAssets,
      fonts: tree.fonts
    });
  }
  async function wrapForClipboard(jsonString) {
    const dataUrl = await uint8ArrayToDataUrl(
      new TextEncoder().encode(jsonString)
    );
    const base64Payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const openTag = "<!--(figh2d)";
    const closeTag = "(/figh2d)-->";
    const html = '<span data-h2d="' + openTag + base64Payload + closeTag + '"></span>';
    return new Blob([html], { type: "text/html" });
  }

  // src/lib/react/fiber.ts
  var DATA_FG_PREFIX = "data-fg-";
  function isFigmaAttribute(name) {
    return name.startsWith(DATA_FG_PREFIX);
  }
  function getReactFiber(element) {
    if (!element) return void 0;
    for (const key in element) {
      if (key.startsWith("__reactFiber")) {
        return element[key];
      }
    }
    return void 0;
  }
  function getFiberProps(fiber) {
    if (!fiber) return void 0;
    const props = fiber.pendingProps ?? fiber.memoizedProps;
    if (!props) return void 0;
    const propsCopy = { ...props };
    delete propsCopy.children;
    return propsCopy;
  }
  function parseSourceAnnotation(sourceId, value) {
    if (typeof value !== "string" || !sourceId) return void 0;
    const parts = value.split(":");
    const fileGuid = parts[0].replace(/\./g, ":");
    const fileVersion = parts[1] ? "[" + parts[1].replace(/\./g, ":") + "]" : "";
    const filePath = parts[2];
    const line = Number(parts[3]);
    const column = Number(parts[4]);
    const pos = Number(parts[5]);
    const len = Number(parts[6]);
    const annotationType = parts[7];
    switch (annotationType) {
      case "e":
        return {
          type: "element",
          sourceId,
          fileGuid,
          filePath,
          fileVersion,
          line,
          column,
          pos,
          len,
          name: parts[8],
          childTypes: parts[9] ? parts[9] === "_" ? [] : parts[9].split("") : void 0,
          isComponentDefinition: parts[10] === "1" ? true : void 0,
          assetKey: parts[11] ? parts[11] : void 0,
          makeLibraryId: parts[12] ? parts[12] : void 0,
          libraryId: parts[13] ? parts[13] : void 0,
          componentId: parts[14] ? parts[14] : void 0,
          isLibraryInstance: parts[15] === "1" ? true : void 0
        };
      case "t":
        return {
          type: "text",
          sourceId,
          fileGuid,
          filePath,
          fileVersion,
          line,
          column,
          pos,
          len
        };
      case "x":
        return {
          type: "expression",
          sourceId,
          fileGuid,
          filePath,
          fileVersion,
          line,
          column,
          pos,
          len
        };
      default:
        return void 0;
    }
  }
  function collectSourceAnnotations(props) {
    const annotations = [];
    if (!props) return annotations;
    for (const [attrName, attrValue] of Object.entries(props)) {
      if (!isFigmaAttribute(attrName) || typeof attrValue !== "string") continue;
      const segments = attrName.split("-");
      if (segments.length === 3) {
        const sourceId = segments[2];
        const annotation = parseSourceAnnotation(sourceId, attrValue);
        if (annotation) {
          annotations.push(annotation);
        }
      }
    }
    return annotations;
  }
  function getSourceAnnotations(element) {
    const fiber = getReactFiber(element);
    if (fiber) {
      const props = getFiberProps(fiber);
      if (props) {
        const annotations = collectSourceAnnotations(props);
        if (annotations.length > 0) return annotations;
      }
    }
    if (element?.attributes) {
      const annotations = [];
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        if (attr?.name.startsWith(DATA_FG_PREFIX)) {
          const sourceId = attr.name.split("-")[2];
          const annotation = parseSourceAnnotation(sourceId, attr.value);
          if (annotation) {
            annotations.push(annotation);
          }
        }
      }
      if (annotations.length > 0) return annotations;
    }
    return void 0;
  }
  function getInspectorSelectedId(element) {
    return element?.getAttribute("data-fginspector-selected") ?? void 0;
  }

  // src/lib/typography/probe.ts
  function fontStretchToKeyword(percentValue) {
    if (!percentValue.endsWith("%")) return percentValue.toLowerCase();
    const numeric = parseFloat(percentValue);
    if (isNaN(numeric)) return "normal";
    if (numeric <= 50) return "ultra-condensed";
    if (numeric <= 62.5) return "extra-condensed";
    if (numeric <= 75) return "condensed";
    if (numeric <= 87.5) return "semi-condensed";
    if (numeric <= 100) return "normal";
    if (numeric <= 112.5) return "semi-expanded";
    if (numeric <= 125) return "expanded";
    if (numeric <= 150) return "extra-expanded";
    return "ultra-expanded";
  }
  function parseFontFamily(fontFamilyString) {
    const families = [];
    const pattern = /(?:"([^"]+)"|'([^']+)'|([^,\s][^,]*))/g;
    let match;
    while ((match = pattern.exec(fontFamilyString)) !== null) {
      const familyName = (match[1] ?? match[2] ?? match[3])?.trim();
      if (familyName) {
        families.push(familyName);
      }
    }
    return families;
  }
  var TypefaceProbe = class {
    constructor() {
      this.families = /* @__PURE__ */ new Map();
      this.processedUsages = /* @__PURE__ */ new Set();
      this.unavailable = /* @__PURE__ */ new Set();
      this._canvas = null;
      this._ctx = null;
    }
    get ctx() {
      if (!this._ctx) {
        this._canvas = document.createElement("canvas");
        this._ctx = this._canvas.getContext("2d");
      }
      return this._ctx;
    }
    checkFontAvailable(familyName, fontStretch, fontStyle, fontWeight) {
      if (!this.ctx) return false;
      const testString = "mmmmmmmmmmlli";
      const testSize = "72px";
      const stretchKeyword = fontStretchToKeyword(fontStretch);
      const fallbackFamilies = ["monospace", "sans-serif", "serif"];
      for (const fallback of fallbackFamilies) {
        this.ctx.font = `${stretchKeyword} ${fontStyle} ${fontWeight} ${testSize} ${fallback}`;
        const fallbackWidth = this.ctx.measureText(testString).width;
        this.ctx.font = `${stretchKeyword} ${fontStyle} ${fontWeight} ${testSize} "${familyName}", ${fallback}`;
        const candidateWidth = this.ctx.measureText(testString).width;
        if (fallbackWidth !== candidateWidth) return true;
      }
      return false;
    }
    addFontFamily(fontFamilyStr, fontStretch, fontStyle, fontWeight, fontSize) {
      const families = parseFontFamily(fontFamilyStr);
      for (const family of families) {
        const normalizedName = family.toLowerCase();
        const unavailableKey = `${normalizedName}|${fontStretch}|${fontStyle}|${fontWeight}`;
        if (this.unavailable.has(unavailableKey)) continue;
        if (this.families.has(normalizedName)) {
          this.addUsage(normalizedName, fontStretch, fontStyle, fontWeight, fontSize);
          return;
        }
        if (!this.checkFontAvailable(family, fontStretch, fontStyle, fontWeight)) {
          this.unavailable.add(unavailableKey);
          continue;
        }
        this.families.set(normalizedName, {
          familyName: family,
          faces: [],
          usages: []
        });
        this.addUsage(normalizedName, fontStretch, fontStyle, fontWeight, fontSize);
        return;
      }
    }
    addUsage(normalizedFamily, fontStretch, fontStyle, fontWeight, fontSize) {
      const usageKey = `${normalizedFamily}|${fontStretch}|${fontStyle}|${fontWeight}|${fontSize}`;
      if (this.processedUsages.has(usageKey)) return;
      this.processedUsages.add(usageKey);
      const familyEntry = this.families.get(normalizedFamily);
      if (familyEntry) {
        familyEntry.usages.push({
          fontWeight,
          fontStyle,
          fontStretch,
          fontSize
        });
      }
    }
    getFonts() {
      this.collectWebFontFaces();
      return Object.fromEntries(this.families);
    }
    collectWebFontFaces() {
    }
  };
  function resolveFonts(element, computedStyle, fontCollector) {
    const fontWeight = computedStyle.fontWeight ?? "400";
    const fontStyle = computedStyle.fontStyle === "italic" ? "italic" : "normal";
    const fontStretch = computedStyle.fontStretch ?? "100%";
    const fontSize = computedStyle.fontSize ?? "16px";
    const fontFamily = computedStyle.fontFamily ?? "Times";
    fontCollector.addFontFamily(fontFamily, fontStretch, fontStyle, fontWeight, fontSize);
  }

  // src/lib/media/svg.ts
  var SVG_STYLE_DEFAULTS = {
    alignmentBaseline: "baseline",
    clip: "auto",
    clipPath: "none",
    clipRule: "nonzero",
    color: "rgb(0, 0, 0)",
    colorInterpolation: "sRGB",
    colorRendering: "auto",
    cursor: "auto",
    direction: "ltr",
    display: "inline",
    dominantBaseline: "auto",
    fill: "rgb(0, 0, 0)",
    fillOpacity: "1",
    fillRule: "nonzero",
    filter: "none",
    floodColor: "rgb(0, 0, 0)",
    floodOpacity: "1",
    imageRendering: "auto",
    letterSpacing: "normal",
    lightingColor: "rgb(255, 255, 255)",
    lineHeight: "normal",
    markerEnd: "none",
    markerMid: "none",
    markerStart: "none",
    mask: "none",
    opacity: "1",
    overflow: "visible",
    paintOrder: "normal",
    shapeRendering: "auto",
    stopColor: "rgb(0, 0, 0)",
    stopOpacity: "1",
    stroke: "none",
    strokeDasharray: "none",
    strokeDashoffset: "0px",
    strokeLinecap: "butt",
    strokeLinejoin: "miter",
    strokeMiterlimit: "4",
    strokeOpacity: "1",
    strokeWidth: "1px",
    textAnchor: "start",
    textDecoration: "none solid rgb(0, 0, 0)",
    textRendering: "auto",
    unicodeBidi: "normal",
    vectorEffect: "none",
    visibility: "visible",
    whiteSpace: "normal",
    writingMode: "horizontal-tb"
  };
  function camelToKebabMap(keys) {
    return Object.fromEntries(
      keys.map((key) => [
        key,
        key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()
      ])
    );
  }
  var kebabNames = camelToKebabMap(Object.keys(SVG_STYLE_DEFAULTS));
  function bakeSvgStyles(svgElement) {
    const clone = svgElement.cloneNode(true);
    copySvgComputedStyles(svgElement, clone);
    try {
      inlineExternalSvgReferences(svgElement, clone);
    } catch (_err) {
    }
    const { width, height } = window.getComputedStyle(svgElement);
    if (width.endsWith("px") && height.endsWith("px")) {
      clone.setAttribute("width", width);
      clone.setAttribute("height", height);
    }
    return clone.outerHTML;
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  var SVG_URL_REF_ATTRS = ["fill", "stroke", "clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end"];
  function getUseHref(use) {
    return use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? use.getAttributeNS("http://www.w3.org/1999/xlink", "href");
  }
  function findSvgDefinition(sourceSvg, id) {
    const root = sourceSvg.getRootNode();
    return (root.getElementById ? root.getElementById(id) : null) ?? document.getElementById(id);
  }
  /**
   * Makes a baked SVG self-contained: <use href="#id"> pointing to a sprite elsewhere in
   * the page is replaced by the referenced shape, and url(#id) gradients / clip paths /
   * masks defined outside this <svg> are copied into its <defs>.
   */
  function inlineExternalSvgReferences(sourceSvg, clone) {
    const localIds = new Set(Array.from(clone.querySelectorAll("[id]"), (el) => el.id));
    let defs = null;
    const copied = /* @__PURE__ */ new Set();
    function ensureDefs() {
      if (!defs) {
        defs = document.createElementNS(SVG_NS, "defs");
        clone.insertBefore(defs, clone.firstChild);
      }
      return defs;
    }
    function copyDefinition(id, depth) {
      if (!id || localIds.has(id) || copied.has(id) || depth > 5) return;
      const definition = findSvgDefinition(sourceSvg, id);
      if (!definition || !(definition instanceof SVGElement)) return;
      copied.add(id);
      const copy = definition.cloneNode(true);
      ensureDefs().appendChild(copy);
      collectUrlRefs(copy).forEach((ref) => copyDefinition(ref, depth + 1));
    }
    function collectUrlRefs(root) {
      const refs = [];
      const nodes = [root, ...root.querySelectorAll("*")];
      for (const node of nodes) {
        for (const attr of SVG_URL_REF_ATTRS) {
          const value = node.getAttribute(attr);
          const match = value && value.match(/url\(["']?#([^"')]+)["']?\)/);
          if (match) refs.push(match[1]);
        }
        const style = node.getAttribute("style");
        if (style) {
          for (const m of style.matchAll(/url\(["']?#([^"')]+)["']?\)/g)) refs.push(m[1]);
        }
        if (node.localName === "use") {
          const href = getUseHref(node);
          if (href && href.startsWith("#")) refs.push(href.slice(1));
        }
      }
      return refs;
    }
    for (const use of Array.from(clone.querySelectorAll("use"))) {
      const href = getUseHref(use);
      if (!href || !href.startsWith("#")) continue;
      const id = href.slice(1);
      if (localIds.has(id)) continue;
      const target = findSvgDefinition(sourceSvg, id);
      if (!target || !(target instanceof SVGElement)) continue;
      const replacement = document.createElementNS(SVG_NS, target.localName === "symbol" || target.localName === "svg" ? "svg" : "g");
      for (const attr of Array.from(use.attributes)) {
        if (attr.name === "href" || attr.name === "xlink:href") continue;
        replacement.setAttribute(attr.name, attr.value);
      }
      if (replacement.localName === "svg") {
        for (const attr of ["viewBox", "preserveAspectRatio"]) {
          const value = target.getAttribute(attr);
          if (value && !replacement.hasAttribute(attr)) replacement.setAttribute(attr, value);
        }
        if (!replacement.hasAttribute("width")) replacement.setAttribute("width", "100%");
        if (!replacement.hasAttribute("height")) replacement.setAttribute("height", "100%");
        for (const child of target.childNodes) replacement.appendChild(child.cloneNode(true));
      } else {
        const x = parseFloat(use.getAttribute("x") || "0");
        const y = parseFloat(use.getAttribute("y") || "0");
        replacement.removeAttribute("x");
        replacement.removeAttribute("y");
        if (x || y) {
          const existing = replacement.getAttribute("transform") || "";
          replacement.setAttribute("transform", `${existing} translate(${x} ${y})`.trim());
        }
        replacement.appendChild(target.cloneNode(true));
      }
      use.replaceWith(replacement);
    }
    for (const ref of collectUrlRefs(clone)) copyDefinition(ref, 0);
  }
  function copySvgComputedStyles(source, target) {
    if (!(source instanceof Element) || !(target instanceof Element)) return;
    const computedStyle = window.getComputedStyle(source);
    for (const [property, defaultValue] of Object.entries(SVG_STYLE_DEFAULTS)) {
      const value = computedStyle.getPropertyValue(property);
      if (value && value.toLowerCase() !== defaultValue.toLowerCase()) {
        target.setAttribute(kebabNames[property], value);
      }
    }
    for (let i = 0; i < source.childNodes.length; i++) {
      copySvgComputedStyles(source.childNodes[i], target.childNodes[i]);
    }
  }

  // src/lib/transform/matrix.ts
  function hasRotation(matrix) {
    return Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6;
  }
  function extractRotationMatrix(matrix) {
    if (matrix.is2D) {
      return new DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, 0, 0]);
    }
    const result = DOMMatrix.fromMatrix(matrix);
    result.m41 = 0;
    result.m42 = 0;
    result.m43 = 0;
    return result;
  }
  function parseTransformOrigin(value) {
    const [tx, ty, tz] = value?.split(" ") ?? ["0px", "0px", "0px"];
    return new DOMPoint().matrixTransform(
      new DOMMatrix(`translate3d(${tx}, ${ty ?? "0px"}, ${tz ?? "0px"})`)
    );
  }
  function transformQuad(quad, matrix) {
    return new DOMQuad(
      quad.p1.matrixTransform(matrix),
      quad.p2.matrixTransform(matrix),
      quad.p3.matrixTransform(matrix),
      quad.p4.matrixTransform(matrix)
    );
  }
  function getRectCenter(rect) {
    return new DOMPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  }
  function getElementDimensions(element) {
    let width = 0;
    let height = 0;
    if (element instanceof HTMLElement) {
      width = element.offsetWidth;
      height = element.offsetHeight;
    } else if (element instanceof SVGSVGElement) {
      const computed = getComputedStyle(element);
      width = parseFloat(computed.width) || element.width.baseVal.value;
      height = parseFloat(computed.height) || element.height.baseVal.value;
    } else if (element instanceof SVGGraphicsElement) {
      const bbox = element.getBBox();
      width = bbox.width;
      height = bbox.height;
    } else if (element instanceof MathMLElement) {
      const clientRect = element.getBoundingClientRect();
      width = clientRect.width;
      height = clientRect.height;
    } else if (element instanceof Text) {
      const range = document.createRange();
      range.selectNodeContents(element);
      const clientRect = range.getBoundingClientRect();
      width = clientRect.width;
      height = clientRect.height;
    }
    return { width, height };
  }
  function parseTranslate(value) {
    if (!value) return new DOMMatrix();
    const parts = value.trim().split(/\s+/);
    if (parts.length === 0) return new DOMMatrix();
    const x = parts[0];
    const y = parts[1] ?? "0px";
    const z = parts[2] ?? "0px";
    return new DOMMatrix(`translate3d(${x}, ${y}, ${z})`);
  }
  function parseScale(value) {
    if (!value) return new DOMMatrix();
    const parts = value.trim().split(/\s+/);
    if (parts.length === 0) return new DOMMatrix();
    if (parts.length > 3) throw new Error(`Invalid scale value: ${value}`);
    const x = parts[0];
    const y = parts[1] ?? parts[0];
    const z = parts[2] ?? 1;
    return new DOMMatrix(`scale3d(${x}, ${y}, ${z})`);
  }
  function parseRotate(value) {
    if (!value) return new DOMMatrix();
    const parts = value.trim().split(/\s+/);
    if (parts.length === 0) return new DOMMatrix();
    if (parts.length === 1) {
      return new DOMMatrix(`rotate(${parts[0]})`);
    }
    if (parts.length === 2) {
      switch (parts[0]) {
        case "x":
          return new DOMMatrix(`rotateX(${parts[1]})`);
        case "y":
          return new DOMMatrix(`rotateY(${parts[1]})`);
        case "z":
          return new DOMMatrix(`rotateZ(${parts[1]})`);
        default:
          return new DOMMatrix();
      }
    }
    if (parts.length === 4) {
      return new DOMMatrix(
        `rotate3d(${parts[0]}, ${parts[1]}, ${parts[2]}, ${parts[3]})`
      );
    }
    return new DOMMatrix();
  }
  function resolveTransform(computedStyle) {
    if (!computedStyle.rotate && !computedStyle.scale && !computedStyle.transform && !computedStyle.translate) {
      return null;
    }
    try {
      const [ox, oy, oz] = computedStyle.transformOrigin?.split(" ") ?? ["0px", "0px", "0px"];
      const originMatrix = new DOMMatrix(
        `translate3d(${ox}, ${oy ?? "0px"}, ${oz ?? "0px"})`
      );
      return originMatrix.multiply(parseTranslate(computedStyle.translate)).multiply(parseRotate(computedStyle.rotate)).multiply(parseScale(computedStyle.scale)).multiply(new DOMMatrix(computedStyle.transform ?? "none")).multiply(originMatrix.inverse());
    } catch (_error) {
      return null;
    }
  }
  function multiplyMatrices(a, b) {
    if (!a && !b) return void 0;
    if (a) return b ? a.multiply(b) : a;
    return b ?? void 0;
  }
  function getElementRect(element, computedStyle, combinedTransform) {
    const boundingRect = element instanceof Element ? element.getBoundingClientRect() : (() => {
      const r = document.createRange();
      r.selectNode(element);
      const rect = r.getBoundingClientRect();
      r.detach();
      return rect;
    })();
    let { x, y, width, height } = boundingRect;
    const dimensions = getElementDimensions(element);
    let cssWidth = dimensions.width;
    let cssHeight = dimensions.height;
    if (element instanceof HTMLElement) {
      const tag = element.tagName;
      if (tag === "HTML" || tag === "BODY") {
        const explicitWidth = element.style.getPropertyValue("max-width");
        const explicitPx = explicitWidth ? parseInt(explicitWidth, 10) : 0;
        if (explicitPx > 0) {
          width = explicitPx;
          cssWidth = explicitPx;
        } else {
          const fullWidth = Math.max(element.scrollWidth, width);
          width = fullWidth;
          cssWidth = fullWidth;
        }
        const fullHeight = Math.max(element.scrollHeight, height);
        height = fullHeight;
        cssHeight = fullHeight;
      }
    }
    if (!combinedTransform || !hasRotation(combinedTransform)) {
      return { x, y, width, height, cssWidth, cssHeight };
    }
    try {
      const quad = computeRotatedQuad(element, computedStyle, combinedTransform);
      return { x, y, width, height, cssWidth, cssHeight, quad };
    } catch (_error) {
      return { x, y, width, height, cssWidth, cssHeight };
    }
  }
  function computeRotatedQuad(element, computedStyle, combinedTransform) {
    const boundingRect = element instanceof Element ? element.getBoundingClientRect() : (() => {
      const r = document.createRange();
      r.selectNode(element);
      const rect = r.getBoundingClientRect();
      r.detach();
      return rect;
    })();
    const dimensions = getElementDimensions(element);
    const elementWidth = dimensions.width;
    const elementHeight = dimensions.height;
    const origin = parseTransformOrigin(computedStyle.transformOrigin);
    const localQuad = DOMQuad.fromQuad({
      p1: { x: -origin.x, y: -origin.y },
      p2: { x: elementWidth - origin.x, y: -origin.y },
      p3: { x: elementWidth - origin.x, y: elementHeight - origin.y },
      p4: { x: -origin.x, y: elementHeight - origin.y }
    });
    const rectCenter = getRectCenter(boundingRect);
    const originOffset = new DOMPoint(
      origin.x - elementWidth / 2,
      origin.y - elementHeight / 2
    );
    const rotationOnly = extractRotationMatrix(combinedTransform);
    const transformedOffset = originOffset.matrixTransform(rotationOnly);
    const rotatedQuad = transformQuad(localQuad, rotationOnly);
    const translationMatrix = new DOMMatrix().translate(
      rectCenter.x + transformedOffset.x,
      rectCenter.y + transformedOffset.y
    );
    const finalQuad = transformQuad(rotatedQuad, translationMatrix);
    return {
      p1: { x: finalQuad.p1.x, y: finalQuad.p1.y },
      p2: { x: finalQuad.p2.x, y: finalQuad.p2.y },
      p3: { x: finalQuad.p3.x, y: finalQuad.p3.y },
      p4: { x: finalQuad.p4.x, y: finalQuad.p4.y }
    };
  }

  // src/lib/react/tree.ts
  var MAX_PROP_LENGTH = 100;
  var FIBER_TAGS = Object.freeze({
    FunctionComponent: 0,
    ClassComponent: 1,
    HostRoot: 3,
    HostPortal: 4,
    HostComponent: 5,
    HostText: 6,
    Fragment: 7,
    Mode: 8,
    ContextConsumer: 9,
    ContextProvider: 10,
    ForwardRef: 11,
    Profiler: 12,
    SuspenseComponent: 13,
    MemoComponent: 14,
    SimpleMemoComponent: 15,
    LazyComponent: 16,
    IncompleteClassComponent: 17,
    DehydratedFragment: 18,
    SuspenseListComponent: 19,
    ScopeComponent: 21,
    OffscreenComponent: 22,
    LegacyHiddenComponent: 23,
    CacheComponent: 24,
    TracingMarkerComponent: 25,
    HostHoistable: 26,
    HostSingleton: 27,
    IncompleteFunctionComponent: 28,
    Throw: 29,
    ViewTransitionComponent: 30,
    ActivityComponent: 31
  });
  var propRefMap = /* @__PURE__ */ new WeakMap();
  var propRefCounter = 0;
  var COMPONENT_FIBER_TAGS = /* @__PURE__ */ new Set([0, 1, 11, 14, 15]);
  function extractComponentTree(element, getNodeId2) {
    propRefCounter = 0;
    const rootFiber = findRootFiber(element);
    return rootFiber ? captureFiberNode(rootFiber, getNodeId2) : null;
  }
  function findParentComponent(element) {
    const fiber = getReactFiber(element);
    if (fiber == null) return void 0;
    if (fiber._debugOwner) {
      let current = fiber;
      while (current._debugOwner && current._debugOwner.memoizedProps?._fgT != null) {
        current = current._debugOwner;
      }
      return current._debugOwner ? getFiberDisplayName(current._debugOwner) : void 0;
    }
    return findWrappingComponent(fiber) ?? void 0;
  }
  function findRootFiber(element) {
    const fiber = getReactFiber(element);
    if (fiber) return fiber;
    if (element instanceof Element) {
      for (const child of element.children) {
        const childFiber = getReactFiber(child);
        if (childFiber) return childFiber;
      }
      for (const child of element.children) {
        const found = findRootFiber(child);
        if (found) return found;
      }
    }
    return void 0;
  }
  function captureFiberNode(fiber, getNodeId2) {
    const fiberTag = fiber.tag ?? null;
    const name = getFiberDisplayName(fiber);
    let h2dId;
    if (fiber.stateNode instanceof Node) {
      h2dId = getNodeId2(fiber.stateNode);
    }
    const props = fiber.memoizedProps ? serializeProps(fiber.memoizedProps) : void 0;
    const children = [];
    let child = fiber.child;
    while (child) {
      const serialized = captureFiberNode(child, getNodeId2);
      if (serialized) {
        children.push(serialized);
      }
      child = child.sibling;
    }
    return { h2dId, name, fiberTag, props, children };
  }
  function serializeProps(props) {
    const result = {};
    for (const [key, value] of Object.entries(props)) {
      result[key] = formatPropValue(value);
    }
    return result;
  }
  function formatPropValue(value) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null || value === void 0) {
      if (typeof value === "string" && value.length > MAX_PROP_LENGTH) {
        return {
          truncated: true,
          value: value.slice(0, MAX_PROP_LENGTH),
          originalLength: value.length
        };
      }
      return value;
    }
    if (typeof value === "object" || typeof value === "function") {
      const target = value;
      let ref = propRefMap.get(target);
      if (!ref) {
        ref = `prop-ref-${++propRefCounter}`;
        propRefMap.set(target, ref);
      }
      return { ref };
    }
    return void 0;
  }
  function getFiberDisplayName(fiber) {
    if (typeof fiber.type === "string") {
      return fiber.type;
    }
    if (typeof fiber.type === "function") {
      const fn = fiber.type;
      return fn.displayName ?? fn.name;
    }
    if (typeof fiber.type === "object" && fiber.type !== null) {
      const wrappedType = fiber.type;
      return wrappedType.displayName ?? wrappedType.name;
    }
    return void 0;
  }
  function findWrappingComponent(fiber) {
    let parent = fiber.return;
    let previous = fiber;
    let candidate = null;
    while (parent) {
      if (parent.tag === FIBER_TAGS.HostComponent || parent.child !== previous || previous.sibling != null) {
        return candidate;
      }
      if (COMPONENT_FIBER_TAGS.has(parent.tag ?? -1)) {
        const name = getFiberDisplayName(parent);
        if (name && /^.{5,}$/.test(name) && !/^Primitive\./i.test(name) && !/^Styled\./i.test(name) && !/Provider$/i.test(name) && name !== "__next_metadata_boundary__" && !/^[a-zA-Z]+\(.*\)$/.test(name)) {
          candidate = name;
        }
      }
      previous = parent;
      parent = parent.return;
    }
    return candidate;
  }

  // src/lib/core/layout.ts
  function inferLayoutSizing(element, styles, parentElement) {
    if (!parentElement) {
      return { horizontal: "HUG", vertical: "HUG" };
    }
    const parentComputed = window.getComputedStyle(parentElement);
    const parentDisplay = parentComputed.display;
    const isFlexChild = parentDisplay === "flex" || parentDisplay === "inline-flex";
    const isGridChild = parentDisplay === "grid" || parentDisplay === "inline-grid";
    if (!isFlexChild && !isGridChild) {
      return inferBlockLayoutSizing(element, styles, parentElement);
    }
    const computed = window.getComputedStyle(element);
    const styleMap = "computedStyleMap" in element ? element.computedStyleMap() : null;
    const parentDirection = parentComputed.flexDirection || "row";
    const isRow = parentDirection === "row" || parentDirection === "row-reverse";
    const flexGrow = parseFloat(styles.flexGrow || computed.flexGrow || "0");
    const alignSelf = styles.alignSelf || computed.alignSelf || "auto";
    const parentAlignItems = parentComputed.alignItems || "normal";
    const effectiveAlign = alignSelf !== "auto" ? alignSelf : parentAlignItems;
    const isStretch = effectiveAlign === "stretch" || effectiveAlign === "normal";
    const widthRaw = styleMap?.get("width")?.toString() || "";
    const heightRaw = styleMap?.get("height")?.toString() || "";
    const parentRect = parentElement.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const maxWidth = computed.maxWidth;
    const maxHeight = computed.maxHeight;
    const marginLeftRaw = styleMap?.get("margin-left")?.toString() || computed.marginLeft;
    const marginRightRaw = styleMap?.get("margin-right")?.toString() || computed.marginRight;
    const marginTopRaw = styleMap?.get("margin-top")?.toString() || computed.marginTop;
    const marginBottomRaw = styleMap?.get("margin-bottom")?.toString() || computed.marginBottom;
    let mainSizing;
    if (flexGrow > 0) {
      mainSizing = "FILL";
    } else if (isRow && widthRaw.endsWith("%")) {
      mainSizing = "FILL";
    } else if (!isRow && heightRaw.endsWith("%")) {
      mainSizing = "FILL";
    } else if (isRow && isAdaptiveWrapper(elementRect.width, parentRect.width, maxWidth, marginLeftRaw, marginRightRaw)) {
      mainSizing = "FILL";
    } else if (!isRow && isAdaptiveWrapper(elementRect.height, parentRect.height, maxHeight, marginTopRaw, marginBottomRaw)) {
      mainSizing = "FILL";
    } else if (isRow && widthRaw === "auto") {
      mainSizing = "HUG";
    } else if (!isRow && heightRaw === "auto") {
      mainSizing = "HUG";
    } else if (isRow && widthRaw && widthRaw !== "auto") {
      mainSizing = "FIXED";
    } else if (!isRow && heightRaw && heightRaw !== "auto") {
      mainSizing = "FIXED";
    } else {
      mainSizing = "HUG";
    }
    let crossSizing;
    if (isStretch) {
      const crossRaw = isRow ? heightRaw : widthRaw;
      const crossElementSize = isRow ? elementRect.height : elementRect.width;
      const crossParentSize = isRow ? parentRect.height : parentRect.width;
      const crossMaxSize = isRow ? maxHeight : maxWidth;
      const crossMarginStart = isRow ? marginTopRaw : marginLeftRaw;
      const crossMarginEnd = isRow ? marginBottomRaw : marginRightRaw;
      if (!crossRaw || crossRaw === "auto" || crossRaw.endsWith("%")) {
        crossSizing = "FILL";
      } else if (isAdaptiveWrapper(crossElementSize, crossParentSize, crossMaxSize, crossMarginStart, crossMarginEnd)) {
        crossSizing = "FILL";
      } else {
        crossSizing = "FIXED";
      }
    } else {
      const crossRaw = isRow ? heightRaw : widthRaw;
      const crossMaxSize = isRow ? maxHeight : maxWidth;
      const crossMarginStart = isRow ? marginTopRaw : marginLeftRaw;
      const crossMarginEnd = isRow ? marginBottomRaw : marginRightRaw;
      const crossElementSize = isRow ? elementRect.height : elementRect.width;
      const crossParentSize = isRow ? parentRect.height : parentRect.width;
      if (crossRaw && crossRaw.endsWith("%")) {
        crossSizing = "FILL";
      } else if (isAdaptiveWrapper(crossElementSize, crossParentSize, crossMaxSize, crossMarginStart, crossMarginEnd)) {
        crossSizing = "FILL";
      } else if (crossRaw && crossRaw !== "auto") {
        crossSizing = "FIXED";
      } else {
        crossSizing = "HUG";
      }
    }
    if (isRow) {
      return { horizontal: mainSizing, vertical: crossSizing };
    } else {
      return { horizontal: crossSizing, vertical: mainSizing };
    }
  }
  function isAdaptiveWrapper(elementSize, parentSize, maxSize, marginStart, marginEnd) {
    if (parentSize <= 0) return false;
    const ratio = elementSize / parentSize;
    const isCentered = marginStart === "auto" || marginEnd === "auto";
    const hasMaxConstraint = maxSize && maxSize !== "none" && maxSize !== "0px";
    if (isCentered) return true;
    if (hasMaxConstraint && ratio >= 0.9) return true;
    if (ratio >= 0.95 && parentSize >= 200) return true;
    return false;
  }
  function inferBlockLayoutSizing(element, styles, parentElement) {
    const computed = window.getComputedStyle(element);
    const styleMap = "computedStyleMap" in element ? element.computedStyleMap() : null;
    const widthRaw = styleMap?.get("width")?.toString() || "";
    const marginLeftRaw = styleMap?.get("margin-left")?.toString() || computed.marginLeft;
    const marginRightRaw = styleMap?.get("margin-right")?.toString() || computed.marginRight;
    const maxWidth = computed.maxWidth;
    const display = computed.display;
    const parentRect = parentElement.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    let horizontal;
    if (display === "block" || display === "list-item" || display === "table") {
      if (widthRaw === "auto" || !widthRaw) {
        horizontal = "FILL";
      } else if (widthRaw.endsWith("%")) {
        horizontal = "FILL";
      } else if (isAdaptiveWrapper(elementRect.width, parentRect.width, maxWidth, marginLeftRaw, marginRightRaw)) {
        horizontal = "FILL";
      } else {
        horizontal = "FIXED";
      }
    } else {
      horizontal = "HUG";
    }
    return { horizontal, vertical: "HUG" };
  }

  // src/lib/core/walker.ts
  var NODE_TYPES = {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3
  };
  var ALLOWED_ATTRIBUTES = /* @__PURE__ */ new Set([
    "alt",
    "checked",
    "currentSrc",
    "disabled",
    "for",
    "href",
    "id",
    "multiple",
    "placeholder",
    "poster",
    "readonly",
    "rel",
    "required",
    "role",
    "selected",
    "target",
    "title",
    "type",
    "value"
  ]);
  var INPUT_TYPES_WITH_PLACEHOLDER = /* @__PURE__ */ new Set([
    "text",
    "search",
    "tel",
    "url",
    "email",
    "password",
    "number"
  ]);
  var OFFSCREEN_MARGIN = 500;
  function isNodeVisible(element) {
    if (element instanceof HTMLScriptElement) return false;
    if (element.nodeType === Node.ELEMENT_NODE && element.getAttribute("data-h2d-ignore") === "true") {
      return false;
    }
    const computed = window.getComputedStyle(element);
    if (computed.display === "none") return false;
    if (computed.visibility === "hidden") return false;
    return true;
  }
  function shouldPruneNode(element, rect, childNodes) {
    const hasVisibleChildren = childNodes.length > 0;
    const tag = element.tagName.toUpperCase();
    if (rect.width === 0 && rect.height === 0 && !hasVisibleChildren) {
      return true;
    }
    if (rect.width === 0 && rect.height === 0 && hasVisibleChildren) {
      if (tag === "HTML" || tag === "BODY") return false;
      const hasNonZeroChild = childNodes.some((child) => {
        if (child.nodeType === NODE_TYPES.ELEMENT_NODE) {
          const el = child;
          return el.rect.width > 0 || el.rect.height > 0;
        }
        if (child.nodeType === NODE_TYPES.TEXT_NODE) {
          const text = child;
          return text.rect.width > 0 || text.rect.height > 0;
        }
        return false;
      });
      if (!hasNonZeroChild) return true;
    }
    const docW = Math.max(
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
      window.innerWidth
    );
    const docH = Math.max(
      document.documentElement.scrollHeight,
      document.documentElement.clientHeight,
      window.innerHeight
    );
    if (rect.width > 0 && rect.height > 0 && (rect.x + rect.width < -OFFSCREEN_MARGIN || rect.x > docW + OFFSCREEN_MARGIN || rect.y + rect.height < -OFFSCREEN_MARGIN || rect.y > docH + OFFSCREEN_MARGIN)) {
      if (tag !== "HTML" && tag !== "BODY") {
        return true;
      }
    }
    return false;
  }
  function getTextRect(nodeOrNodes) {
    const range = document.createRange();
    if (Array.isArray(nodeOrNodes)) {
      const first = nodeOrNodes[0];
      const last = nodeOrNodes[nodeOrNodes.length - 1];
      range.setStart(first, 0);
      range.setEnd(last, last.length);
    } else {
      range.selectNode(nodeOrNodes);
    }
    const { x, y, width, height } = range.getBoundingClientRect();
    const isVertical = range.commonAncestorContainer instanceof HTMLElement ? window.getComputedStyle(range.commonAncestorContainer).writingMode.startsWith("vertical") : false;
    const clientRects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0
    );
    const lineCount = isVertical ? new Set(clientRects.map((rect) => Math.round(rect.left))).size : new Set(clientRects.map((rect) => Math.round(rect.top))).size;
    range.detach();
    return { x, y, width, height, lineCount };
  }
  function getElementAttributes(element) {
    const attrs = {};
    for (const { name, value } of element.attributes) {
      const lowerName = name.toLowerCase();
      if (ALLOWED_ATTRIBUTES.has(lowerName) || lowerName.startsWith("aria-") || lowerName.startsWith("data-")) {
        attrs[name] = value;
      }
    }
    if (element instanceof HTMLVideoElement && element.poster) {
      attrs.poster = element.poster;
    }
    if ((element instanceof HTMLImageElement || element instanceof HTMLVideoElement) && element.currentSrc) {
      attrs.currentSrc = element.currentSrc;
    }
    if (element instanceof HTMLInputElement && attrs.type == null) {
      attrs.type = element.type;
    }
    return attrs;
  }
  function matrixToSimple(matrix) {
    return {
      a: matrix.a,
      b: matrix.b,
      c: matrix.c,
      d: matrix.d,
      e: matrix.e,
      f: matrix.f
    };
  }
  /**
   * Returns what is actually rendered inside an element: its shadow root when it has
   * one, and for a <slot> the light-DOM nodes assigned to it (or its fallback content).
   */
  function getRenderedChildrenParent(element) {
    if (element instanceof HTMLSlotElement) {
      const assigned = element.assignedNodes({ flatten: true });
      if (assigned.length > 0) return { childNodes: assigned };
    }
    return element.shadowRoot ?? element;
  }
  function* iterateChildNodes(parent) {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const child = parent.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) {
        const textGroup = [child];
        let nextIndex = i + 1;
        while (nextIndex < parent.childNodes.length && parent.childNodes[nextIndex].nodeType === Node.TEXT_NODE) {
          textGroup.push(parent.childNodes[nextIndex]);
          nextIndex += 1;
        }
        yield textGroup;
        i = nextIndex - 1;
      } else {
        yield child;
      }
    }
  }

  // src/lib/core/css-defaults.ts
  var BASELINE_STYLES = {
    alignContent: "normal",
    alignItems: "normal",
    alignSelf: "auto",
    aspectRatio: "auto",
    backdropFilter: "none",
    backgroundAttachment: "scroll",
    backgroundBlendMode: "normal",
    backgroundClip: "border-box",
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPositionX: "0%",
    backgroundPositionY: "0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto",
    borderBottomColor: "rgb(0, 0, 0)",
    borderBottomLeftRadius: "0px",
    borderBottomRightRadius: "0px",
    borderBottomStyle: "none",
    borderBottomWidth: "0px",
    borderCollapse: "separate",
    borderImageOutset: "0",
    borderImageRepeat: "stretch",
    borderImageSlice: "100%",
    borderImageSource: "none",
    borderImageWidth: "1",
    borderLeftColor: "rgb(0, 0, 0)",
    borderLeftStyle: "none",
    borderLeftWidth: "0px",
    borderRightColor: "rgb(0, 0, 0)",
    borderRightStyle: "none",
    borderRightWidth: "0px",
    borderSpacing: "0px",
    borderTopColor: "rgb(0, 0, 0)",
    borderTopLeftRadius: "0px",
    borderTopRightRadius: "0px",
    borderTopStyle: "none",
    borderTopWidth: "0px",
    bottom: "auto",
    boxShadow: "none",
    boxSizing: "content-box",
    clip: "auto",
    clipPath: "none",
    clipRule: "nonzero",
    color: "rgb(0, 0, 0)",
    colorScheme: "normal",
    columnCount: "auto",
    columnFill: "balance",
    columnGap: "normal",
    columnRuleColor: "rgb(0, 0, 0)",
    columnRuleStyle: "none",
    columnRuleWidth: "0px",
    columnSpan: "none",
    columnWidth: "auto",
    contain: "none",
    containerType: "normal",
    content: "normal",
    contentVisibility: "visible",
    display: "",
    filter: "none",
    flexBasis: "auto",
    flexDirection: "row",
    flexGrow: "0",
    flexShrink: "1",
    flexWrap: "nowrap",
    fontFamily: "Times",
    fontFeatureSettings: "normal",
    fontKerning: "auto",
    fontOpticalSizing: "auto",
    fontPalette: "normal",
    fontSize: "16px",
    fontSizeAdjust: "none",
    fontStretch: "100%",
    fontStyle: "normal",
    fontWeight: "400",
    gridAutoColumns: "auto",
    gridAutoFlow: "row",
    gridAutoRows: "auto",
    gridColumnEnd: "auto",
    gridColumnStart: "auto",
    gridRowEnd: "auto",
    gridRowStart: "auto",
    gridTemplateAreas: "none",
    gridTemplateColumns: "none",
    gridTemplateRows: "none",
    height: "auto",
    isolation: "auto",
    justifyItems: "normal",
    justifySelf: "auto",
    justifyContent: "normal",
    left: "auto",
    letterSpacing: "normal",
    lineBreak: "auto",
    lineHeight: "normal",
    listStyleImage: "none",
    listStylePosition: "outside",
    listStyleType: "disc",
    marginBottom: "0px",
    marginLeft: "0px",
    marginRight: "0px",
    marginTop: "0px",
    maxHeight: "none",
    maxWidth: "none",
    minHeight: "0px",
    minWidth: "0px",
    mixBlendMode: "normal",
    objectFit: "fill",
    opacity: "1",
    order: "0",
    outlineColor: "rgb(0, 0, 0)",
    outlineOffset: "0px",
    outlineStyle: "none",
    outlineWidth: "0px",
    objectPosition: "50% 50%",
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
    position: "static",
    paddingBottom: "0px",
    paddingLeft: "0px",
    paddingRight: "0px",
    paddingTop: "0px",
    right: "auto",
    rowGap: "normal",
    strokeDasharray: "none",
    strokeDashoffset: "0px",
    strokeLinecap: "butt",
    strokeLinejoin: "miter",
    strokeMiterlimit: "4",
    strokeOpacity: "1",
    strokeWidth: "1px",
    textAlign: "start",
    textDecorationColor: "rgb(0, 0, 0)",
    textDecorationLine: "none",
    textDecorationStyle: "solid",
    textDecorationThickness: "auto",
    textIndent: "0px",
    textOverflow: "clip",
    textUnderlineOffset: "auto",
    textShadow: "none",
    textTransform: "none",
    top: "auto",
    transform: "none",
    transformOrigin: "auto",
    translate: "none",
    transitionProperty: "all",
    verticalAlign: "baseline",
    visibility: "visible",
    whiteSpace: "normal",
    width: "auto",
    willChange: "auto",
    writingMode: "horizontal-tb",
    zIndex: "auto",
    rotate: "none",
    scale: "none"
  };

  // src/lib/core/styles.ts
  var BORDER_GROUPS = [
    { style: "borderTopStyle", width: "borderTopWidth", color: "borderTopColor" },
    { style: "borderRightStyle", width: "borderRightWidth", color: "borderRightColor" },
    { style: "borderBottomStyle", width: "borderBottomWidth", color: "borderBottomColor" },
    { style: "borderLeftStyle", width: "borderLeftWidth", color: "borderLeftColor" }
  ];
  function diffStyles(element, pseudo) {
    const diff = {};
    const computed = window.getComputedStyle(element, pseudo);
    const styleMap = "computedStyleMap" in element && !pseudo ? element.computedStyleMap() : null;
    for (const [property, defaultValue] of Object.entries(BASELINE_STYLES)) {
      const value = computed.getPropertyValue(property) || computed[property];
      if (value !== defaultValue) {
        diff[property] = value;
      }
    }
    for (const dimension of ["width", "height"]) {
      const mapped = styleMap?.get(dimension)?.toString();
      if (mapped && mapped === BASELINE_STYLES[dimension]) {
        delete diff[dimension];
      }
    }
    for (const group of BORDER_GROUPS) {
      if (diff[group.width] == null) {
        delete diff[group.style];
        delete diff[group.color];
      }
    }
    if (diff.outlineWidth == null) {
      delete diff.outlineStyle;
      delete diff.outlineColor;
    }
    return diff;
  }
  var FLEX_CONTAINER_PROPS = [
    "flexDirection",
    "flexWrap",
    "justifyContent",
    "alignItems",
    "alignContent",
    "columnGap",
    "rowGap"
  ];
  var FLEX_ITEM_PROPS = [
    "flexGrow",
    "flexShrink",
    "flexBasis",
    "alignSelf",
    "order"
  ];
  var GRID_CONTAINER_PROPS = [
    "gridTemplateColumns",
    "gridTemplateRows",
    "gridAutoFlow",
    "gridAutoColumns",
    "gridAutoRows",
    "gridTemplateAreas",
    "columnGap",
    "rowGap"
  ];
  function ensureFlexProps(element, styles) {
    const computed = window.getComputedStyle(element);
    for (const prop of FLEX_CONTAINER_PROPS) {
      if (!(prop in styles)) {
        styles[prop] = computed.getPropertyValue(
          prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        ) || BASELINE_STYLES[prop] || "";
      }
    }
  }
  function ensureGridProps(element, styles) {
    const computed = window.getComputedStyle(element);
    for (const prop of GRID_CONTAINER_PROPS) {
      if (!(prop in styles)) {
        styles[prop] = computed.getPropertyValue(
          prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        ) || BASELINE_STYLES[prop] || "";
      }
    }
  }
  function ensureFlexItemProps(element, styles) {
    const computed = window.getComputedStyle(element);
    for (const prop of FLEX_ITEM_PROPS) {
      if (!(prop in styles)) {
        styles[prop] = computed.getPropertyValue(
          prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        ) || BASELINE_STYLES[prop] || "";
      }
    }
  }

  // src/lib/core/prepare.ts
  function assertLayoutValid(options) {
    if (!options.assertLayoutValid) return;
    const rect = document.body.getBoundingClientRect();
    if (rect.x === 0 && rect.y === 0 && rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.right === 0 && rect.bottom === 0 && rect.left === 0) {
      throw new Error("Document does not have valid layout");
    }
  }
  function decodeImages(images) {
    for (const img of images) {
      if (img.decoding !== "sync") img.decoding = "sync";
    }
    return Promise.allSettled(
      images.filter((img) => img.src && img.src !== "").map(
        (img) => Promise.race([
          img.decode().catch((err) => {
            console.debug("Error decoding image", err, img.src);
          }),
          // An image that never finishes loading must not block the whole capture
          new Promise((r) => setTimeout(r, IMAGE_DECODE_TIMEOUT))
        ])
      )
    ).then(() => void 0);
  }
  var restoreScrollbar = null;
  function resetScrollbarState() {
    restoreScrollbar = null;
  }
  function cleanupScrollbar() {
    if (restoreScrollbar !== null) {
      restoreScrollbar();
      restoreScrollbar = null;
    }
  }
  function hideScrollbars() {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-h2d-capture", "scrollbar-hide");
    styleEl.textContent = `
    html, body {
      scrollbar-width: none !important;
    }
    html, body, * {
      scroll-behavior: auto !important;
    }
    html::-webkit-scrollbar, body::-webkit-scrollbar {
      display: none !important;
    }
  `;
    document.head.appendChild(styleEl);
    return () => {
      styleEl.remove();
    };
  }
  var MAX_SCROLL_HEIGHT = 15e3;
  var MAX_SCROLL_STEPS = 25;
  async function scrollToTriggerLazyLoad(container) {
    const isRoot = container === document.documentElement || container === document.body;
    const rawHeight = isRoot ? document.documentElement.scrollHeight : container.scrollHeight;
    const viewportHeight = isRoot ? window.innerHeight : container.clientHeight;
    if (rawHeight <= viewportHeight) return;
    const totalHeight = Math.min(rawHeight, MAX_SCROLL_HEIGHT);
    const stepSize = Math.floor(viewportHeight * 0.7);
    const steps = Math.min(Math.ceil(totalHeight / stepSize), MAX_SCROLL_STEPS);
    for (let i = 0; i <= steps; i++) {
      const scrollTo = Math.min(i * stepSize, totalHeight);
      await scrollInstantly(container, isRoot, scrollTo);
      // Let scroll listeners and IntersectionObservers (reveal effects, counters, lazy
      // loaders) see this position before moving on.
      (isRoot ? window : container).dispatchEvent(new Event("scroll"));
      await waitForFrames(2);
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  function forceLazyImages(container) {
    const images = container.querySelectorAll("img");
    for (const img of images) {
      if (img.loading === "lazy") {
        img.loading = "eager";
        img.removeAttribute("loading");
      }
      const lazySrc = img.dataset.src || img.dataset.lazySrc || img.dataset.original || img.dataset.actualsrc || img.dataset.deferred || img.getAttribute("data-lazy");
      if (lazySrc && (!img.src || img.src.includes("placeholder") || img.src.startsWith("data:") || img.naturalWidth === 0)) {
        img.src = lazySrc;
      }
      const lazySrcset = img.dataset.srcset || img.dataset.lazySrcset;
      if (lazySrcset && !img.srcset) {
        img.srcset = lazySrcset;
      }
      if (img.src && !img.complete && img.naturalWidth === 0) {
        const src = img.src;
        img.src = "";
        img.src = src;
      }
    }
    const sources = container.querySelectorAll("picture > source");
    for (const source of sources) {
      const lazySrcset = source.dataset.srcset || source.dataset.lazySrcset;
      if (lazySrcset && !source.srcset) {
        source.srcset = lazySrcset;
      }
    }
    const bgLazy = container.querySelectorAll("[data-bg], [data-background-image]");
    for (const el of bgLazy) {
      const bgUrl = el.dataset.bg || el.dataset.backgroundImage;
      if (bgUrl && !el.style.backgroundImage) {
        el.style.backgroundImage = `url("${bgUrl}")`;
      }
    }
  }
  async function prepareForCapture(container) {
    const isRoot = container === document.documentElement || container === document.body;
    // Injected first: also disables `scroll-behavior: smooth`, otherwise scrollTo()
    // animates and the snapshot is taken mid-scroll with whole sections offscreen.
    restoreScrollbar = hideScrollbars();
    installFrameGate();
    forceLazyImages(container);
    await scrollToTriggerLazyLoad(container);
    await scrollInstantly(container, isRoot, 0);
    await new Promise((r) => setTimeout(r, 100));
    await freezePage(container);
    // Scroll-linked scripts may have moved the page while settling
    await scrollInstantly(container, isRoot, 0);
  }
  function waitForFrames(count) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 100 * count);
      const tick = (n) => n <= 0 ? (clearTimeout(timer), resolve()) : realRequestAnimationFrame(() => tick(n - 1));
      tick(count);
    });
  }
  async function scrollInstantly(container, isRoot, top) {
    const target = isRoot ? window : container;
    const maxTop = isRoot ? document.documentElement.scrollHeight - window.innerHeight : container.scrollHeight - container.clientHeight;
    top = Math.max(0, Math.min(top, maxTop));
    try {
      target.scrollTo({ top, left: isRoot ? 0 : container.scrollLeft, behavior: "instant" });
    } catch (_err) {
      if (isRoot) window.scrollTo(0, top);
      else container.scrollTop = top;
    }
    // Smooth-scroll libraries (Lenis, Locomotive...) may still animate: wait until it lands
    const getTop = () => isRoot ? window.scrollY : container.scrollTop;
    const deadline = realNow() + 1500;
    while (Math.abs(getTop() - top) > 2 && realNow() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      if (Math.abs(getTop() - top) > 2) {
        if (isRoot) window.scrollTo(0, top);
        else container.scrollTop = top;
      }
    }
  }
  // src/lib/core/freeze.ts
  // "Base design" capture: animations are not played to the end, they are switched off.
  // CSS animations/transitions are disabled, script-driven animation is stopped (the
  // page's animation frames are held), the inline styles animation libraries write
  // (transform, opacity...) are removed and sliders go back to their first position.
  // Scroll-reveal content that would stay hidden is forced visible. Everything is
  // restored after the capture.
  var realNow = window.__h2dRealDateNow || (window.__h2dRealDateNow = Date.now.bind(Date));
  var realRequestAnimationFrame = window.__h2dRealRAF || (window.__h2dRealRAF = window.requestAnimationFrame.bind(window));
  var freezeState = null;
  /** Lets the capture hold the page's requestAnimationFrame callbacks (JS animation loops). */
  function installFrameGate() {
    if (window.__h2dFrameGate) return window.__h2dFrameGate;
    const gate = { holding: false, held: /* @__PURE__ */ new Map(), nextId: -1 };
    const cancel = window.cancelAnimationFrame.bind(window);
    try {
      window.requestAnimationFrame = (callback) => {
        if (gate.holding) {
          const id = gate.nextId--;
          gate.held.set(id, callback);
          return id;
        }
        return realRequestAnimationFrame(callback);
      };
      window.cancelAnimationFrame = (id) => {
        if (gate.held.has(id)) gate.held.delete(id);
        else cancel(id);
      };
    } catch (_err) {
    }
    window.__h2dFrameGate = gate;
    return gate;
  }
  function holdPageFrames() {
    const gate = window.__h2dFrameGate;
    if (gate) gate.holding = true;
  }
  function releasePageFrames() {
    const gate = window.__h2dFrameGate;
    if (!gate) return;
    gate.holding = false;
    const callbacks = Array.from(gate.held.values());
    gate.held.clear();
    for (const callback of callbacks) realRequestAnimationFrame(callback);
  }
  // Libraries that animate by writing inline styles on their targets
  var SCRIPT_ANIMATED_SELECTOR = "[data-w-id],[data-aos],[data-sal],[data-framer-appear-id],[data-framer-name],[data-motion],[data-scroll],[data-animate],[style*='will-change'],[class*='gsap'],[class*='split'],[data-split],[data-splitting],.char,.word,.letter";
  // Slider/carousel tracks: their inline transform is the current slide offset
  var SLIDER_TRACK_SELECTOR = ".swiper-wrapper,.splide__list,.slick-track,.flickity-slider,.glide__slides,.keen-slider,.embla__container,.owl-stage,.w-slide,.splide__track > ul";
  var INTERACTIVE_OVERLAYS = "[role=dialog],[aria-modal=true],dialog,[role=menu],[role=tooltip],[role=listbox],[hidden]";
  var ANIMATED_INLINE_PROPS = ["transform", "translate", "rotate", "scale", "opacity", "filter", "clip-path", "visibility"];
  var revealCandidates = /* @__PURE__ */ new WeakSet();
  var REVEAL_CLASS_PATTERN = /(^|[\s_-])(rv|reveal|fade|fadein|aos|wow|animate|animated|appear|inview|in-view|sr|motion|js-anim)([\s_-]|$)/i;
  var REVEAL_ATTRS = ["data-aos", "data-animate", "data-animation", "data-scroll", "data-sal", "data-reveal", "data-sr", "data-motion"];
  var HIDDEN_ON_PURPOSE = "[role=dialog],[aria-modal=true],dialog,[role=menu],[role=tooltip],[role=listbox],[aria-hidden=true],[hidden]";
  async function freezePage(container) {
    freezeState = { style: null, inlineBackups: [], paused: [], textBackups: [], extraStyles: [], addedNodes: [], addedClasses: [], unwraps: [] };
    // Remember what was animated before switching animations off (afterwards the
    // computed styles no longer show it)
    collectRevealCandidates();
    holdPageFrames();
    // GSAP keeps its own reference to requestAnimationFrame: put its ticker to sleep
    try {
      if (window.gsap?.ticker?.sleep) {
        window.gsap.ticker.sleep();
        freezeState.gsapSlept = true;
      }
    } catch (_err) {
    }
    const style = document.createElement("style");
    style.setAttribute("data-h2d-capture", "freeze");
    style.textContent = `*, *::before, *::after {
      animation: none !important;
      transition: none !important;
    }`;
    document.head.appendChild(style);
    freezeState.style = style;
    cancelScriptAnimations();
    triggerKnownRevealLibraries();
    stripScriptAnimationStyles();
    await new Promise((r) => setTimeout(r, 50));
    collapseScrollTracks();
    forceRevealHiddenElements();
    completeCounters();
    try {
      materializePseudoElements();
    } catch (_err) {
    }
    try {
      applyTextEffectsAsSvg(container || document.documentElement);
    } catch (_err) {
    }
    try {
      await rasterizeDecorations();
    } catch (_err) {
    }
  }
  // src/lib/core/decorations.ts
  // Figma does not reproduce some CSS decorations: ::before / ::after (dots, lines,
  // circles), tiled or repeating gradients (dot grids, dashed lines) and dashed/dotted
  // borders. During the capture they are turned into things it does understand: real
  // elements, raster images and SVG strokes. Everything is undone by unfreezePage().
  var PSEUDO_ATTR = "data-h2d-pseudo";
  var NO_PSEUDO_CLASS = { "::before": "h2d-no-before", "::after": "h2d-no-after" };
  var PSEUDO_SKIP_TAGS = /* @__PURE__ */ new Set(["IMG", "INPUT", "TEXTAREA", "SELECT", "VIDEO", "IFRAME", "CANVAS", "BR", "OBJECT", "EMBED", "AUDIO"]);
  var PSEUDO_SKIP_PROPS = /^(content|animation|transition|-webkit-locale|counter-)/;
  var MAX_RASTER_PIXELS = 4e6;
  function parsePseudoContent(content, host) {
    const parts = [];
    const pattern = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|attr\(\s*([\w-]+)\s*\)|url\(\s*["']?([^"')]+)["']?\s*\)/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1] != null || match[2] != null) parts.push({ text: (match[1] ?? match[2]).replace(/\\(.)/g, "$1") });
      else if (match[3]) parts.push({ text: host.getAttribute(match[3]) ?? "" });
      else if (match[4]) parts.push({ url: match[4] });
    }
    return parts;
  }
  function getChildRects(element) {
    return Array.from(element.children).slice(0, 30).map((child) => [child, child.getBoundingClientRect()]);
  }
  function rectsMoved(before) {
    return before.some(([child, rect]) => {
      const now = child.getBoundingClientRect();
      return Math.abs(now.x - rect.x) > 0.5 || Math.abs(now.y - rect.y) > 0.5 || Math.abs(now.width - rect.width) > 0.5 || Math.abs(now.height - rect.height) > 0.5;
    });
  }
  function materializePseudoElements() {
    const style = document.createElement("style");
    style.setAttribute("data-h2d-capture", "pseudo");
    style.textContent = `.h2d-no-before::before { content: none !important; display: none !important; }
      .h2d-no-after::after { content: none !important; display: none !important; }`;
    document.head.appendChild(style);
    freezeState.extraStyles.push(style);
    for (const host of Array.from(document.body.querySelectorAll("*"))) {
      if (PSEUDO_SKIP_TAGS.has(host.tagName) || host instanceof SVGElement || host.hasAttribute(PSEUDO_ATTR)) continue;
      if (host.closest("[data-h2d-ignore]")) continue;
      for (const pseudo of ["::before", "::after"]) {
        const computed = window.getComputedStyle(host, pseudo);
        const content = computed.content;
        if (!content || content === "none" || content === "normal" || computed.display === "none") continue;
        const parts = parsePseudoContent(content, host);
        const hostRect = host.getBoundingClientRect();
        const childRects = getChildRects(host);
        const span = document.createElement("span");
        span.setAttribute(PSEUDO_ATTR, pseudo.slice(2));
        for (let i = 0; i < computed.length; i++) {
          const prop = computed[i];
          if (PSEUDO_SKIP_PROPS.test(prop)) continue;
          span.style.setProperty(prop, computed.getPropertyValue(prop));
        }
        for (const part of parts) {
          if (part.text) span.appendChild(document.createTextNode(part.text));
          else if (part.url) {
            const img = document.createElement("img");
            img.src = part.url;
            img.style.cssText = "display:inline-block;vertical-align:middle;";
            span.appendChild(img);
          }
        }
        if (pseudo === "::before") host.insertBefore(span, host.firstChild);
        else host.appendChild(span);
        host.classList.add(NO_PSEUDO_CLASS[pseudo]);
        // Inserting an element can change :first-child / :nth-child matches or the
        // layout; in that case keep the original pseudo-element.
        const now = host.getBoundingClientRect();
        if (rectsMoved(childRects) || Math.abs(now.width - hostRect.width) > 0.5 || Math.abs(now.height - hostRect.height) > 0.5) {
          span.remove();
          host.classList.remove(NO_PSEUDO_CLASS[pseudo]);
          continue;
        }
        freezeState.addedNodes.push(span);
        freezeState.addedClasses.push([host, NO_PSEUDO_CLASS[pseudo]]);
      }
    }
  }
  function needsBackgroundRaster(computed) {
    const image = computed.backgroundImage;
    if (!image || image === "none" || !/gradient\(/.test(image)) return false;
    // url() layers can't be rendered inside an SVG image; leave those alone
    if (/url\(/.test(image)) return false;
    if (/repeating-|conic-gradient/.test(image)) return true;
    const sizes = computed.backgroundSize.split(",").map((s) => s.trim());
    const repeats = computed.backgroundRepeat.split(",").map((s) => s.trim());
    return sizes.some((size, i) => size !== "auto" && size !== "auto auto" && size !== "100% 100%" && size !== "cover" && !/^no-repeat/.test(repeats[i] ?? repeats[0]));
  }
  function getBorderDash(computed) {
    const sides = ["top", "right", "bottom", "left"].map((side) => ({
      style: computed.getPropertyValue(`border-${side}-style`),
      width: parseFloat(computed.getPropertyValue(`border-${side}-width`)) || 0,
      color: computed.getPropertyValue(`border-${side}-color`)
    }));
    if (!sides.some((s) => (s.style === "dashed" || s.style === "dotted") && s.width > 0)) return null;
    return sides;
  }
  async function svgToPngDataUrl(svgMarkup, width, height, scale) {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgMarkup);
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }
  function escapeXmlAttr(value) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }
  async function rasterizeBackground(element, computed) {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (!width || !height) return;
    const scale = Math.min(2, Math.sqrt(MAX_RASTER_PIXELS / (width * height)));
    if (scale < 0.25) return;
    const props = ["background-image", "background-size", "background-position", "background-repeat", "background-origin", "background-clip", "background-blend-mode", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"];
    const css = props.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(";");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}"><foreignObject width="${width}" height="${height}" transform="scale(${scale})"><div xmlns="http://www.w3.org/1999/xhtml" style="${escapeXmlAttr(css)};box-sizing:border-box;width:${width}px;height:${height}px;border-style:solid;border-color:transparent;margin:0"></div></foreignObject></svg>`;
    const dataUrl = await svgToPngDataUrl(svg, width * scale, height * scale, 1);
    setInlineImportant(element, "background-image", `url("${dataUrl}")`);
    setInlineImportant(element, "background-size", "100% 100%");
    setInlineImportant(element, "background-position", "0px 0px");
    setInlineImportant(element, "background-repeat", "no-repeat");
    setInlineImportant(element, "background-origin", "border-box");
    setInlineImportant(element, "background-clip", "border-box");
  }
  function dashedBorderToSvg(element, computed, sides) {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (!width || !height) return;
    const uniform = sides.every((s) => s.style === sides[0].style && s.width === sides[0].width && s.color === sides[0].color);
    const radius = parseFloat(computed.borderTopLeftRadius) || 0;
    const dashFor = (s) => s.style === "dotted" ? `0 ${s.width * 2}` : `${s.width * 3} ${s.width * 3}`;
    const capFor = (s) => s.style === "dotted" ? "round" : "butt";
    let shapes;
    if (uniform) {
      const s = sides[0];
      const r = Math.max(0, Math.min(radius - s.width / 2, (width - s.width) / 2, (height - s.width) / 2));
      shapes = `<rect x="${s.width / 2}" y="${s.width / 2}" width="${width - s.width}" height="${height - s.width}" rx="${r}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-dasharray="${dashFor(s)}" stroke-linecap="${capFor(s)}"/>`;
    } else {
      const [top, right, bottom, left] = sides;
      const line = (s, x1, y1, x2, y2) => s.width > 0 && s.style !== "none" && s.style !== "hidden" ? `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${s.color}" stroke-width="${s.width}" ${s.style === "dashed" || s.style === "dotted" ? `stroke-dasharray="${dashFor(s)}" stroke-linecap="${capFor(s)}"` : ""}/>` : "";
      shapes = line(top, 0, top.width / 2, width, top.width / 2) + line(right, width - right.width / 2, 0, width - right.width / 2, height) + line(bottom, 0, height - bottom.width / 2, width, height - bottom.width / 2) + line(left, left.width / 2, 0, left.width / 2, height);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes}</svg>`;
    const url = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
    const prepend = (prop, value) => {
      const current = computed.getPropertyValue(prop);
      return computed.backgroundImage === "none" ? value : `${value}, ${current}`;
    };
    setInlineImportant(element, "background-image", computed.backgroundImage === "none" ? url : `${url}, ${computed.backgroundImage}`);
    setInlineImportant(element, "background-size", prepend("background-size", "100% 100%"));
    setInlineImportant(element, "background-position", prepend("background-position", "0px 0px"));
    setInlineImportant(element, "background-repeat", prepend("background-repeat", "no-repeat"));
    setInlineImportant(element, "background-origin", prepend("background-origin", "border-box"));
    setInlineImportant(element, "background-clip", prepend("background-clip", "border-box"));
    for (const side of ["top", "right", "bottom", "left"]) {
      setInlineImportant(element, `border-${side}-color`, "transparent");
    }
  }
  async function rasterizeDecorations() {
    const jobs = [];
    for (const element of document.body.querySelectorAll("*")) {
      if (!(element instanceof HTMLElement) || element.closest("[data-h2d-ignore]")) continue;
      const computed = window.getComputedStyle(element);
      if (computed.display === "none" || computed.visibility === "hidden") continue;
      const sides = getBorderDash(computed);
      const rasterBg = needsBackgroundRaster(computed);
      if (rasterBg) {
        // Snapshot the values now: dashed-border handling below changes them
        const snapshot = {};
        for (let i = 0; i < computed.length; i++) snapshot[computed[i]] = computed.getPropertyValue(computed[i]);
        const frozen = { getPropertyValue: (p) => snapshot[p] ?? "" };
        jobs.push(rasterizeBackground(element, frozen).then(() => {
          if (sides) dashedBorderToSvg(element, window.getComputedStyle(element), sides);
        }).catch(() => {
        }));
      } else if (sides) {
        try {
          dashedBorderToSvg(element, computed, sides);
        } catch (_err) {
        }
      }
    }
    await Promise.all(jobs);
  }
  var COUNTER_ATTRS = ["data-count", "data-count-to", "data-countup", "data-to", "data-target", "data-end", "data-number", "data-value", "data-purecounter-end"];
  /**
   * Count-up numbers that never started (their trigger did not fire) still show their
   * start value; show the final value declared in the usual data attributes instead.
   */
  function completeCounters() {
    const selector = COUNTER_ATTRS.map((attr) => `[${attr}]`).join(",");
    for (const element of document.querySelectorAll(selector)) {
      if (element.children.length > 0) continue;
      const current = element.textContent.trim();
      if (!/^[\d.,\s]*$/.test(current)) continue;
      const attr = COUNTER_ATTRS.find((a) => element.hasAttribute(a));
      const target = parseFloat(element.getAttribute(attr));
      if (!isFinite(target)) continue;
      const currentValue = parseFloat(current.replace(/[.,\s](?=\d{3}\b)/g, "").replace(",", "."));
      if (currentValue === target) continue;
      const decimals = (element.getAttribute(attr).split(".")[1] || "").length;
      let text;
      try {
        text = new Intl.NumberFormat(document.documentElement.lang || void 0, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: Math.abs(target) >= 1e4 || /[.,]\d{3}/.test(current) || element.hasAttribute("data-sep") ? "always" : false
        }).format(target);
      } catch (_err) {
        text = String(target);
      }
      freezeState.textBackups.push({ element, text: element.textContent });
      element.textContent = text;
    }
  }
  function unfreezePage() {
    if (!freezeState) return;
    freezeState.style?.remove();
    for (const node of freezeState.addedNodes) node.remove();
    for (const [wrapper, textNode] of freezeState.unwraps) wrapper.replaceWith(textNode);
    for (const [element, className] of freezeState.addedClasses) element.classList.remove(className);
    for (const style of freezeState.extraStyles) style.remove();
    for (const { element, text } of freezeState.textBackups) element.textContent = text;
    for (const { element, prop, value, priority } of freezeState.inlineBackups.reverse()) {
      if (value) element.style.setProperty(prop, value, priority);
      else element.style.removeProperty(prop);
    }
    for (const animation of freezeState.paused) {
      try {
        animation.play();
      } catch (_err) {
      }
    }
    if (freezeState.gsapSlept) {
      try {
        window.gsap.ticker.wake();
      } catch (_err) {
      }
    }
    freezeState = null;
    releasePageFrames();
  }
  function triggerKnownRevealLibraries() {
    try {
      // AOS
      document.querySelectorAll("[data-aos]").forEach((el) => el.classList.add("aos-animate"));
      // WOW.js / animate.css
      document.querySelectorAll(".wow").forEach((el) => {
        el.classList.add("animated");
        setInlineImportant(el, "visibility", "visible");
      });
      // sal.js
      document.querySelectorAll("[data-sal]").forEach((el) => el.classList.add("sal-animate"));
    } catch (_err) {
    }
  }
  function collectRevealCandidates() {
    revealCandidates = /* @__PURE__ */ new WeakSet();
    try {
      for (const animation of document.getAnimations()) {
        const target = animation.effect?.target;
        if (target) revealCandidates.add(target);
      }
    } catch (_err) {
    }
    for (const element of document.body.querySelectorAll("*")) {
      const transitioned = window.getComputedStyle(element).transitionProperty || "";
      if (/(^|,\s*)(all|opacity|visibility)(\s*,|$)/.test(transitioned)) revealCandidates.add(element);
    }
  }
  /** Web Animations started from scripts (element.animate) are not affected by the CSS. */
  function cancelScriptAnimations() {
    if (typeof document.getAnimations !== "function") return;
    for (const animation of document.getAnimations()) {
      try {
        if (typeof CSSAnimation !== "undefined" && animation instanceof CSSAnimation) continue;
        if (typeof CSSTransition !== "undefined" && animation instanceof CSSTransition) continue;
        animation.cancel();
        freezeState.paused.push(animation);
      } catch (_err) {
      }
    }
  }
  function removeInlineProperty(element, prop) {
    const value = element.style.getPropertyValue(prop);
    if (!value) return;
    freezeState.inlineBackups.push({ element, prop, value, priority: element.style.getPropertyPriority(prop) });
    element.style.removeProperty(prop);
  }
  /** Back to the base design: drop the inline animation state written by scripts. */
  function stripScriptAnimationStyles() {
    const targets = new Set(document.querySelectorAll(SCRIPT_ANIMATED_SELECTOR));
    try {
      const gsap = window.gsap;
      if (gsap?.globalTimeline?.getChildren) {
        for (const tween of gsap.globalTimeline.getChildren(true, true, false)) {
          for (const target of tween.targets?.() || []) {
            if (target instanceof Element) targets.add(target);
          }
        }
      }
    } catch (_err) {
    }
    for (const element of targets) {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
      if (element.closest("[data-h2d-ignore]") || element.classList?.contains("pin-spacer")) continue;
      // Menus, modals and overlays are hidden on purpose by these libraries (aria-hidden
      // is not a signal here: split-text libraries put it on every letter)
      if (element.closest(INTERACTIVE_OVERLAYS) || window.getComputedStyle(element).position === "fixed") continue;
      for (const prop of ANIMATED_INLINE_PROPS) removeInlineProperty(element, prop);
    }
    for (const track of document.querySelectorAll(SLIDER_TRACK_SELECTOR)) {
      removeInlineProperty(track, "transform");
      removeInlineProperty(track, "translate");
      removeInlineProperty(track, "transition-duration");
    }
  }

  /**
   * Scroll-driven sections are tall "tracks" (e.g. 300vh) whose visible content is a
   * sticky or pinned block that animates while scrolling. Only what is first shown is
   * captured: the track is collapsed to that block, whatever its scroll length.
   */
  function collapseScrollTracks() {
    const minSlack = Math.max(300, window.innerHeight * 0.5);
    // GSAP ScrollTrigger pins
    for (const spacer of document.querySelectorAll(".pin-spacer")) {
      const pinned = spacer.firstElementChild;
      if (!pinned) continue;
      if (spacer.getBoundingClientRect().height - pinned.getBoundingClientRect().height < minSlack) continue;
      setInlineImportant(spacer, "padding-bottom", "0px");
      setInlineImportant(spacer, "height", "auto");
      setInlineImportant(spacer, "min-height", "0px");
    }
    // position: sticky inside a much taller parent
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      if (element.closest("[data-h2d-ignore]")) continue;
      if (window.getComputedStyle(element).position !== "sticky") continue;
      // Skip wrappers that are just as tall as the sticky block to reach the real track
      let inner = element;
      let track = element.parentElement;
      while (track && track !== document.body && track.children.length === 1 && track.getBoundingClientRect().height - inner.getBoundingClientRect().height < 2) {
        inner = track;
        track = track.parentElement;
      }
      if (!track || track === document.body || track === document.documentElement) continue;
      const trackRect = track.getBoundingClientRect();
      let content = 0;
      for (const child of track.children) {
        const position = window.getComputedStyle(child).position;
        if (position === "absolute" || position === "fixed") continue;
        content += child.getBoundingClientRect().height;
      }
      if (trackRect.height - content < minSlack) continue;
      const trackStyle = window.getComputedStyle(track);
      setInlineImportant(track, "height", "auto");
      setInlineImportant(track, "min-height", "0px");
      if ((parseFloat(trackStyle.paddingBottom) || 0) > minSlack) setInlineImportant(track, "padding-bottom", "0px");
      if ((parseFloat(trackStyle.paddingTop) || 0) > minSlack) setInlineImportant(track, "padding-top", "0px");
      setInlineImportant(element, "position", "relative");
      setInlineImportant(element, "top", "auto");
    }
  }
  function setInlineImportant(element, prop, value) {
    if (freezeState) {
      freezeState.inlineBackups.push({
        element,
        prop,
        value: element.style.getPropertyValue(prop),
        priority: element.style.getPropertyPriority(prop)
      });
    }
    element.style.setProperty(prop, value, "important");
  }
  function looksLikeRevealElement(element, computed) {
    if (revealCandidates.has(element)) return true;
    const className = element.getAttribute("class") || "";
    if (REVEAL_CLASS_PATTERN.test(className)) return true;
    if (REVEAL_ATTRS.some((attr) => element.hasAttribute(attr))) return true;
    const transitioned = computed.transitionProperty || "";
    return /(^|,\s*)(all|opacity)(\s*,|$)/.test(transitioned);
  }
  /**
   * Elements left invisible by a scroll-reveal effect that never fired (observer not
   * triggered, content below the scroll limit...). Menus, dialogs, tooltips and hover
   * overlays that are hidden on purpose are skipped.
   */
  function forceRevealHiddenElements() {
    for (const element of document.body.querySelectorAll("*")) {
      if (element.closest("[data-h2d-ignore]")) continue;
      const computed = window.getComputedStyle(element);
      if (computed.display === "none" || computed.position === "fixed") continue;
      if (parseFloat(computed.opacity) >= 0.05) continue;
      const parent = element.parentElement;
      if (parent && parent !== document.body && parseFloat(window.getComputedStyle(parent).opacity) < 0.05) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (!element.textContent.trim() && !element.querySelector("img,svg,video,picture,canvas") && !(element instanceof HTMLImageElement)) continue;
      if (element.closest(HIDDEN_ON_PURPOSE)) continue;
      // Absolutely positioned invisible layers are usually hover overlays
      if (computed.position === "absolute" && !REVEAL_CLASS_PATTERN.test(element.getAttribute("class") || "") && !REVEAL_ATTRS.some((a) => element.hasAttribute(a))) continue;
      if (!looksLikeRevealElement(element, computed)) continue;
      setInlineImportant(element, "opacity", "1");
      if (computed.visibility === "hidden") setInlineImportant(element, "visibility", "visible");
      if (computed.transform !== "none") setInlineImportant(element, "transform", "none");
      if (computed.translate && computed.translate !== "none") setInlineImportant(element, "translate", "none");
      if (computed.scale && computed.scale !== "none") setInlineImportant(element, "scale", "none");
      if (/blur/.test(computed.filter)) setInlineImportant(element, "filter", "none");
      if (/inset/.test(computed.clipPath)) setInlineImportant(element, "clip-path", "none");
    }
  }



  // src/lib/core/text-effects.ts
  // Gradient text (background-clip: text) and outlined text (-webkit-text-stroke) are
  // copied as SVG text with an SVG gradient fill / stroke, which Figma imports.
  var colorProbeCtx = null;
  function parseCssColor(value) {
    if (!value) return null;
    if (!colorProbeCtx) colorProbeCtx = document.createElement("canvas").getContext("2d");
    colorProbeCtx.fillStyle = "#010203";
    colorProbeCtx.fillStyle = value;
    const normalized = colorProbeCtx.fillStyle;
    if (normalized === "#010203" && !/^#010203$/i.test(value.trim()) && !/rgba?\(\s*1,\s*2,\s*3/.test(value)) return null;
    let m = normalized.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (m) return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255, a: 1 };
    m = normalized.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: m[4] != null ? +m[4] : 1 };
    return null;
  }
  function colorToCss(c) {
    return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
  }
  function splitTopLevel(value, separator = ",") {
    const parts = [];
    let depth = 0;
    let current = "";
    for (const ch of value) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === separator && depth === 0) {
        parts.push(current.trim());
        current = "";
      } else current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }
  var SIDE_ANGLES = { top: 0, right: 90, bottom: 180, left: 270 };
  function parseAngle(token, width, height) {
    const m = token.match(/^(-?[\d.]+)(deg|grad|rad|turn)$/);
    if (m) {
      const n = parseFloat(m[1]);
      return m[2] === "deg" ? n : m[2] === "grad" ? n * 0.9 : m[2] === "rad" ? n * 180 / Math.PI : n * 360;
    }
    const side = token.match(/^to\s+(.+)$/);
    if (!side) return null;
    const words = side[1].trim().split(/\s+/).sort().join(" ");
    if (SIDE_ANGLES[words] != null) return SIDE_ANGLES[words];
    // Corners depend on the box: the 50% line joins the two other corners
    const corner = Math.atan2(height, width) * 180 / Math.PI;
    const corners = { "right top": corner, "bottom right": 180 - corner, "bottom left": 180 + corner, "left top": 360 - corner };
    return corners[words] ?? null;
  }
  /** Parses the first gradient layer of a computed background-image. */
  function parseGradient(backgroundImage, width, height) {
    const layer = splitTopLevel(backgroundImage).find((l) => /gradient\(/.test(l));
    if (!layer) return null;
    const m = layer.match(/^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s);
    if (!m) return null;
    const type = m[2] === "radial" ? "radial" : "linear";
    const args = splitTopLevel(m[3]);
    let angle = 180;
    let shape = "ellipse";
    if (args.length && !parseCssColor(splitColorStop(args[0]).color)) {
      const first = args.shift();
      if (type === "linear") angle = parseAngle(first, width, height) ?? 180;
      else if (/circle/.test(first)) shape = "circle";
    }
    const rad = angle * Math.PI / 180;
    const lineLength = Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad)) || 1;
    const stops = [];
    for (const arg of args) {
      const { color, positions } = splitColorStop(arg);
      const parsed = parseCssColor(color);
      if (!parsed) continue;
      const toUnit = (p) => p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p) / (type === "linear" ? lineLength : Math.max(width, height) / 2);
      if (positions.length === 0) stops.push({ color: parsed, position: null });
      for (const p of positions) stops.push({ color: parsed, position: toUnit(p) });
    }
    if (stops.length < 2) return null;
    // CSS fills in missing positions: first 0, last 1, the rest evenly in between
    if (stops[0].position == null) stops[0].position = 0;
    if (stops[stops.length - 1].position == null) stops[stops.length - 1].position = 1;
    for (let i = 1; i < stops.length - 1; i++) {
      if (stops[i].position != null) continue;
      let j = i;
      while (stops[j].position == null) j++;
      const start = stops[i - 1].position;
      const step = (stops[j].position - start) / (j - i + 1);
      for (let k = i; k < j; k++) stops[k].position = start + step * (k - i + 1);
    }
    for (let i = 1; i < stops.length; i++) stops[i].position = Math.max(stops[i].position, stops[i - 1].position);
    stops.forEach((s) => s.position = Math.min(1, Math.max(0, s.position)));
    return { type, angle, shape, stops };
  }
  function splitColorStop(token) {
    const close = token.lastIndexOf(")");
    let color, rest;
    if (close !== -1 && /^[a-z-]+\(/i.test(token)) {
      color = token.slice(0, close + 1);
      rest = token.slice(close + 1).trim();
    } else {
      const parts = token.split(/\s+/);
      color = parts[0];
      rest = parts.slice(1).join(" ");
    }
    const positions = rest ? rest.split(/\s+/).filter((p) => /^-?[\d.]+(%|px)$/.test(p)) : [];
    return { color, positions };
  }
  var SVG_TEXT_NS = "http://www.w3.org/2000/svg";
  var MAX_EFFECT_TEXT = 600;
  var textSvgCounter = 0;
  function applyTextTransform(text, transform) {
    if (transform === "uppercase") return text.toUpperCase();
    if (transform === "lowercase") return text.toLowerCase();
    if (transform === "capitalize") return text.replace(/(^|\s)(\S)/g, (_m, s, c) => s + c.toUpperCase());
    return text;
  }
  /** Splits the rendered text of a text node into lines, using each character's box. */
  function getRenderedLines(node) {
    const lines = [];
    const range = document.createRange();
    const value = node.textContent;
    let current = null;
    for (let i = 0; i < value.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getClientRects()[0];
      // Collapsed whitespace has no box
      if (!rect || rect.width === 0 && /\s/.test(value[i])) continue;
      if (!current || Math.abs(rect.top - current.top) > rect.height / 2) {
        current = { text: "", left: rect.left, top: rect.top, height: rect.height, right: rect.right };
        lines.push(current);
      }
      current.text += /\s/.test(value[i]) ? " " : value[i];
      current.right = rect.right;
    }
    range.detach();
    for (const line of lines) line.text = line.text.replace(/\s+$/, "");
    return lines.filter((line) => line.text);
  }
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_TEXT_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value != null) el.setAttribute(key, String(value));
    }
    return el;
  }
  function buildSvgGradient(fill, id, width, height) {
    let gradient;
    if (fill.type === "radial") {
      const cx = width / 2;
      const cy = height / 2;
      const rx = fill.shape === "circle" ? Math.hypot(width, height) / 2 : width / 2 * Math.SQRT2;
      const ry = fill.shape === "circle" ? rx : height / 2 * Math.SQRT2;
      gradient = svgEl("radialGradient", {
        id,
        gradientUnits: "userSpaceOnUse",
        cx,
        cy,
        r: rx,
        gradientTransform: ry !== rx ? `translate(${cx} ${cy}) scale(1 ${ry / rx}) translate(${-cx} ${-cy})` : null
      });
    } else {
      // CSS gradient line: through the box centre, 0deg pointing up, clockwise
      const rad = fill.angle * Math.PI / 180;
      const dx = Math.sin(rad);
      const dy = -Math.cos(rad);
      const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
      gradient = svgEl("linearGradient", {
        id,
        gradientUnits: "userSpaceOnUse",
        x1: width / 2 - dx * half,
        y1: height / 2 - dy * half,
        x2: width / 2 + dx * half,
        y2: height / 2 + dy * half
      });
    }
    for (const stop of fill.stops) {
      const c = stop.color;
      gradient.appendChild(svgEl("stop", {
        offset: stop.position,
        "stop-color": `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`,
        "stop-opacity": c.a
      }));
    }
    return gradient;
  }
  /** Element that will hold the SVG: the effect element itself unless it is inline. */
  function getSvgHost(element) {
    let host = element;
    while (host && host !== document.body && window.getComputedStyle(host).display.startsWith("inline") && window.getComputedStyle(host).display !== "inline-block" && window.getComputedStyle(host).display !== "inline-flex" && window.getComputedStyle(host).display !== "inline-grid") {
      host = host.parentElement;
    }
    return host || document.body;
  }
  /**
   * Gradient text (background-clip: text) and outlined text (-webkit-text-stroke) are
   * redrawn as an SVG <text> with an SVG gradient fill and stroke at the same position,
   * so the effect travels inside the copied design. The original HTML text is hidden
   * (kept in place for layout) so it is not duplicated. Everything is undone afterwards.
   */
  function applyTextEffectsAsSvg(container) {
    const claimed = /* @__PURE__ */ new Set();
    const measure = document.createElement("canvas").getContext("2d");
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      if (container !== document.documentElement && !container.contains(element)) continue;
      if (element instanceof SVGElement || element.closest("[data-h2d-ignore]")) continue;
      const computed = window.getComputedStyle(element);
      if (computed.display === "none" || computed.visibility === "hidden") continue;
      const clipText = computed.backgroundClip === "text" || computed.webkitBackgroundClip === "text";
      const strokeWidth = parseFloat(computed.webkitTextStrokeWidth) || 0;
      const box = element.getBoundingClientRect();
      const fill = clipText ? parseGradient(computed.backgroundImage, box.width, box.height) : null;
      if (!fill && strokeWidth <= 0) continue;
      if (element.textContent.length > MAX_EFFECT_TEXT || box.width < 1 || box.height < 1) continue;
      const strokeColor = strokeWidth > 0 ? parseCssColor(computed.webkitTextStrokeColor) : null;
      const host = getSvgHost(element);
      const hostComputed = window.getComputedStyle(host);
      const hostRect = host.getBoundingClientRect();
      const originX = hostRect.left + (parseFloat(hostComputed.borderLeftWidth) || 0);
      const originY = hostRect.top + (parseFloat(hostComputed.borderTopWidth) || 0);
      const svg = svgEl("svg", { width: box.width, height: box.height, viewBox: `0 0 ${box.width} ${box.height}`, "data-h2d-text-effect": "" });
      svg.style.cssText = `position:absolute;left:${box.left - originX}px;top:${box.top - originY}px;width:${box.width}px;height:${box.height}px;overflow:visible;pointer-events:none;margin:0;padding:0;border:0;z-index:auto;`;
      let paint = null;
      if (fill) {
        const id = `h2d-text-gradient-${++textSvgCounter}`;
        const defs = svgEl("defs", {});
        defs.appendChild(buildSvgGradient(fill, id, box.width, box.height));
        svg.appendChild(defs);
        paint = `url(#${id})`;
      }
      const textNodes = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        if (!node.textContent.trim() || claimed.has(node)) continue;
        textNodes.push(node);
      }
      let lineCount = 0;
      for (const textNode of textNodes) {
        const parentStyle = window.getComputedStyle(textNode.parentElement);
        const ownFill = parseCssColor(parentStyle.webkitTextFillColor);
        const nodeFill = paint || (ownFill && ownFill.a > 0 ? parentStyle.webkitTextFillColor : "none");
        const font = `${parentStyle.fontStyle} ${parentStyle.fontWeight} ${parentStyle.fontSize} ${parentStyle.fontFamily}`;
        measure.font = font;
        const metrics = measure.measureText("Hg");
        const ascent = metrics.fontBoundingBoxAscent;
        const descent = metrics.fontBoundingBoxDescent;
        for (const line of getRenderedLines(textNode)) {
          const baseline = line.top + (line.height - (ascent + descent)) / 2 + ascent;
          const text = svgEl("text", {
            x: line.left - box.left,
            y: baseline - box.top,
            fill: nodeFill,
            stroke: strokeWidth > 0 && strokeColor ? colorToCss(strokeColor) : null,
            "stroke-width": strokeWidth > 0 ? strokeWidth : null,
            "font-family": parentStyle.fontFamily,
            "font-size": parentStyle.fontSize,
            "font-weight": parentStyle.fontWeight,
            "font-style": parentStyle.fontStyle,
            "letter-spacing": parentStyle.letterSpacing !== "normal" ? parentStyle.letterSpacing : null,
            "xml:space": "preserve"
          });
          text.textContent = applyTextTransform(line.text, parentStyle.textTransform);
          svg.appendChild(text);
          lineCount++;
        }
      }
      if (!lineCount) continue;
      // Insert the SVG and make sure nothing in the layout moved
      const childRects = getChildRects(host);
      const hostBefore = host.getBoundingClientRect();
      if (hostComputed.position === "static") setInlineImportant(host, "position", "relative");
      host.appendChild(svg);
      const hostAfter = host.getBoundingClientRect();
      if (rectsMoved(childRects) || Math.abs(hostAfter.width - hostBefore.width) > 0.5 || Math.abs(hostAfter.height - hostBefore.height) > 0.5) {
        svg.remove();
        continue;
      }
      freezeState.addedNodes.push(svg);
      // Hide the original text (it keeps its space in the layout) and its effect
      for (const textNode of textNodes) {
        claimed.add(textNode);
        const wrapper = document.createElement("span");
        wrapper.setAttribute("data-h2d-text-hidden", "");
        wrapper.style.visibility = "hidden";
        textNode.replaceWith(wrapper);
        wrapper.appendChild(textNode);
        freezeState.unwraps.push([wrapper, textNode]);
      }
      if (clipText) {
        setInlineImportant(element, "background-image", "none");
        setInlineImportant(element, "background-color", "transparent");
      }
      if (strokeWidth > 0) setInlineImportant(element, "-webkit-text-stroke-width", "0px");
    }
  }

  // src/lib/core/declared.ts
  var FLEX_STYLE_KEYS = [
    { jsKey: "display", cssKey: "display" },
    { jsKey: "flexDirection", cssKey: "flex-direction" },
    { jsKey: "flexWrap", cssKey: "flex-wrap" },
    { jsKey: "justifyContent", cssKey: "justify-content" },
    { jsKey: "alignItems", cssKey: "align-items" },
    { jsKey: "alignContent", cssKey: "align-content" },
    { jsKey: "columnGap", cssKey: "column-gap" },
    { jsKey: "rowGap", cssKey: "row-gap" },
    { jsKey: "gap", cssKey: "gap" },
    { jsKey: "flexGrow", cssKey: "flex-grow" },
    { jsKey: "flexShrink", cssKey: "flex-shrink" },
    { jsKey: "flexBasis", cssKey: "flex-basis" },
    { jsKey: "alignSelf", cssKey: "align-self" },
    { jsKey: "order", cssKey: "order" },
    { jsKey: "flex", cssKey: "flex" }
  ];
  var GRID_STYLE_KEYS = [
    { jsKey: "display", cssKey: "display" },
    { jsKey: "gridTemplateColumns", cssKey: "grid-template-columns" },
    { jsKey: "gridTemplateRows", cssKey: "grid-template-rows" },
    { jsKey: "gridColumnStart", cssKey: "grid-column-start" },
    { jsKey: "gridColumnEnd", cssKey: "grid-column-end" },
    { jsKey: "gridRowStart", cssKey: "grid-row-start" },
    { jsKey: "gridRowEnd", cssKey: "grid-row-end" },
    { jsKey: "columnGap", cssKey: "column-gap" },
    { jsKey: "rowGap", cssKey: "row-gap" },
    { jsKey: "gap", cssKey: "gap" },
    { jsKey: "gridAutoFlow", cssKey: "grid-auto-flow" },
    { jsKey: "gridTemplateAreas", cssKey: "grid-template-areas" },
    { jsKey: "gridAutoColumns", cssKey: "grid-auto-columns" },
    { jsKey: "gridAutoRows", cssKey: "grid-auto-rows" },
    { jsKey: "gridColumn", cssKey: "grid-column" },
    { jsKey: "gridRow", cssKey: "grid-row" }
  ];
  var CSS_MEDIA_RULE = 4;
  var CSS_SUPPORTS_RULE = 12;
  var LAYOUT_STYLE_KEYS = [...FLEX_STYLE_KEYS, ...GRID_STYLE_KEYS];
  function hasLayoutStyles(style) {
    for (const { cssKey } of LAYOUT_STYLE_KEYS) {
      if (style.getPropertyValue(cssKey).trim()) return true;
    }
    return false;
  }
  function collectLayoutRules(ruleList) {
    const entries = [];
    for (let i = 0; i < ruleList.length; i++) {
      const rule = ruleList[i];
      if (rule == null) continue;
      if (rule.type === CSSRule.STYLE_RULE) {
        const styleRule = rule;
        if (hasLayoutStyles(styleRule.style)) {
          entries.push({ type: "style", rule: styleRule });
        }
        continue;
      }
      if (rule.type === CSS_MEDIA_RULE) {
        const mediaRule = rule;
        const innerEntries = collectLayoutRules(mediaRule.cssRules);
        if (innerEntries.length > 0) {
          entries.push({
            type: "media",
            mediaText: mediaRule.media.mediaText,
            inner: innerEntries
          });
        }
        continue;
      }
      if (rule.type === CSS_SUPPORTS_RULE) {
        const supportsRule = rule;
        try {
          const cssApi = globalThis.CSS;
          if (cssApi?.supports(supportsRule.conditionText)) {
            entries.push(...collectLayoutRules(supportsRule.cssRules));
          }
        } catch (_ignored) {
        }
        continue;
      }
      if ("cssRules" in rule && rule.cssRules) {
        entries.push(...collectLayoutRules(rule.cssRules));
      }
    }
    return entries;
  }
  function buildStylesheetCache(doc) {
    const entries = [];
    for (let i = 0; i < doc.styleSheets.length; i++) {
      const sheet = doc.styleSheets[i];
      if (sheet == null) continue;
      let rules;
      try {
        rules = sheet.cssRules ?? sheet.rules;
      } catch (_ignored) {
        continue;
      }
      if (rules) entries.push(...collectLayoutRules(rules));
    }
    return { entries, matchMediaCache: /* @__PURE__ */ new Map() };
  }
  function matchLayoutRules(element, cache, defaultView) {
    const result = {};
    const { entries, matchMediaCache } = cache;
    function processEntries(items) {
      for (const entry of items) {
        if (entry.type === "media") {
          let matches = matchMediaCache.get(entry.mediaText);
          if (matches === void 0) {
            matches = defaultView ? defaultView.matchMedia(entry.mediaText).matches : false;
            matchMediaCache.set(entry.mediaText, matches);
          }
          if (matches) processEntries(entry.inner);
          continue;
        }
        try {
          if (!element.matches(entry.rule.selectorText)) continue;
        } catch (_ignored) {
          continue;
        }
        const style = entry.rule.style;
        for (const { jsKey, cssKey } of LAYOUT_STYLE_KEYS) {
          const value = style.getPropertyValue(cssKey);
          if (value) result[jsKey] = value.trim();
        }
      }
    }
    processEntries(entries);
    return result;
  }
  function getDeclaredLayoutStyles(element, cacheMap) {
    const ownerDoc = element.ownerDocument;
    if (typeof ownerDoc === "undefined" || !ownerDoc.styleSheets) return {};
    let cache = cacheMap.get(ownerDoc);
    if (!cache) {
      cache = buildStylesheetCache(ownerDoc);
      cacheMap.set(ownerDoc, cache);
    }
    return matchLayoutRules(element, cache, ownerDoc.defaultView ?? null);
  }

  // src/lib/core/snapshot.ts
  var CAPTURE_TIMEOUT = 1e4;
  var DEFAULT_CONFIG = {
    assertLayoutValid: true,
    skipRemoteAssetSerialization: false,
    includeReactFiberTree: false,
    captureDeclaredStyles: false
  };
  var nodeIdCounter = 0;
  var nodeIdMap = /* @__PURE__ */ new WeakMap();
  function generateNodeId(node) {
    if (node !== null) {
      const existing = nodeIdMap.get(node);
      if (existing) return existing;
    }
    const id = `h2d-node-${++nodeIdCounter}`;
    if (node !== null) nodeIdMap.set(node, id);
    return id;
  }
  function getNodeId(element) {
    return nodeIdMap.get(element);
  }
  function safeRequestAnimationFrame(callback, signal) {
    if (signal.aborted) return;
    const frameId = realRequestAnimationFrame((timestamp) => {
      if (!signal.aborted) callback(timestamp);
    });
    signal.addEventListener("abort", () => cancelAnimationFrame(frameId), {
      once: true
    });
  }
  async function captureDOM(elementOrDocument, options) {
    const mergedOptions = { ...DEFAULT_CONFIG, ...options };
    const ctx = {
      captureDeclaredStyles: mergedOptions.captureDeclaredStyles === true,
      declaredStylesCache: mergedOptions.captureDeclaredStyles ? /* @__PURE__ */ new Map() : void 0
    };
    assertLayoutValid(mergedOptions);
    nodeIdCounter = 0;
    resetScrollbarState();
    const assetCollector = new ResourceResolver(mergedOptions);
    const fontCollector = new TypefaceProbe();
    try {
      return await captureDOMInner(elementOrDocument, mergedOptions, ctx, assetCollector, fontCollector);
    } finally {
      unfreezePage();
      cleanupScrollbar();
    }
  }
  async function captureDOMInner(elementOrDocument, mergedOptions, ctx, assetCollector, fontCollector) {
    if (elementOrDocument instanceof Element) {
      await prepareForCapture(elementOrDocument);
      await decodeImages(Array.from(elementOrDocument.querySelectorAll("img")));
      const serialized = await snapshotInAnimationFrame(
        elementOrDocument,
        assetCollector,
        fontCollector,
        mergedOptions,
        ctx
      );
      const blobMap = await assetCollector.getBlobMap();
      const fonts = fontCollector.getFonts();
      const { width, height } = elementOrDocument.getBoundingClientRect();
      if (!serialized || serialized.nodeType !== NODE_TYPES.ELEMENT_NODE) {
        throw new Error("Container node could not be serialized");
      }
      const experimental = mergedOptions.includeReactFiberTree ? { reactFiberTree: extractComponentTree(elementOrDocument, getNodeId) } : void 0;
      return {
        root: serialized,
        documentTitle: document.title || void 0,
        experimental,
        documentRect: {
          x: 0,
          y: 0,
          width: elementOrDocument.scrollWidth,
          height: elementOrDocument.scrollHeight
        },
        viewportRect: {
          x: elementOrDocument.scrollLeft,
          y: elementOrDocument.scrollTop,
          width,
          height
        },
        devicePixelRatio: window.devicePixelRatio,
        assets: blobMap,
        fonts
      };
    } else if (elementOrDocument instanceof Document) {
      await prepareForCapture(elementOrDocument.documentElement);
      await decodeImages(Array.from(elementOrDocument.images));
      const serialized = await snapshotInAnimationFrame(
        elementOrDocument.documentElement,
        assetCollector,
        fontCollector,
        mergedOptions,
        ctx
      );
      const blobMap = await assetCollector.getBlobMap();
      const fonts = fontCollector.getFonts();
      if (!serialized || serialized.nodeType !== NODE_TYPES.ELEMENT_NODE) {
        throw new Error("Container node must have a body element");
      }
      const experimental = mergedOptions.includeReactFiberTree ? { reactFiberTree: extractComponentTree(elementOrDocument.documentElement, getNodeId) } : void 0;
      return {
        documentTitle: elementOrDocument.title || void 0,
        root: serialized,
        experimental,
        documentRect: {
          x: 0,
          y: 0,
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight
        },
        viewportRect: {
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight
        },
        devicePixelRatio: window.devicePixelRatio,
        assets: blobMap,
        fonts
      };
    }
    throw new Error("Container node must be an Element or Document");
  }
  function snapshotInAnimationFrame(element, assetCollector, fontCollector, options, ctx) {
    assertLayoutValid(options);
    // Start the timeout here (after scrolling / image decoding), not before them,
    // otherwise long pages arrive with an already-aborted signal and hang forever.
    const signal = createVisibilityAwareSignal(CAPTURE_TIMEOUT);
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new CaptureError("requestAnimationFrame timed out", "PAGE_NOT_RESPONDING"));
        return;
      }
      let started = false;
      const run = () => {
        if (started || signal.aborted) return;
        started = true;
        try {
          resolve(snapshotNode(element, assetCollector, fontCollector, void 0, ctx));
        } catch (err) {
          reject(err);
        }
      };
      safeRequestAnimationFrame(run, signal);
      // rAF never fires while the tab is not being painted (background tab, busy
      // compositor); don't let that block the capture.
      setTimeout(run, 1e3);
      signal.addEventListener(
        "abort",
        () => reject(new CaptureError("requestAnimationFrame timed out", "PAGE_NOT_RESPONDING")),
        { once: true }
      );
    });
  }
  function snapshotNode(node, assetCollector, fontCollector, parentTransform, ctx) {
    if (Array.isArray(node) || node.nodeType === Node.TEXT_NODE) {
      return snapshotTextNode(node);
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      return snapshotElement(node, assetCollector, fontCollector, parentTransform, ctx);
    }
    if (node.nodeType !== Node.COMMENT_NODE) {
      console.warn(`Unsupported node type: ${node.nodeType}`);
    }
    return null;
  }
  function snapshotElement(element, assetCollector, fontCollector, parentTransform, ctx) {
    const childNodes = [];
    let svgContent;
    let placeholderUrl;
    let selectionSourceId;
    if (!isNodeVisible(element)) return null;
    const tag = element.tagName.toUpperCase();
    if (tag === "HEAD" || tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
      return null;
    }
    const sources = getSourceAnnotations(element);
    if (sources && sources.length > 0) {
      if (sources[0]?.type === "text" && element.childNodes.length === 1) {
        const textNode = snapshotTextNode(element.childNodes[0]);
        textNode.sources = sources;
        return textNode;
      }
      selectionSourceId = getInspectorSelectedId(element);
    }
    const computedStyles = diffStyles(element);
    if (tag === "HTML" && !computedStyles.backgroundColor && !computedStyles.backgroundImage) {
      const bodyBg = window.getComputedStyle(document.body).backgroundColor;
      if (bodyBg && bodyBg !== "rgba(0, 0, 0, 0)") {
        computedStyles.backgroundColor = bodyBg;
      }
    }
    const displayValue = computedStyles.display;
    if (displayValue === "flex" || displayValue === "inline-flex") {
      ensureFlexProps(element, computedStyles);
    } else if (displayValue === "grid" || displayValue === "inline-grid") {
      ensureGridProps(element, computedStyles);
    }
    const parentDisplay = element.parentElement ? window.getComputedStyle(element.parentElement).display : "";
    if (parentDisplay === "flex" || parentDisplay === "inline-flex" || parentDisplay === "grid" || parentDisplay === "inline-grid") {
      ensureFlexItemProps(element, computedStyles);
    }
    const declaredStyles = ctx?.captureDeclaredStyles === true && ctx.declaredStylesCache ? getDeclaredLayoutStyles(element, ctx.declaredStylesCache) : {};
    const elementTransform = resolveTransform(computedStyles);
    const combinedTransform = multiplyMatrices(parentTransform, elementTransform);
    if (element instanceof SVGElement) {
      svgContent = bakeSvgStyles(element);
    } else if (element instanceof HTMLCanvasElement) {
      placeholderUrl = assetCollector.addCanvas(element);
    } else {
      for (const childOrGroup of iterateChildNodes(getRenderedChildrenParent(element))) {
        const serialized = snapshotNode(childOrGroup, assetCollector, fontCollector, combinedTransform, ctx);
        if (serialized != null) childNodes.push(serialized);
      }
    }
    let pseudoElementStyles;
    for (const pseudo of ["::before", "::after"]) {
      const pseudoComputed = window.getComputedStyle(element, pseudo);
      const contentValue = pseudoComputed.content;
      if (contentValue && contentValue !== "none" && contentValue !== "normal") {
        if (!pseudoElementStyles) pseudoElementStyles = {};
        const styles = diffStyles(element, pseudo);
        styles.content = contentValue;
        // Images used by ::before / ::after (icons, decorations) need to be downloaded too
        collectBackgroundImages(assetCollector, styles);
        for (const [, url] of contentValue.matchAll(/url\("(.*?)"\)/g)) {
          assetCollector.addImage(url);
        }
        pseudoElementStyles[pseudo === "::before" ? "before" : "after"] = styles;
      }
    }
    if (element instanceof HTMLInputElement && INPUT_TYPES_WITH_PLACEHOLDER.has(element.type) || element instanceof HTMLTextAreaElement) {
      if (element.placeholder) {
        if (!pseudoElementStyles) pseudoElementStyles = {};
        pseudoElementStyles.placeholder = diffStyles(element, "::placeholder");
      }
    }
    resolveResources(element, computedStyles, assetCollector);
    resolveFonts(element, computedStyles, fontCollector);
    const rect = getElementRect(element, computedStyles, combinedTransform);
    if (shouldPruneNode(element, rect, childNodes)) {
      return null;
    }
    const sizing = inferLayoutSizing(element, computedStyles, element.parentElement);
    const node = {
      nodeType: Node.ELEMENT_NODE,
      id: generateNodeId(element),
      tag,
      attributes: getElementAttributes(element),
      styles: computedStyles,
      rect,
      childNodes,
      content: svgContent,
      placeholderUrl,
      pseudoElementStyles,
      owningReactComponent: findParentComponent(element),
      sources,
      selectionSourceId,
      relativeTransform: elementTransform ? matrixToSimple(elementTransform) : void 0,
      layoutSizingHorizontal: sizing.horizontal,
      layoutSizingVertical: sizing.vertical
    };
    if (Object.keys(declaredStyles).length > 0) {
      node.declaredStyles = declaredStyles;
    }
    return node;
  }
  function snapshotTextNode(nodeOrNodes) {
    const { lineCount, ...rectWithoutLineCount } = getTextRect(nodeOrNodes);
    const text = Array.isArray(nodeOrNodes) ? nodeOrNodes.map((n) => n.textContent || "").join("") : nodeOrNodes.textContent || "";
    const identityNode = Array.isArray(nodeOrNodes) ? nodeOrNodes.length === 1 ? nodeOrNodes[0] : null : nodeOrNodes;
    return {
      nodeType: Node.TEXT_NODE,
      id: generateNodeId(identityNode),
      text,
      rect: rectWithoutLineCount,
      lineCount
    };
  }

  // src/lib/pipeline.ts
  var LOG_PREFIX = "[WebParser for Figma]";
  var SUBMIT_TIMEOUT = 6e4;
  var ERROR_MESSAGES = {
    CAPTURE_EXPIRED: "Capture expired. Please start a new capture.",
    CAPTURE_NOT_FOUND: "Capture not found. Please start a new capture.",
    ACCESS_DENIED: "Access denied. Please try again.",
    CAPTURE_ID_ALREADY_SUBMITTED: "Capture already submitted. Please start a new capture.",
    PAGE_NOT_RESPONDING: "Capture timed out. Try keeping this tab in the foreground.",
    VIDEO_TIMEOUT: "Request timed out. Please try again."
  };
  var logger = {
    verbose: false,
    log: (...args) => {
      if (logger.verbose) console.log(LOG_PREFIX, ...args);
    },
    error: (...args) => {
      if (logger.verbose) console.error(LOG_PREFIX, ...args);
    }
  };
  async function waitForDOMReady() {
    if (document.readyState === "loading") {
      logger.log("Waiting for DOM to be ready...");
      await new Promise(
        (resolve) => document.addEventListener("DOMContentLoaded", () => resolve())
      );
    }
  }
  function createVisibilityAwareSignal(timeout) {
    const controller = new AbortController();
    let remaining = timeout;
    let visibleSince = document.hidden ? null : realNow();
    let timer = visibleSince ? scheduleAbort() : null;
    function cleanup() {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }
    function scheduleAbort() {
      return setTimeout(() => {
        cleanup();
        controller.abort();
      }, remaining);
    }
    function onVisibilityChange() {
      if (document.hidden) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
          remaining -= realNow() - (visibleSince ?? realNow());
          visibleSince = null;
        }
      } else {
        if (timer === null && remaining > 0) {
          visibleSince = realNow();
          timer = scheduleAbort();
        }
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    controller.signal.addEventListener("abort", cleanup, { once: true });
    return controller.signal;
  }
  async function capturePage(selector = "body") {
    await waitForDOMReady();
    const root = selector === "body" || selector === "html" ? document : document.querySelector(selector);
    if (!root) throw new Error(`Element not found: ${selector}`);
    logger.log("Serializing DOM...");
    let tree;
    try {
      tree = await captureDOM(root);
    } catch (err) {
      if (err instanceof CaptureError) {
        throw new Error(ERROR_MESSAGES[err.code] || err.message);
      }
      throw err;
    }
    logger.log("Converting to JSON...");
    const json = await treeToJson(tree);
    const sizeKB = Math.round(json.length / 1024);
    logger.log(`Payload size: ${sizeKB} KB`);
    return json;
  }
  async function submitCapture(json, captureId, endpoint, captureIndex = 0) {
    logger.log("Sending captures to Figma...");
    const sizeKB = Math.round(json.length / 1024);
    logger.log(`Sending capture, total size: ${sizeKB} KB`);
    const url = endpoint.replace(
      /\/capture\/[^/]+\/submit/,
      `/capture/${captureId}/submit`
    );
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), SUBMIT_TIMEOUT);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captureId,
          payload: json,
          captureIndex
        }),
        signal: abortController.signal
      });
      clearTimeout(timer);
      if (!response.ok) {
        let message;
        try {
          const body = await response.json();
          if (body.errorCode) {
            message = ERROR_MESSAGES[body.errorCode] || body.errorCode;
          } else {
            message = body.error || response.statusText;
          }
        } catch (_parseErr) {
          message = await response.text().catch(() => response.statusText);
        }
        logger.error(`Server error (${response.status}): ${message}`);
        throw new Error(message);
      }
      const data = await response.json();
      if (data.error) {
        logger.error("Capture failed:", data.error);
        throw new Error(data.error);
      }
      logger.log("Success! Page has been captured and sent to Figma.");
      const claimUrl = data.claimUrl || data.fileUrl;
      if (claimUrl) logger.log(`Open your file: ${claimUrl}`);
      return { claimUrl, nextCaptureId: data.nextCaptureId };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Request timed out after ${SUBMIT_TIMEOUT / 1e3} seconds`);
      }
      throw err;
    }
  }
  async function waitForFocus() {
    if (!document.hasFocus()) {
      logger.log("Document not focused, waiting for focus...");
      await new Promise((resolve) => {
        window.addEventListener("focus", () => resolve(), { once: true });
      });
      logger.log("Document focused, proceeding with clipboard copy");
    }
  }
  async function writeToClipboard(json) {
    if (window.figma?.useHtmlClipboardEncoding !== false) {
      const html = await wrapForClipboard(json);
      await waitForFocus();
      const item = new ClipboardItem({ "text/html": html });
      await navigator.clipboard.write([item]);
    } else {
      await waitForFocus();
      await navigator.clipboard.writeText(json);
    }
  }

  // src/lib/config.ts
  var ALLOWED_FIGMA_DOMAINS = [
    "figma.com",
    "www.figma.com",
    "api.figma.com",
    "mcp.figma.com",
    "local.figma.engineering",
    "mcp.local.figma.engineering",
    "figdev.systems",
    "localhost"
  ];
  function isValidFigmaEndpoint(url) {
    try {
      const hostname = new URL(url).hostname;
      return ALLOWED_FIGMA_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      );
    } catch {
      return false;
    }
  }
  function parseHashParams() {
    const hash = window.location.hash;
    if (!hash.startsWith("#figmacapture")) {
      return { shouldCapture: false };
    }
    const parts = hash.slice(1).split("&");
    let captureId;
    let endpoint;
    let delay;
    let selector;
    let logPayload;
    let logVerbose;
    for (const part of parts) {
      const [key, value] = part.split("=");
      if (key === "figmacapture" && value) {
        captureId = decodeURIComponent(value);
      } else if (key === "figmaendpoint" && value) {
        endpoint = decodeURIComponent(value);
      } else if (key === "figmadelay" && value) {
        const parsed = parseInt(decodeURIComponent(value), 10);
        if (!isNaN(parsed) && parsed >= 0) {
          delay = parsed;
        }
      } else if (key === "figmaselector" && value) {
        selector = decodeURIComponent(value);
      } else if (key === "figmalogpayload") {
        logPayload = value !== "false";
      } else if (key === "figmalogverbose") {
        logVerbose = value !== "false";
      }
    }
    return {
      shouldCapture: true,
      captureId,
      endpoint,
      delay,
      selector,
      logPayload,
      logVerbose
    };
  }

  // src/lib/api.ts
  if (typeof window !== "undefined") {
    if (!window.figma) {
      window.figma = {};
    }
    window.figma.capturePage = capturePage;
    window.figma.submitCapture = submitCapture;
    window.figma.writeToClipboard = writeToClipboard;
    window.figma.wrapForClipboard = wrapForClipboard;
    window.figma.isValidFigmaEndpoint = isValidFigmaEndpoint;
    window.figma.parseHashParams = parseHashParams;
    window.figma.setVerbose = (enabled) => {
      logger.verbose = !!enabled;
    };
  }
})();