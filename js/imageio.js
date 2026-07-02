// Image ingest (files, drops, pastes), validation, rotate/flip baking, the
// resize pipeline, and encoding (including the target-size search).
(function (CL) {
  "use strict";

  // Canvases above ~64MP fail silently in several browsers (toBlob → null),
  // so oversized sources are downscaled to a safe working size up front.
  const MAX_PIXELS = 64_000_000;
  const SAFE_PIXELS = 24_000_000;

  function scanAlpha(source, sourceWidth, sourceHeight) {
    const width = Math.min(sourceWidth, 220);
    const height = Math.min(sourceHeight, 220);
    const sample = document.createElement("canvas");
    sample.width = width;
    sample.height = height;
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  }

  async function createItem(file) {
    const sourceUrl = URL.createObjectURL(file);
    let image;
    try {
      image = await CL.loadImage(sourceUrl);
    } catch (error) {
      URL.revokeObjectURL(sourceUrl);
      throw error;
    }

    // A dimensionless source (commonly an SVG with no width/height) decodes to
    // a 0x0 image, which would produce an empty canvas and a failed encode.
    if (!image.naturalWidth || !image.naturalHeight) {
      URL.revokeObjectURL(sourceUrl);
      throw new Error(
        "That image has no fixed pixel size (often a dimensionless SVG). Try a raster image, or an SVG that has width and height.",
      );
    }

    let source = image;
    let width = image.naturalWidth;
    let height = image.naturalHeight;
    let downscaled = false;
    if (width * height > MAX_PIXELS) {
      const scale = Math.sqrt(SAFE_PIXELS / (width * height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      source = canvas;
      width = canvas.width;
      height = canvas.height;
      downscaled = true;
    }

    return {
      id: CL.uid(),
      file,
      sourceUrl,
      image: source,
      width,
      height,
      hasAlpha: scanAlpha(source, width, height),
      rotation: 0,
      flipH: false,
      flipV: false,
      edited: null,
      displayUrl: sourceUrl,
      status: "queued",
      dirty: true,
      output: null,
      error: "",
      downscaled,
      isGif: file.type === "image/gif",
    };
  }

  function sourceOf(item) {
    return item.edited || item.image;
  }

  function baseDims(item) {
    const width = item.image.naturalWidth || item.image.width;
    const height = item.image.naturalHeight || item.image.height;
    return { width, height };
  }

  function setDisplayUrl(item, url) {
    if (item.displayUrl && item.displayUrl !== item.sourceUrl) {
      URL.revokeObjectURL(item.displayUrl);
    }
    item.displayUrl = url;
  }

  // Bake rotation/flips into a canvas that becomes the encode source and the
  // preview. With no edits the original image is used directly.
  async function bakeEdits(item) {
    const { width, height } = baseDims(item);
    const rotation = ((item.rotation % 360) + 360) % 360;
    item.rotation = rotation;

    if (!rotation && !item.flipH && !item.flipV) {
      item.edited = null;
      item.width = width;
      item.height = height;
      setDisplayUrl(item, item.sourceUrl);
      return;
    }

    const swapped = rotation === 90 || rotation === 270;
    const canvas = document.createElement("canvas");
    canvas.width = swapped ? height : width;
    canvas.height = swapped ? width : height;
    const ctx = canvas.getContext("2d");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
    ctx.drawImage(item.image, -width / 2, -height / 2);

    item.edited = canvas;
    item.width = canvas.width;
    item.height = canvas.height;

    // The preview <img> needs a URL; WebP keeps this quick, PNG is the
    // lossless fallback for browsers that cannot encode WebP.
    const mime = CL.state.supported.webp ? "image/webp" : "image/png";
    const blob =
      (await CL.canvasToBlob(canvas, mime, 0.92)) ||
      (await CL.canvasToBlob(canvas, "image/png"));
    if (blob) setDisplayUrl(item, URL.createObjectURL(blob));
  }

  // Output dimensions for the current resize settings. Never upscales;
  // `capped` reports that an exact request exceeded the source.
  function targetDims(item, settings = CL.settings.read()) {
    const width = item.width;
    const height = item.height;

    if (settings.resizeMode === "exact") {
      let tw = Math.floor(Number(settings.exactW)) || 0;
      let th = Math.floor(Number(settings.exactH)) || 0;
      if (!tw && !th) return { width, height, capped: false };
      if (tw && !th) th = Math.max(1, Math.round((tw * height) / width));
      if (th && !tw) tw = Math.max(1, Math.round((th * width) / height));
      const fit = Math.min(width / tw, height / th, 1);
      return {
        width: Math.max(1, Math.round(tw * fit)),
        height: Math.max(1, Math.round(th * fit)),
        capped: fit < 1,
      };
    }

    if (settings.resizeMode === "percent") {
      const factor = CL.clamp(Number(settings.percent) || 100, 1, 100) / 100;
      return {
        width: Math.max(1, Math.round(width * factor)),
        height: Math.max(1, Math.round(height * factor)),
        capped: false,
      };
    }

    const maxEdge = Number(settings.maxEdge);
    if (!maxEdge || Math.max(width, height) <= maxEdge) {
      return { width, height, capped: false };
    }
    const ratio = maxEdge / Math.max(width, height);
    return {
      width: Math.max(1, Math.round(width * ratio)),
      height: Math.max(1, Math.round(height * ratio)),
      capped: false,
    };
  }

  // Resized, matte-filled (for alpha-less codecs) canvas ready to encode.
  function buildCanvas(item, codec, settings = CL.settings.read()) {
    const { width, height } = targetDims(item, settings);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (!codec.alpha) {
      ctx.fillStyle = settings.matte;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(sourceOf(item), 0, 0, width, height);
    return canvas;
  }

  async function quantizeCanvas(canvas, levels, dither) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = await CL.runJob(
      "quantize",
      {
        buffer: imageData.data.buffer,
        width: canvas.width,
        height: canvas.height,
        levels,
        dither,
      },
      [imageData.data.buffer],
    );
    ctx.putImageData(new ImageData(result, canvas.width, canvas.height), 0, 0);
  }

  async function findTargetBlob(canvas, mime, targetBytes, passes) {
    let low = 0.04;
    let high = 0.98;
    let best = null;
    let bestQuality = low;

    for (let i = 0; i < passes; i += 1) {
      const quality = (low + high) / 2;
      const blob = await CL.canvasToBlob(canvas, mime, quality);
      if (!blob) break;
      if (blob.size <= targetBytes) {
        best = blob;
        bestQuality = quality;
        low = quality;
        // Close enough: extra passes would re-encode for invisible gains.
        if (blob.size >= targetBytes * 0.98) break;
      } else {
        high = quality;
      }
    }

    if (!best) {
      best = await CL.canvasToBlob(canvas, mime, low);
      bestQuality = low;
    }

    return { blob: best, quality: bestQuality };
  }

  async function encode(canvas, codec, settings = CL.settings.read()) {
    const targetKB = Number(settings.targetKB);
    let blob;
    let note = "";

    if (codec.targetable && targetKB > 0) {
      const result = await findTargetBlob(canvas, codec.mime, targetKB * 1024, settings.passes);
      blob = result.blob;
      note = ` at ${Math.round(result.quality * 100)}% quality`;
    } else {
      blob = await CL.canvasToBlob(
        canvas,
        codec.mime,
        codec.lossy ? settings.quality / 100 : undefined,
      );
      if (codec.lossy && codec.mime !== "image/png") {
        note = ` at ${Math.round(settings.quality)}% quality`;
      }
    }

    if (!blob) {
      throw new Error("The browser did not return an encoded image.");
    }
    if (codec.mime !== "image/png" && blob.type !== codec.mime) {
      throw new Error(`${codec.label} encoding is not supported here.`);
    }
    return { blob, note };
  }

  // Compare the pre-encode reference against the decoded output, downsampled
  // to at most ~2MP so metrics stay fast; the math runs in the worker.
  async function metricsFor(referenceCanvas, outputUrl) {
    const maxPixels = 2_000_000;
    const scale = Math.min(
      1,
      Math.sqrt(maxPixels / (referenceCanvas.width * referenceCanvas.height)),
    );
    const width = Math.max(1, Math.round(referenceCanvas.width * scale));
    const height = Math.max(1, Math.round(referenceCanvas.height * scale));

    const refCanvas = document.createElement("canvas");
    const outCanvas = document.createElement("canvas");
    refCanvas.width = outCanvas.width = width;
    refCanvas.height = outCanvas.height = height;

    const refCtx = refCanvas.getContext("2d", { willReadFrequently: true });
    const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });
    refCtx.imageSmoothingEnabled = outCtx.imageSmoothingEnabled = true;
    refCtx.imageSmoothingQuality = outCtx.imageSmoothingQuality = "high";
    refCtx.drawImage(referenceCanvas, 0, 0, width, height);

    const outputImage = await CL.loadImage(outputUrl);
    outCtx.drawImage(outputImage, 0, 0, width, height);

    const ref = refCtx.getImageData(0, 0, width, height);
    const out = outCtx.getImageData(0, 0, width, height);
    return CL.runJob(
      "metrics",
      { ref: ref.data.buffer, out: out.data.buffer, width, height },
      [ref.data.buffer, out.data.buffer],
    );
  }

  CL.imageio = {
    createItem,
    bakeEdits,
    sourceOf,
    targetDims,
    buildCanvas,
    quantizeCanvas,
    encode,
    metricsFor,
  };
})(window.CL = window.CL || {});
