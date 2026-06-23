const codecs = {
  webp: {
    label: "WebP",
    mime: "image/webp",
    ext: "webp",
    lossy: true,
    alpha: true,
    targetable: true,
  },
  jpeg: {
    label: "JPEG",
    mime: "image/jpeg",
    ext: "jpg",
    lossy: true,
    alpha: false,
    targetable: true,
  },
  png: {
    label: "PNG",
    mime: "image/png",
    ext: "png",
    lossy: false,
    alpha: true,
    targetable: false,
  },
  "png-palette": {
    label: "PNG palette",
    mime: "image/png",
    ext: "png",
    lossy: true,
    alpha: true,
    targetable: false,
  },
  avif: {
    label: "AVIF",
    mime: "image/avif",
    ext: "avif",
    lossy: true,
    alpha: true,
    targetable: true,
  },
};

const paletteSteps = [2, 4, 8, 16, 32, 64, 128, 256];

const state = {
  file: null,
  sourceUrl: "",
  outputUrl: "",
  image: null,
  hasAlpha: false,
  supported: {},
  previewMode: "compare",
  busy: false,
  debounce: 0,
};

const els = {
  fileInput: document.querySelector("#fileInput"),
  dropzone: document.querySelector("#dropzone"),
  idleCanvas: document.querySelector("#idleCanvas"),
  sourceThumb: document.querySelector("#sourceThumb"),
  sourceMeta: document.querySelector("#sourceMeta"),
  sourceSize: document.querySelector("#sourceSize"),
  sourceDimensions: document.querySelector("#sourceDimensions"),
  sourceType: document.querySelector("#sourceType"),
  sourceAlpha: document.querySelector("#sourceAlpha"),
  headerFormat: document.querySelector("#headerFormat"),
  headerSaving: document.querySelector("#headerSaving"),
  supportPill: document.querySelector("#supportPill"),
  settingsSummary: document.querySelector("#settingsSummary"),
  showAllSettingsToggle: document.querySelector("#showAllSettingsToggle"),
  controlStack: document.querySelector("#controlStack"),
  codecGrid: document.querySelector("#codecGrid"),
  qualityRange: document.querySelector("#qualityRange"),
  qualityValue: document.querySelector("#qualityValue"),
  paletteRange: document.querySelector("#paletteRange"),
  paletteValue: document.querySelector("#paletteValue"),
  resizeRange: document.querySelector("#resizeRange"),
  resizeValue: document.querySelector("#resizeValue"),
  targetInput: document.querySelector("#targetInput"),
  passesRange: document.querySelector("#passesRange"),
  passesValue: document.querySelector("#passesValue"),
  ditherToggle: document.querySelector("#ditherToggle"),
  matteInput: document.querySelector("#matteInput"),
  compressButton: document.querySelector("#compressButton"),
  resetButton: document.querySelector("#resetButton"),
  previewToggle: document.querySelector("#previewToggle"),
  compareBox: document.querySelector("#compareBox"),
  compareSlider: document.querySelector("#compareSlider"),
  beforeImage: document.querySelector("#beforeImage"),
  afterImage: document.querySelector("#afterImage"),
  emptyResult: document.querySelector("#emptyResult"),
  resultStatus: document.querySelector("#resultStatus"),
  outputSize: document.querySelector("#outputSize"),
  savedPercent: document.querySelector("#savedPercent"),
  outputDimensions: document.querySelector("#outputDimensions"),
  pixelDelta: document.querySelector("#pixelDelta"),
  downloadButton: document.querySelector("#downloadButton"),
  toast: document.querySelector("#toast"),
};

function selectedCodecId() {
  return document.querySelector('input[name="codec"]:checked')?.value || "webp";
}

function selectedCodec() {
  return codecs[selectedCodecId()];
}

function formatBytes(bytes) {
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
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2800);
}

function setBusy(isBusy) {
  state.busy = isBusy;
  document.body.classList.toggle("is-busy", isBusy);
  els.compressButton.disabled = !state.image || isBusy;
  els.compressButton.textContent = isBusy ? "Compressing..." : "Compress image";
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The browser could not decode that image."));
    img.src = src;
  });
}

