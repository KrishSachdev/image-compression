// Shared namespace, utilities, app state, and settings persistence.
// Loaded first: every other script hangs off window.CL.
(function (CL) {
  "use strict";

  let uidCounter = 0;
  CL.uid = () => `item-${++uidCounter}`;

  CL.clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  CL.formatBytes = function (bytes) {
    if (!Number.isFinite(bytes)) return "-";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unit]}`;
  };

  CL.loadImage = function (src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("The browser could not decode that image."));
      img.src = src;
    });
  };

  CL.canvasToBlob = function (canvas, mime, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), mime, quality);
    });
  };

  CL.toast = function (message) {
    const el = document.querySelector("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(CL.toast.timer);
    CL.toast.timer = setTimeout(() => el.classList.remove("is-visible"), 2800);
  };

  // Cross-module callbacks assigned by app.js; modules that load earlier call
  // them with optional chaining so load order never matters.
  CL.hooks = {};

  CL.state = {
    items: [],
    activeId: null,
    supported: {},
    previewMode: "compare",
    split: 50,
    history: [],
    processing: false,
    debounce: 0,
    animFrameId: 0,
  };

  CL.activeItem = () =>
    CL.state.items.find((item) => item.id === CL.state.activeId) || null;

  // ── Settings (DOM is the source of truth; localStorage mirrors it) ──
  const KEY = "cl-settings";
  const $ = (selector) => document.querySelector(selector);

  const defaults = {
    codec: "webp",
    quality: 82,
    palette: 7,
    resizeMode: "edge",
    maxEdge: 0,
    exactW: "",
    exactH: "",
    aspectLock: true,
    percent: 100,
    targetKB: "",
    passes: 8,
    dither: true,
    matte: "#ffffff",
    showAll: false,
  };

  function read() {
    return {
      codec: document.querySelector('input[name="codec"]:checked')?.value || "webp",
      quality: Number($("#qualityRange").value),
      palette: Number($("#paletteRange").value),
      resizeMode: $("#resizeGroup").dataset.mode || "edge",
      maxEdge: Number($("#resizeRange").value),
      exactW: $("#exactW").value,
      exactH: $("#exactH").value,
      aspectLock: $("#aspectLock").checked,
      percent: Number($("#percentRange").value),
      targetKB: $("#targetInput").value,
      passes: Number($("#passesRange").value),
      dither: $("#ditherToggle").checked,
      matte: $("#matteInput").value,
      showAll: $("#showAllSettingsToggle").checked,
    };
  }

  function apply(saved) {
    const s = { ...defaults, ...(saved || {}) };
    const codecInput = document.querySelector(`input[name="codec"][value="${s.codec}"]`);
    if (codecInput) codecInput.checked = true;
    $("#qualityRange").value = s.quality;
    $("#paletteRange").value = s.palette;
    $("#resizeGroup").dataset.mode = s.resizeMode;
    $("#resizeRange").value = s.maxEdge;
    $("#exactW").value = s.exactW;
    $("#exactH").value = s.exactH;
    $("#aspectLock").checked = s.aspectLock;
    $("#percentRange").value = s.percent;
    $("#targetInput").value = s.targetKB;
    $("#passesRange").value = s.passes;
    $("#ditherToggle").checked = s.dither;
    $("#matteInput").value = s.matte;
    $("#showAllSettingsToggle").checked = s.showAll;
    $("#controlStack").classList.toggle("hide-inactive", !s.showAll);
  }

  // Everything that changes encode output; showAll is view-only.
  function fingerprint() {
    const { showAll, ...rest } = read();
    return JSON.stringify(rest);
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(read()));
    } catch {
      /* storage full or blocked: persistence is best-effort */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  CL.settings = { defaults, read, apply, fingerprint, save, load, clear };
})(window.CL = window.CL || {});
