// Bootstrap and orchestration: wires the DOM to the batch/compare/imageio
// modules, owns the idle dropzone animation, presets, history, theme, and
// the PWA registration.
(function (CL) {
  "use strict";

  const els = {
    fileInput: document.querySelector("#fileInput"),
    dropzone: document.querySelector("#dropzone"),
    idleCanvas: document.querySelector("#idleCanvas"),
    sourceThumb: document.querySelector("#sourceThumb"),
    dropTitle: document.querySelector(".drop-title"),
    dropSubtitle: document.querySelector(".drop-subtitle"),
    sourceMeta: document.querySelector("#sourceMeta"),
    sourceSize: document.querySelector("#sourceSize"),
    sourceDimensions: document.querySelector("#sourceDimensions"),
    sourceType: document.querySelector("#sourceType"),
    sourceAlpha: document.querySelector("#sourceAlpha"),
    editStrip: document.querySelector("#editStrip"),
    headerFormat: document.querySelector("#headerFormat"),
    headerSaving: document.querySelector("#headerSaving"),
    settingsSummary: document.querySelector("#settingsSummary"),
    showAllSettingsToggle: document.querySelector("#showAllSettingsToggle"),
    controlStack: document.querySelector("#controlStack"),
    codecGrid: document.querySelector("#codecGrid"),
    qualityRange: document.querySelector("#qualityRange"),
    qualityValue: document.querySelector("#qualityValue"),
    paletteRange: document.querySelector("#paletteRange"),
    paletteValue: document.querySelector("#paletteValue"),
    resizeGroup: document.querySelector("#resizeGroup"),
    resizeModeSwitch: document.querySelector("#resizeModeSwitch"),
    resizeRange: document.querySelector("#resizeRange"),
    resizeValue: document.querySelector("#resizeValue"),
    exactW: document.querySelector("#exactW"),
    exactH: document.querySelector("#exactH"),
    exactNote: document.querySelector("#exactNote"),
    aspectLock: document.querySelector("#aspectLock"),
    percentRange: document.querySelector("#percentRange"),
    percentValue: document.querySelector("#percentValue"),
    targetInput: document.querySelector("#targetInput"),
    passesRange: document.querySelector("#passesRange"),
    passesValue: document.querySelector("#passesValue"),
    ditherToggle: document.querySelector("#ditherToggle"),
    matteInput: document.querySelector("#matteInput"),
    bakeoffButton: document.querySelector("#bakeoffButton"),
    bakeoffResults: document.querySelector("#bakeoffResults"),
    compressButton: document.querySelector("#compressButton"),
    resetButton: document.querySelector("#resetButton"),
    previewToggle: document.querySelector("#previewToggle"),
    zoomBar: document.querySelector("#zoomBar"),
    loupeToggle: document.querySelector("#loupeToggle"),
    compareBox: document.querySelector("#compareBox"),
    resultStatus: document.querySelector("#resultStatus"),
    outputSize: document.querySelector("#outputSize"),
    savedPercent: document.querySelector("#savedPercent"),
    outputDimensions: document.querySelector("#outputDimensions"),
    pixelDelta: document.querySelector("#pixelDelta"),
    ssimValue: document.querySelector("#ssimValue"),
    downloadButton: document.querySelector("#downloadButton"),
    copyButton: document.querySelector("#copyButton"),
    historyPanel: document.querySelector("#historyPanel"),
    historyList: document.querySelector("#historyList"),
    darkToggle: document.querySelector("#darkToggle"),
  };

  // ── Idle dropzone animation (the packed-grid wave) ───────────────
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function sizeIdleCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = els.dropzone.clientWidth;
    const height = els.dropzone.clientHeight;
    if (!width || !height) return;
    const backingW = Math.round(width * dpr);
    const backingH = Math.round(height * dpr);
    if (els.idleCanvas.width !== backingW || els.idleCanvas.height !== backingH) {
      els.idleCanvas.width = backingW;
      els.idleCanvas.height = backingH;
    }
  }

  function drawIdleFrame() {
    const canvas = els.idleCanvas;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const dark = document.documentElement.dataset.theme === "dark";
    ctx.fillStyle = dark ? "#172220" : "#edf3ef";
    ctx.fillRect(0, 0, width, height);

    const now = performance.now() / 900;
    const cell = 18;
    const colHigh = dark ? "#2dd4bf" : "#0f766e";
    const colLow = dark ? "#f87171" : "#db5a4f";
    const colMid = dark ? "#1c3530" : "#ffffff";
    for (let y = -cell; y < height + cell; y += cell) {
      for (let x = -cell; x < width + cell; x += cell) {
        const wave = Math.sin(x * 0.026 + y * 0.018 + now);
        const packed = Math.max(4, Math.round(cell - (wave + 1) * 5));
        ctx.fillStyle = wave > 0.45 ? colHigh : wave < -0.45 ? colLow : colMid;
        ctx.globalAlpha = wave > 0.45 || wave < -0.45 ? 0.18 : 0.78;
        ctx.fillRect(x + (cell - packed) / 2, y + (cell - packed) / 2, packed, packed);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawIdleCanvas() {
    // Stop loop once an image is loaded or another tool is open;
    // renderEmpty() / onCompressShown restart it.
    const otherTool = document.body.dataset.view && document.body.dataset.view !== "compress";
    if (els.dropzone.classList.contains("has-image") || otherTool) {
      CL.state.animFrameId = 0;
      return;
    }
    // Skip actual draw while tab is hidden to save CPU.
    if (document.visibilityState !== "hidden") {
      sizeIdleCanvas();
      drawIdleFrame();
    }
    // Reduced motion keeps the visual but freezes it on one frame.
    if (reduceMotion.matches) {
      CL.state.animFrameId = 0;
      return;
    }
    CL.state.animFrameId = requestAnimationFrame(drawIdleCanvas);
  }

  function startIdle() {
    if (!CL.state.animFrameId) {
      CL.state.animFrameId = requestAnimationFrame(drawIdleCanvas);
    }
  }

  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener("change", startIdle);
  }
  new ResizeObserver(() => {
    if (!els.dropzone.classList.contains("has-image")) {
      sizeIdleCanvas();
      drawIdleFrame();
    }
  }).observe(els.dropzone);

  // ── Shared UI helpers ────────────────────────────────────────────
  function setDownloadEnabled(enabled) {
    els.downloadButton.classList.toggle("is-disabled", !enabled);
    els.downloadButton.setAttribute("aria-disabled", String(!enabled));
    if (!enabled) els.downloadButton.removeAttribute("href");
  }

  function setCopyEnabled(enabled) {
    els.copyButton.disabled = !enabled;
  }

  function setBusy(isBusy) {
    document.body.classList.toggle("is-busy", isBusy);
    els.compressButton.disabled = !CL.activeItem() || isBusy;
    els.compressButton.textContent = isBusy ? "Compressing..." : "Compress image";
  }

  function updatePresetButtons(activeName = "") {
    document.querySelectorAll(".preset-button").forEach((button) => {
      const active = button.dataset.preset === activeName;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updatePreviewButtons() {
    const item = CL.activeItem();
    const hasOutput = Boolean(item?.output);
    els.previewToggle.querySelectorAll("button").forEach((button) => {
      button.disabled = !hasOutput;
      const active = button.dataset.view === CL.state.previewMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    els.zoomBar.querySelectorAll("button").forEach((button) => {
      button.disabled = !item;
    });
    els.loupeToggle.disabled = !item;
  }

  function updateHeaderStats() {
    const items = CL.state.items;
    if (!items.length) {
      els.headerFormat.textContent = "No image loaded";
      els.headerSaving.textContent = "Ready";
      return;
    }
    if (items.length === 1) {
      const item = items[0];
      if (item.output) {
        const codec = CL.codecs[item.output.codecId];
        const saved = 1 - item.output.blob.size / item.file.size;
        els.headerFormat.textContent = `${codec.label} ${item.output.width} x ${item.output.height}`;
        els.headerSaving.textContent =
          saved >= 0
            ? `${Math.round(saved * 100)}%`
            : `${Math.round(Math.abs(saved) * 100)}% larger`;
      } else {
        els.headerFormat.textContent = `${item.width} x ${item.height}`;
        els.headerSaving.textContent = "Loaded";
      }
      return;
    }
    const done = items.filter((item) => item.output);
    els.headerFormat.textContent = `${items.length} images`;
    if (done.length) {
      const inTotal = done.reduce((sum, item) => sum + item.file.size, 0);
      const outTotal = done.reduce((sum, item) => sum + item.output.blob.size, 0);
      els.headerSaving.textContent = `${CL.formatBytes(inTotal)} → ${CL.formatBytes(outTotal)}`;
    } else {
      els.headerSaving.textContent = "Working…";
    }
  }

  // ── Active item rendering ────────────────────────────────────────
  function renderActiveItem() {
    const item = CL.activeItem();
    if (!item) {
      renderEmpty();
      return;
    }

    els.sourceThumb.src = item.displayUrl;
    els.dropzone.classList.add("has-image");
    els.dropTitle.textContent = "Add more images";
    els.dropSubtitle.textContent = item.file.name;

    // Match both panel containers to the image ratio – eliminates letterboxing.
    const ratio = `${item.width} / ${item.height}`;
    els.dropzone.style.aspectRatio = ratio;
    els.dropzone.style.minHeight = "0";
    els.compareBox.style.aspectRatio = ratio;
    els.compareBox.style.minHeight = "0";

    els.sourceMeta.classList.remove("is-hidden");
    els.editStrip.classList.remove("is-hidden");
    els.sourceSize.textContent = CL.formatBytes(item.file.size);
    els.sourceDimensions.textContent = `${item.width} x ${item.height}`;
    els.sourceType.textContent =
      item.file.type.replace("image/", "").toUpperCase() || "Image";
    els.sourceAlpha.textContent = item.hasAlpha ? "Yes" : "No";
    els.resetButton.disabled = false;
    els.compressButton.disabled = CL.state.processing;

    els.bakeoffResults.hidden = true;
    CL.compare.setBefore(item.displayUrl);
    CL.compare.resetZoom();
    renderActiveOutput();
    syncControls();
  }

  function renderActiveOutput() {
    const item = CL.activeItem();
    if (!item) return;
    const out = item.output;

    if (out) {
      els.compareBox.classList.add("has-output");
      CL.compare.setAfter(out.url);
      els.downloadButton.href = out.url;
      els.downloadButton.download = CL.batch.outputName(item, CL.codecs[out.codecId]);
      setDownloadEnabled(true);
      setCopyEnabled(true);

      const saved = 1 - out.blob.size / item.file.size;
      els.outputSize.textContent = CL.formatBytes(out.blob.size);
      els.savedPercent.textContent =
        saved >= 0
          ? `${Math.round(saved * 100)}%`
          : `${Math.round(Math.abs(saved) * 100)}% larger`;
      els.outputDimensions.textContent = `${out.width} x ${out.height}`;
      els.pixelDelta.textContent = out.lossy
        ? `${out.delta.toFixed(2)}%`
        : `${out.delta.toFixed(3)}%`;
      els.ssimValue.textContent = `${(out.ssim * 100).toFixed(1)}%`;
      els.resultStatus.textContent = out.summary;
    } else {
      els.compareBox.classList.remove("has-output");
      CL.compare.setAfter(null);
      setDownloadEnabled(false);
      setCopyEnabled(false);
      els.outputSize.textContent = "-";
      els.savedPercent.textContent = "-";
      els.outputDimensions.textContent = "-";
      els.pixelDelta.textContent = "-";
      els.ssimValue.textContent = "-";
      els.resultStatus.textContent =
        item.status === "working"
          ? "Compressing…"
          : item.status === "error"
            ? item.error
            : "Ready to compress.";
    }
    updatePreviewButtons();
    updateHeaderStats();
  }

  function renderEmpty() {
    els.sourceThumb.removeAttribute("src");
    els.dropzone.classList.remove("has-image");
    els.dropzone.style.aspectRatio = "";
    els.dropzone.style.minHeight = "";
    els.compareBox.style.aspectRatio = "";
    els.compareBox.style.minHeight = "";
    els.dropTitle.textContent = "Drop images here";
    els.dropSubtitle.textContent =
      "PNG, JPEG, WebP, AVIF, GIF, or SVG — one file or a whole batch. You can also paste with Ctrl+V.";
    els.sourceMeta.classList.add("is-hidden");
    els.editStrip.classList.add("is-hidden");
    els.bakeoffResults.hidden = true;

    CL.compare.setBefore(null);
    CL.compare.setAfter(null);
    els.compareBox.classList.remove("has-output");
    setDownloadEnabled(false);
    setCopyEnabled(false);
    els.outputSize.textContent = "-";
    els.savedPercent.textContent = "-";
    els.outputDimensions.textContent = "-";
    els.pixelDelta.textContent = "-";
    els.ssimValue.textContent = "-";
    els.resultStatus.textContent = "Choose an image to begin.";
    els.headerFormat.textContent = "No image loaded";
    els.headerSaving.textContent = "Ready";
    els.compressButton.disabled = true;
    els.resetButton.disabled = true;

    CL.state.previewMode = "compare";
    CL.compare.setSplit(50);
    CL.compare.resetZoom();
    CL.compare.setLoupe(false);
    updatePreviewButtons();
    startIdle();
  }

  // ── Controls ─────────────────────────────────────────────────────
  function setControlAvailability(name, isAvailable, note) {
    const row = document.querySelector(`[data-control="${name}"]`);
    if (!row) return;
    row.classList.toggle("is-unavailable", !isAvailable);
    row.querySelectorAll("input").forEach((input) => {
      input.disabled = !isAvailable;
    });
    const scope = row.querySelector(".setting-scope");
    if (scope) {
      scope.dataset.defaultText ||= scope.textContent;
      scope.textContent = isAvailable ? scope.dataset.defaultText : note;
    }
  }

  function syncResizeModeUI() {
    const mode = els.resizeGroup.dataset.mode || "edge";
    els.resizeModeSwitch.querySelectorAll("button").forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    els.resizeGroup.querySelectorAll(".resize-mode").forEach((section) => {
      section.hidden = section.dataset.for !== mode;
    });
  }

  function syncControls() {
    const codecId = CL.selectedCodecId();
    const codec = CL.selectedCodec();
    const isPalette = codecId === "png-palette";
    const usesQuality = codec.lossy && !isPalette;
    const usesTarget = codec.targetable;
    const usesMatte = codecId === "jpeg";

    setControlAvailability("quality", usesQuality, `Not used by ${codec.label}.`);
    setControlAvailability("palette", isPalette, "Only used by PNG palette.");
    setControlAvailability("dither", isPalette, "Only used by PNG palette.");
    setControlAvailability(
      "target",
      usesTarget,
      "Target size works with WebP, JPEG, and AVIF.",
    );
    setControlAvailability(
      "passes",
      usesTarget && Number(els.targetInput.value) > 0,
      usesTarget ? "Fill target size to use this." : "Target search is not used by this format.",
    );
    setControlAvailability("matte", usesMatte, "Only used by JPEG.");

    const summaries = {
      webp: "WebP: best default for small files, photos, and transparency.",
      jpeg: "JPEG: most compatible for photos, but no transparency.",
      png: "PNG: exact pixels for screenshots, logos, and sharp graphics.",
      "png-palette": "PNG palette: fewer colors for smaller simple graphics.",
      avif: "AVIF: efficient, but web-page encoding support is limited.",
    };
    els.settingsSummary.textContent = summaries[codecId];

    els.qualityValue.value = `${els.qualityRange.value}%`;
    // Show the actual maximum color count (levels³) that will be applied.
    els.paletteValue.value = String(CL.selectedLevels() ** 3);
    els.passesValue.value = els.passesRange.value;
    const maxEdge = Number(els.resizeRange.value);
    els.resizeValue.value = maxEdge ? `${maxEdge}px` : "Original";

    const item = CL.activeItem();
    const mode = els.resizeGroup.dataset.mode || "edge";
    if (item) {
      const dims = CL.imageio.targetDims(item);
      els.percentValue.value = `${els.percentRange.value}% → ${dims.width} x ${dims.height}`;
      els.exactNote.textContent =
        mode === "exact"
          ? `Output: ${dims.width} x ${dims.height}${dims.capped ? " (capped to source size)" : ""}`
          : "";
    } else {
      els.percentValue.value = `${els.percentRange.value}%`;
      els.exactNote.textContent = "";
    }

    syncResizeModeUI();
    updatePreviewButtons();
  }

  function scheduleRun() {
    clearTimeout(CL.state.debounce);
    CL.state.debounce = setTimeout(() => CL.batch.pump(), 380);
  }

  function onSettingsChanged({ keepPreset = false } = {}) {
    if (!keepPreset) updatePresetButtons("");
    els.bakeoffResults.hidden = true;
    CL.settings.save();
    syncControls();
    CL.batch.updateQueueUI();
    CL.batch.markActiveDirty();
    if (CL.activeItem()) scheduleRun();
  }

  function applyPreset(name) {
    updatePresetButtons(name);
    const supported = CL.state.supported;

    if (name === "photo") {
      CL.setCodec(supported.webp ? "webp" : "jpeg");
      els.qualityRange.value = 82;
      els.resizeGroup.dataset.mode = "edge";
      els.resizeRange.value = 0;
      els.targetInput.value = "";
    }
    if (name === "tiny") {
      CL.setCodec(supported.webp ? "webp" : "jpeg");
      els.qualityRange.value = 56;
      els.resizeGroup.dataset.mode = "edge";
      els.resizeRange.value = 1600;
      els.targetInput.value = "";
    }
    if (name === "transparent") {
      CL.setCodec(supported.webp ? "webp" : "png-palette");
      els.qualityRange.value = 86;
      els.paletteRange.value = 7;
      els.resizeGroup.dataset.mode = "edge";
      els.resizeRange.value = 0;
      els.targetInput.value = "";
    }
    if (name === "compat") {
      CL.setCodec("jpeg");
      els.qualityRange.value = 84;
      els.resizeGroup.dataset.mode = "edge";
      els.resizeRange.value = 0;
      els.targetInput.value = "";
    }

    onSettingsChanged({ keepPreset: true });
  }

  // ── Auto best (format bake-off) ──────────────────────────────────
  async function runBakeoff() {
    const item = CL.activeItem();
    if (!item) return;
    if (CL.state.processing) {
      CL.toast("Wait for the current compression to finish.");
      return;
    }

    CL.state.processing = true;
    setBusy(true);
    els.bakeoffButton.disabled = true;
    els.bakeoffButton.textContent = "Testing formats…";
    try {
      const settings = { ...CL.settings.read(), targetKB: "" };
      const rows = [];
      for (const id of ["webp", "jpeg", "avif", "png"]) {
        if (!CL.state.supported[id]) continue;
        const codec = CL.codecs[id];
        try {
          const canvas = CL.imageio.buildCanvas(item, codec, settings);
          const { blob } = await CL.imageio.encode(canvas, codec, settings);
          rows.push({ id, label: codec.label, size: blob.size, lossy: codec.lossy });
        } catch {
          /* codec failed here: leave it out of the table */
        }
      }
      if (!rows.length) {
        CL.toast("No output format could be tested in this browser.");
        return;
      }
      renderBakeoff(rows, Number(settings.quality));
    } finally {
      CL.state.processing = false;
      setBusy(false);
      els.bakeoffButton.disabled = false;
      els.bakeoffButton.textContent = "Find smallest format";
      CL.batch.pump();
    }
  }

  function renderBakeoff(rows, quality) {
    const smallest = Math.min(...rows.map((row) => row.size));
    els.bakeoffResults.textContent = "";

    const note = document.createElement("small");
    note.className = "bakeoff-note";
    note.textContent = `Same image, lossy formats at ${quality}% quality, no target size.`;
    els.bakeoffResults.appendChild(note);

    for (const row of rows) {
      const line = document.createElement("div");
      line.className = "bakeoff-row";
      line.classList.toggle("is-smallest", row.size === smallest);

      const label = document.createElement("strong");
      label.textContent = row.lossy ? `${row.label} ${quality}%` : `${row.label} lossless`;
      const size = document.createElement("span");
      size.textContent = CL.formatBytes(row.size);
      if (row.size === smallest) {
        const badge = document.createElement("em");
        badge.textContent = "smallest";
        size.appendChild(badge);
      }
      const use = document.createElement("button");
      use.type = "button";
      use.textContent = "Use";
      use.disabled = CL.selectedCodecId() === row.id;
      use.addEventListener("click", () => {
        CL.setCodec(row.id);
        onSettingsChanged();
      });

      line.append(label, size, use);
      els.bakeoffResults.appendChild(line);
    }
    els.bakeoffResults.hidden = false;
  }

  // ── Session history ──────────────────────────────────────────────
  function makeThumb(source) {
    const size = 44;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const scale = Math.max(size / w, size / h);
    ctx.drawImage(
      source,
      (size - w * scale) / 2,
      (size - h * scale) / 2,
      w * scale,
      h * scale,
    );
    return canvas.toDataURL("image/png");
  }

  function addHistory(item) {
    const out = item.output;
    if (!out) return;
    const codec = CL.codecs[out.codecId];
    const settings = CL.settings.read();
    const variant =
      out.codecId === "png-palette"
        ? `${CL.paletteLevels[settings.palette - 1] ** 3} colors`
        : codec.lossy
          ? `${settings.quality}%`
          : "lossless";

    const key = `${item.id}:${out.codecId}`;
    CL.state.history = CL.state.history.filter((entry) => entry.key !== key);
    CL.state.history.unshift({
      key,
      thumb: makeThumb(CL.imageio.sourceOf(item)),
      label: `${codec.label} ${variant}`,
      detail: `${CL.formatBytes(item.file.size)} → ${CL.formatBytes(out.blob.size)}`,
      settings,
    });
    if (CL.state.history.length > 8) CL.state.history.length = 8;
    renderHistory();
  }

  function renderHistory() {
    els.historyPanel.classList.toggle("is-hidden", !CL.state.history.length);
    els.historyList.textContent = "";
    for (const entry of CL.state.history) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.title = "Re-apply these settings";

      const img = document.createElement("img");
      img.src = entry.thumb;
      img.alt = "";
      const text = document.createElement("span");
      const label = document.createElement("strong");
      label.textContent = entry.label;
      const detail = document.createElement("small");
      detail.textContent = entry.detail;
      text.append(label, detail);
      button.append(img, text);

      button.addEventListener("click", () => {
        CL.settings.apply(entry.settings);
        onSettingsChanged();
        CL.toast(`Applied ${entry.label} settings.`);
      });
      li.appendChild(button);
      els.historyList.appendChild(li);
    }
  }

  // ── Clipboard ────────────────────────────────────────────────────
  async function copyResult() {
    const out = CL.activeItem()?.output;
    if (!out) return;
    try {
      let blob = out.blob;
      let converted = false;
      if (blob.type !== "image/png") {
        const image = await CL.loadImage(out.url);
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        blob = await CL.canvasToBlob(canvas, "image/png");
        converted = true;
        if (!blob) throw new Error("PNG conversion failed");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      CL.toast(
        converted
          ? "Copied as PNG (clipboards do not accept every image format)."
          : "Copied to clipboard.",
      );
    } catch (error) {
      console.error(error);
      CL.toast("Copy failed — the browser blocked clipboard access.");
    }
  }

  // ── Reset ────────────────────────────────────────────────────────
  function resetApp() {
    for (const item of CL.state.items) {
      if (item.displayUrl && item.displayUrl !== item.sourceUrl) {
        URL.revokeObjectURL(item.displayUrl);
      }
      URL.revokeObjectURL(item.sourceUrl);
      if (item.output?.url) URL.revokeObjectURL(item.output.url);
    }
    CL.state.items = [];
    CL.state.activeId = null;
    clearTimeout(CL.state.debounce);
    CL.state.debounce = 0;

    CL.settings.apply(CL.settings.defaults);
    CL.settings.clear();
    CL.state.hasSavedSettings = false;
    els.fileInput.value = "";
    updatePresetButtons("");
    CL.batch.updateQueueUI();
    renderEmpty();
    syncControls();
  }

  // ── Hooks for the earlier-loaded modules ─────────────────────────
  CL.hooks.onActiveChanged = renderActiveItem;
  CL.hooks.onItemChanged = (item) => {
    if (item.id === CL.state.activeId) renderActiveOutput();
  };
  CL.hooks.onBusy = setBusy;
  CL.hooks.onTotals = updateHeaderStats;
  CL.hooks.addHistory = addHistory;
  CL.hooks.onPreviewModeChanged = updatePreviewButtons;
  CL.hooks.onCompressShown = startIdle;
  CL.hooks.onFilesAdded = (added) => {
    // Respect saved settings; only recommend a codec for users who have
    // never adjusted anything.
    if (!CL.state.hasSavedSettings && added.length) {
      CL.recommendCodec(added[0].file, added[0].hasAlpha);
      syncControls();
    }
  };

  // ── Event wiring ─────────────────────────────────────────────────
  els.fileInput.addEventListener("change", (event) => {
    CL.batch.addFiles(event.target.files);
    event.target.value = ""; // allow re-adding the same file later
  });

  // Counter instead of a bare class toggle: dragleave fires every time the
  // pointer crosses a child element of the dropzone.
  let dragDepth = 0;
  els.dropzone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    els.dropzone.classList.add("is-dragging");
  });
  els.dropzone.addEventListener("dragover", (event) => event.preventDefault());
  els.dropzone.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.dropzone.classList.remove("is-dragging");
  });
  els.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    els.dropzone.classList.remove("is-dragging");
    CL.batch.addFiles(event.dataTransfer.files);
  });

  document.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length) {
      event.preventDefault();
      // Pasted images go to whichever tool is open.
      if (CL.tools) CL.tools.routeFiles(files);
      else CL.batch.addFiles(files);
    }
  });

  els.editStrip.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-edit]");
    const item = CL.activeItem();
    if (!button || !item) return;
    const op = button.dataset.edit;
    if (op === "rotl") item.rotation += 270;
    if (op === "rotr") item.rotation += 90;
    if (op === "fliph") item.flipH = !item.flipH;
    if (op === "flipv") item.flipV = !item.flipV;
    await CL.imageio.bakeEdits(item);
    item.dirty = true;
    renderActiveItem();
    CL.batch.updateQueueUI();
    CL.batch.pump();
  });

  els.codecGrid.addEventListener("change", () => onSettingsChanged());
  els.qualityRange.addEventListener("input", () => onSettingsChanged());
  els.paletteRange.addEventListener("input", () => onSettingsChanged());
  els.targetInput.addEventListener("input", () => onSettingsChanged());
  els.passesRange.addEventListener("input", () => onSettingsChanged());
  els.ditherToggle.addEventListener("change", () => onSettingsChanged());
  els.matteInput.addEventListener("input", () => onSettingsChanged());
  els.resizeRange.addEventListener("input", () => onSettingsChanged());
  els.percentRange.addEventListener("input", () => onSettingsChanged());

  els.resizeModeSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    els.resizeGroup.dataset.mode = button.dataset.mode;
    onSettingsChanged();
  });

  function syncExact(changed) {
    const item = CL.activeItem();
    if (!els.aspectLock.checked || !item) return;
    const ratio = item.height / item.width;
    if (changed === "w" && Number(els.exactW.value) > 0) {
      els.exactH.value = Math.max(1, Math.round(Number(els.exactW.value) * ratio));
    }
    if (changed === "h" && Number(els.exactH.value) > 0) {
      els.exactW.value = Math.max(1, Math.round(Number(els.exactH.value) / ratio));
    }
  }
  els.exactW.addEventListener("input", () => {
    syncExact("w");
    onSettingsChanged();
  });
  els.exactH.addEventListener("input", () => {
    syncExact("h");
    onSettingsChanged();
  });
  els.aspectLock.addEventListener("change", () => {
    syncExact("w");
    onSettingsChanged();
  });

  els.showAllSettingsToggle.addEventListener("change", () => {
    els.controlStack.classList.toggle("hide-inactive", !els.showAllSettingsToggle.checked);
    CL.settings.save();
  });

  document.querySelectorAll(".preset-button").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  els.bakeoffButton.addEventListener("click", runBakeoff);

  els.compressButton.addEventListener("click", () => {
    CL.batch.markActiveDirty();
    CL.batch.pump();
  });
  els.resetButton.addEventListener("click", resetApp);
  els.copyButton.addEventListener("click", copyResult);

  els.previewToggle.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button || button.disabled) return;
    CL.compare.setMode(button.dataset.view);
    updatePreviewButtons();
  });

  els.zoomBar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-zoom]");
    if (!button || button.disabled) return;
    if (button.dataset.zoom === "in") CL.compare.zoomBy(1.4);
    if (button.dataset.zoom === "out") CL.compare.zoomBy(1 / 1.4);
    if (button.dataset.zoom === "reset") CL.compare.resetZoom();
  });

  els.loupeToggle.addEventListener("click", () => {
    CL.compare.setLoupe(!CL.compare.isLoupeOn());
  });

  window.addEventListener("beforeunload", () => {
    for (const item of CL.state.items) {
      if (item.displayUrl && item.displayUrl !== item.sourceUrl) {
        URL.revokeObjectURL(item.displayUrl);
      }
      URL.revokeObjectURL(item.sourceUrl);
      if (item.output?.url) URL.revokeObjectURL(item.output.url);
    }
  });

  // ── Theme management ─────────────────────────────────────────────
  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    syncThemeColor();
    try {
      localStorage.setItem("cl-theme", theme);
    } catch {
      /* storage blocked (private mode): the choice lasts for this visit */
    }
  }

  // The browser/phone status bar colour follows the in-app theme, not just
  // the OS setting.
  function syncThemeColor() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", dark ? "#0d1412" : "#f5f8f6");
    });
  }
  syncThemeColor();

  function storedTheme() {
    try {
      return localStorage.getItem("cl-theme");
    } catch {
      return null;
    }
  }

  els.darkToggle.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    applyTheme(isDark ? "light" : "dark");
  });

  // Sync if OS-level preference changes and user has not made an explicit choice.
  const schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  function onSchemeChange(event) {
    if (storedTheme()) return;
    if (event.matches) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    syncThemeColor();
  }
  if (schemeQuery.addEventListener) {
    schemeQuery.addEventListener("change", onSchemeChange);
  } else if (schemeQuery.addListener) {
    // Safari < 14 only exposes the deprecated addListener.
    schemeQuery.addListener(onSchemeChange);
  }

  // Expose each info tooltip's text to assistive tech (it is otherwise drawn
  // purely with a CSS ::after, so screen readers would announce an empty element).
  document.querySelectorAll(".info-dot[data-tip]").forEach((dot) => {
    dot.setAttribute("role", "img");
    if (!dot.hasAttribute("aria-label")) {
      dot.setAttribute("aria-label", dot.dataset.tip);
    }
  });

  // Open each tooltip away from the nearest screen edge so it stays readable.
  function alignTip(event) {
    const dot = event.target.closest?.(".info-dot[data-tip]");
    if (!dot) return;
    const rect = dot.getBoundingClientRect();
    const room = Math.min(270, window.innerWidth - 44) / 2;
    if (rect.left + rect.width / 2 + room > window.innerWidth - 8) dot.dataset.tipAlign = "end";
    else if (rect.left + rect.width / 2 - room < 8) dot.dataset.tipAlign = "start";
    else delete dot.dataset.tipAlign;
  }
  document.addEventListener("pointerover", alignTip);
  document.addEventListener("focusin", alignTip);

  // ── Boot ─────────────────────────────────────────────────────────
  if (!navigator.clipboard || !window.ClipboardItem) {
    els.copyButton.hidden = true;
  }

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    // The cache-first worker serves the old version once after an update;
    // when the new one takes over, say so instead of silently staying stale.
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) CL.toast("Compress Lab was updated. Reload the page to get the new version.", 9000);
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        /* offline support is a bonus, never an error */
      });
    });
  }

  const saved = CL.settings.load();
  CL.state.hasSavedSettings = Boolean(saved);
  CL.settings.apply(saved || CL.settings.defaults);
  CL.compare.init();
  CL.batch.init();
  renderEmpty();
  syncControls();
  CL.detectSupport().then(syncControls);
})(window.CL = window.CL || {});