async function supportsMime(mime) {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const blob = await canvasToBlob(canvas, mime, 0.8);
  return Boolean(blob && blob.type === mime);
}

async function checkCodecSupport() {
  state.supported.png = true;
  state.supported.jpeg = await supportsMime(codecs.jpeg.mime);
  state.supported.webp = await supportsMime(codecs.webp.mime);
  state.supported.avif = await supportsMime(codecs.avif.mime);
  state.supported["png-palette"] = true;

  Object.entries(state.supported).forEach(([id, supported]) => {
    const card = document.querySelector(`.codec-card input[value="${id}"]`)?.closest(".codec-card");
    const input = document.querySelector(`.codec-card input[value="${id}"]`);
    const description = card?.querySelector("small");
    if (!card || !input) return;
    card.classList.toggle("is-disabled", !supported);
    input.disabled = !supported;
    if (description) {
      description.textContent = supported
        ? {
            webp: "Modern default",
            jpeg: "Most compatible photo format",
            png: "Lossless, exact pixels",
            "png-palette": "Fewer colors, smaller PNG",
            avif: "Efficient, browser-dependent",
          }[id]
        : "Not available in this browser";
    }
  });

  if (!state.supported.webp) {
    document.querySelector('input[value="jpeg"]').checked = true;
  }

  const count = Object.values(state.supported).filter(Boolean).length;
  els.supportPill.textContent = `${count} formats available`;
  els.supportPill.title =
    "Grey formats are not broken. This browser just cannot create that output format from a web page.";
  syncControls();
}

function drawIdleCanvas() {
  const canvas = els.idleCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#edf3ef";
  ctx.fillRect(0, 0, width, height);

  const now = performance.now() / 900;
  const cell = 18;
  for (let y = -cell; y < height + cell; y += cell) {
    for (let x = -cell; x < width + cell; x += cell) {
      const wave = Math.sin(x * 0.026 + y * 0.018 + now);
      const packed = Math.max(4, Math.round(cell - (wave + 1) * 5));
      ctx.fillStyle = wave > 0.45 ? "#0f766e" : wave < -0.45 ? "#db5a4f" : "#ffffff";
      ctx.globalAlpha = wave > 0.45 || wave < -0.45 ? 0.18 : 0.78;
      ctx.fillRect(x + (cell - packed) / 2, y + (cell - packed) / 2, packed, packed);
    }
  }

  ctx.globalAlpha = 1;
  requestAnimationFrame(drawIdleCanvas);
}

function getTargetDimensions() {
  const maxEdge = Number(els.resizeRange.value);
  const width = state.image.naturalWidth;
  const height = state.image.naturalHeight;
  if (!maxEdge || Math.max(width, height) <= maxEdge) {
    return { width, height };
  }
  const ratio = maxEdge / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function makeCanvas({ quantize = false } = {}) {
  const codec = selectedCodec();
  const { width, height } = getTargetDimensions();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: quantize });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (!codec.alpha) {
    ctx.fillStyle = els.matteInput.value;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(state.image, 0, 0, width, height);

  if (quantize) {
    quantizeCanvas(canvas, paletteSteps[Number(els.paletteRange.value) - 1], els.ditherToggle.checked);
  }

  return canvas;
}

function quantizeValue(value, levels) {
  if (levels <= 1) return 0;
  const step = 255 / (levels - 1);
  return Math.max(0, Math.min(255, Math.round(Math.round(value / step) * step)));
}

function distributeError(buffer, index, error, factor) {
  buffer[index] += error[0] * factor;
  buffer[index + 1] += error[1] * factor;
  buffer[index + 2] += error[2] * factor;
}

function quantizeCanvas(canvas, colorCount, shouldDither) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const levels = Math.max(2, Math.round(Math.cbrt(colorCount)));
  const pixelCount = canvas.width * canvas.height;
  const useDither = shouldDither && pixelCount <= 3000000;

  if (!useDither) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
        continue;
      }
      data[i] = quantizeValue(data[i], levels);
      data[i + 1] = quantizeValue(data[i + 1], levels);
      data[i + 2] = quantizeValue(data[i + 2], levels);
    }
    ctx.putImageData(imageData, 0, 0);
    if (shouldDither && pixelCount > 3000000) {
      showToast("Dithering was skipped for this large image.");
    }
    return;
  }

  const buffer = Float32Array.from(data);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const i = (y * canvas.width + x) * 4;
      if (buffer[i + 3] < 16) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
        continue;
      }

      const old = [buffer[i], buffer[i + 1], buffer[i + 2]];
      const next = [
        quantizeValue(old[0], levels),
        quantizeValue(old[1], levels),
        quantizeValue(old[2], levels),
      ];
      data[i] = next[0];
      data[i + 1] = next[1];
      data[i + 2] = next[2];

      const err = [old[0] - next[0], old[1] - next[1], old[2] - next[2]];
      if (x + 1 < canvas.width) distributeError(buffer, i + 4, err, 7 / 16);
      if (x > 0 && y + 1 < canvas.height) {
        distributeError(buffer, i + (canvas.width - 1) * 4, err, 3 / 16);
      }
      if (y + 1 < canvas.height) distributeError(buffer, i + canvas.width * 4, err, 5 / 16);
      if (x + 1 < canvas.width && y + 1 < canvas.height) {
        distributeError(buffer, i + (canvas.width + 1) * 4, err, 1 / 16);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

async function findTargetBlob(canvas, mime, targetBytes, passes) {
  let low = 0.04;
  let high = 0.98;
  let best = null;
  let bestQuality = low;

  for (let i = 0; i < passes; i += 1) {
    const quality = (low + high) / 2;
    const blob = await canvasToBlob(canvas, mime, quality);
    if (!blob) break;
    if (blob.size <= targetBytes) {
      best = blob;
      bestQuality = quality;
      low = quality;
    } else {
      high = quality;
    }
  }

  if (!best) {
    best = await canvasToBlob(canvas, mime, low);
    bestQuality = low;
  }

  return { blob: best, quality: bestQuality };
}

async function estimatePixelDelta(referenceCanvas, outputUrl) {
  const maxPixels = 2000000;
  const scale = Math.min(1, Math.sqrt(maxPixels / (referenceCanvas.width * referenceCanvas.height)));
  const width = Math.max(1, Math.round(referenceCanvas.width * scale));
  const height = Math.max(1, Math.round(referenceCanvas.height * scale));
  const refCanvas = document.createElement("canvas");
  const outCanvas = document.createElement("canvas");
  refCanvas.width = outCanvas.width = width;
  refCanvas.height = outCanvas.height = height;

  const refCtx = refCanvas.getContext("2d", { willReadFrequently: true });
  const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });
  refCtx.imageSmoothingEnabled = true;
  refCtx.imageSmoothingQuality = "high";
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  refCtx.drawImage(referenceCanvas, 0, 0, width, height);

  const outputImage = await loadImage(outputUrl);
  outCtx.drawImage(outputImage, 0, 0, width, height);

  const ref = refCtx.getImageData(0, 0, width, height).data;
  const out = outCtx.getImageData(0, 0, width, height).data;
  let total = 0;
  for (let i = 0; i < ref.length; i += 4) {
    total += Math.abs(ref[i] - out[i]);
    total += Math.abs(ref[i + 1] - out[i + 1]);
    total += Math.abs(ref[i + 2] - out[i + 2]);
  }
  const mean = total / ((ref.length / 4) * 3);
  return (mean / 255) * 100;
}

function outputName(codec) {
  const base = state.file.name.replace(/\.[^.]+$/, "") || "compressed";
  const suffix = codec.lossy ? "compressed" : "lossless";
  return `${base}-${suffix}.${codec.ext}`;
}

async function compressImage() {
  if (!state.image || state.busy) return;

  const codec = selectedCodec();
  if (!state.supported[selectedCodecId()]) {
    showToast(`${codec.label} encoding is not available in this browser.`);
    return;
  }

  setBusy(true);

  try {
    const needsPalette = selectedCodecId() === "png-palette";
    const canvas = makeCanvas({ quantize: needsPalette });
    const referenceCanvas = makeCanvas({ quantize: false });
    const targetKB = Number(els.targetInput.value);
    const quality = Number(els.qualityRange.value) / 100;
    const passes = Number(els.passesRange.value);
    let blob;
    let qualityNote = "";

    if (codec.targetable && targetKB > 0) {
      const result = await findTargetBlob(canvas, codec.mime, targetKB * 1024, passes);
      blob = result.blob;
      qualityNote = ` at ${Math.round(result.quality * 100)}% quality`;
    } else {
      blob = await canvasToBlob(canvas, codec.mime, codec.lossy ? quality : undefined);
      if (codec.lossy && codec.mime !== "image/png") {
        qualityNote = ` at ${Math.round(quality * 100)}% quality`;
      }
    }

    if (!blob) {
      throw new Error("The browser did not return an encoded image.");
    }

    if (codec.mime !== "image/png" && blob.type !== codec.mime) {
      throw new Error(`${codec.label} encoding is not supported here.`);
    }

    if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
    state.outputUrl = URL.createObjectURL(blob);
    els.beforeImage.src = state.sourceUrl;
    els.afterImage.src = state.outputUrl;
    els.downloadButton.href = state.outputUrl;
    els.downloadButton.download = outputName(codec);
    els.downloadButton.classList.remove("is-disabled");
    els.compareBox.classList.add("has-output");
    updatePreviewButtons();

    const dims = `${canvas.width} x ${canvas.height}`;
    const saved = 1 - blob.size / state.file.size;
    const savedLabel =
      saved >= 0 ? `${Math.round(saved * 100)}%` : `${Math.round(Math.abs(saved) * 100)}% larger`;
    const pixelDelta = await estimatePixelDelta(referenceCanvas, state.outputUrl);

    els.outputSize.textContent = formatBytes(blob.size);
    els.savedPercent.textContent = savedLabel;
    els.outputDimensions.textContent = dims;
    els.pixelDelta.textContent = codec.lossy ? `${pixelDelta.toFixed(2)}%` : `${pixelDelta.toFixed(3)}%`;
    els.headerFormat.textContent = `${codec.label} ${dims}`;
    els.headerSaving.textContent = savedLabel;

    const targetNote = codec.targetable && targetKB > 0 ? `, target ${targetKB} KB` : "";
    els.resultStatus.textContent = `${codec.label}${qualityNote}${targetNote}. ${formatBytes(
      state.file.size,
    )} became ${formatBytes(blob.size)}.`;
  } catch (error) {
    console.error(error);
    showToast(error.message || "Compression failed.");
    els.resultStatus.textContent = "Compression failed. Try another format or smaller image.";
  } finally {
    setBusy(false);
  }
}

function scanAlpha(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const width = Math.min(canvas.width, 220);
  const height = Math.min(canvas.height, 220);
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = width;
  sampleCanvas.height = height;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  sampleCtx.drawImage(canvas, 0, 0, width, height);
  const data = sampleCtx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("Please choose an image file.");
    return;
  }

  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);

  state.file = file;
  state.sourceUrl = URL.createObjectURL(file);
  state.outputUrl = "";

  try {
    state.image = await loadImage(state.sourceUrl);
  } catch (error) {
    showToast(error.message);
    return;
  }

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = state.image.naturalWidth;
  sourceCanvas.height = state.image.naturalHeight;
  sourceCanvas.getContext("2d").drawImage(state.image, 0, 0);
  state.hasAlpha = scanAlpha(sourceCanvas);

  els.beforeImage.src = state.sourceUrl;
  els.sourceThumb.src = state.sourceUrl;
  els.dropzone.classList.add("has-image");
  document.querySelector(".drop-title").textContent = "Replace image";
  document.querySelector(".drop-subtitle").textContent = file.name;
  els.afterImage.removeAttribute("src");
  els.compareBox.classList.remove("has-output");
  state.previewMode = "compare";
  syncCompareSlider();
  updatePreviewButtons();
  els.sourceMeta.classList.remove("is-hidden");
  els.sourceSize.textContent = formatBytes(file.size);
  els.sourceDimensions.textContent = `${state.image.naturalWidth} x ${state.image.naturalHeight}`;
  els.sourceType.textContent = file.type.replace("image/", "").toUpperCase() || "Image";
  els.sourceAlpha.textContent = state.hasAlpha ? "Yes" : "No";
  els.headerFormat.textContent = `${state.image.naturalWidth} x ${state.image.naturalHeight}`;
  els.headerSaving.textContent = "Loaded";
  els.resultStatus.textContent = "Ready to compress.";
  els.downloadButton.classList.add("is-disabled");
  els.downloadButton.removeAttribute("href");
  els.resetButton.disabled = false;
  els.compressButton.disabled = false;
  els.outputSize.textContent = "-";
  els.savedPercent.textContent = "-";
  els.outputDimensions.textContent = "-";
  els.pixelDelta.textContent = "-";

  recommendCodec(file);
  syncControls();
  await compressImage();
}

function recommendCodec(file) {
  if (state.supported.webp) {
    document.querySelector('input[value="webp"]').checked = true;
    els.qualityRange.value = 82;
    return;
  }
  if (state.hasAlpha) {
    document.querySelector('input[value="png"]').checked = true;
    return;
  }
  document.querySelector('input[value="jpeg"]').checked = true;
}

function syncCompareSlider() {
  const value = Number(els.compareSlider.value);
  if (state.previewMode === "compressed") {
    els.afterImage.style.clipPath = "inset(0 0 0 0)";
  } else if (state.previewMode === "original") {
    els.afterImage.style.clipPath = "inset(0 100% 0 0)";
  } else {
    els.afterImage.style.clipPath = `inset(0 0 0 ${value}%)`;
  }
}

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

function updatePreviewButtons() {
  els.previewToggle.querySelectorAll("button").forEach((button) => {
    button.disabled = !state.outputUrl;
    button.classList.toggle("is-active", button.dataset.view === state.previewMode);
  });
}

function syncControls() {
  const codecId = selectedCodecId();
  const codec = selectedCodec();
  const isPalette = codecId === "png-palette";
  const usesQuality = codec.lossy && !isPalette;
  const usesTarget = codec.targetable;
  const usesMatte = codecId === "jpeg";

  setControlAvailability("quality", usesQuality, `Not used by ${codec.label}.`);
  setControlAvailability("palette", isPalette, `Only used by PNG palette.`);
  setControlAvailability("dither", isPalette, `Only used by PNG palette.`);
  setControlAvailability("target", usesTarget, `Target size works with WebP, JPEG, and AVIF.`);
  setControlAvailability(
    "passes",
    usesTarget && Number(els.targetInput.value) > 0,
    usesTarget ? "Fill target size to use this." : "Target search is not used by this format.",
  );
  setControlAvailability("matte", usesMatte, `Only used by JPEG.`);

  const summaries = {
    webp: "WebP: best default for small files, photos, and transparency.",
    jpeg: "JPEG: most compatible for photos, but no transparency.",
    png: "PNG: exact pixels for screenshots, logos, and sharp graphics.",
    "png-palette": "PNG palette: fewer colors for smaller simple graphics.",
    avif: "AVIF: efficient, but web-page encoding support is limited.",
  };
  els.settingsSummary.textContent = summaries[codecId];

  els.qualityValue.value = `${els.qualityRange.value}%`;
  els.paletteValue.value = String(paletteSteps[Number(els.paletteRange.value) - 1]);
  els.passesValue.value = els.passesRange.value;
  const maxEdge = Number(els.resizeRange.value);
  els.resizeValue.value = maxEdge ? `${maxEdge}px` : "Original";
  updatePreviewButtons();
}

function scheduleCompression() {
  syncControls();
  if (!state.image) return;
  clearTimeout(state.debounce);
  state.debounce = setTimeout(() => compressImage(), 380);
}

function updatePresetButtons(activeName = "") {
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === activeName);
  });
}

function scheduleCustomCompression() {
  updatePresetButtons();
  scheduleCompression();
}

function applyPreset(name) {
  const input = (value) => document.querySelector(`input[value="${value}"]`);
  updatePresetButtons(name);

  if (name === "photo") {
    input(state.supported.webp ? "webp" : "jpeg").checked = true;
    els.qualityRange.value = 82;
    els.resizeRange.value = 0;
    els.targetInput.value = "";
  }

  if (name === "tiny") {
    input(state.supported.webp ? "webp" : "jpeg").checked = true;
    els.qualityRange.value = 56;
    els.resizeRange.value = 1600;
    els.targetInput.value = "";
  }

  if (name === "transparent") {
    input(state.supported.webp ? "webp" : "png-palette").checked = true;
    els.qualityRange.value = 86;
    els.paletteRange.value = 7;
    els.resizeRange.value = 0;
    els.targetInput.value = "";
  }

  if (name === "compat") {
    input("jpeg").checked = true;
    els.qualityRange.value = 84;
    els.resizeRange.value = 0;
    els.targetInput.value = "";
  }

  scheduleCompression();
}

function resetApp() {
  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
  state.file = null;
  state.sourceUrl = "";
  state.outputUrl = "";
  state.image = null;
  state.hasAlpha = false;
  els.fileInput.value = "";
  els.sourceMeta.classList.add("is-hidden");
  els.compareBox.classList.remove("has-output");
  els.beforeImage.removeAttribute("src");
  els.afterImage.removeAttribute("src");
  els.sourceThumb.removeAttribute("src");
  els.dropzone.classList.remove("has-image");
  document.querySelector(".drop-title").textContent = "Drop an image here";
  document.querySelector(".drop-subtitle").textContent =
    "PNG, JPEG, WebP, AVIF, GIF, or SVG if your browser can decode it";
  els.downloadButton.classList.add("is-disabled");
  els.downloadButton.removeAttribute("href");
  els.compressButton.disabled = true;
  els.resetButton.disabled = true;
  state.previewMode = "compare";
  syncCompareSlider();
  updatePreviewButtons();
  els.headerFormat.textContent = "No image loaded";
  els.headerSaving.textContent = "Ready";
  els.resultStatus.textContent = "Choose an image to begin.";
  els.outputSize.textContent = "-";
  els.savedPercent.textContent = "-";
  els.outputDimensions.textContent = "-";
  els.pixelDelta.textContent = "-";
  updatePresetButtons();
}

els.fileInput.addEventListener("change", (event) => {
  handleFile(event.target.files?.[0]);
});

["dragenter", "dragover"].forEach((name) => {
  els.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((name) => {
  els.dropzone.addEventListener(name, () => els.dropzone.classList.remove("is-dragging"));
});

els.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  handleFile(event.dataTransfer.files?.[0]);
});

els.codecGrid.addEventListener("change", scheduleCustomCompression);
els.qualityRange.addEventListener("input", scheduleCustomCompression);
els.paletteRange.addEventListener("input", scheduleCustomCompression);
els.resizeRange.addEventListener("input", scheduleCustomCompression);
els.targetInput.addEventListener("input", scheduleCustomCompression);
els.passesRange.addEventListener("input", scheduleCustomCompression);
els.ditherToggle.addEventListener("change", scheduleCustomCompression);
els.matteInput.addEventListener("input", scheduleCustomCompression);
els.showAllSettingsToggle.addEventListener("change", () => {
  els.controlStack.classList.toggle("hide-inactive", !els.showAllSettingsToggle.checked);
});
els.compressButton.addEventListener("click", compressImage);
els.resetButton.addEventListener("click", resetApp);
els.compareSlider.addEventListener("input", () => {
  state.previewMode = "compare";
  syncCompareSlider();
  updatePreviewButtons();
});

document.querySelectorAll(".preset-button").forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
});

els.previewToggle.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button || button.disabled) return;
  state.previewMode = button.dataset.view;
  syncCompareSlider();
  updatePreviewButtons();
});

window.addEventListener("beforeunload", () => {
  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
});

syncCompareSlider();
syncControls();
checkCodecSupport();
requestAnimationFrame(drawIdleCanvas);
