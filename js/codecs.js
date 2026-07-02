// Codec table, selection helpers, browser support detection, and the
// per-file codec recommendation.
(function (CL) {
  "use strict";

  CL.codecs = {
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

  // Per-channel quantization levels for each slider stop. The color count shown
  // to the user is levels³ (the maximum distinct colors a uniform palette holds),
  // so the displayed number is the value actually applied — no hidden cube-root.
  CL.paletteLevels = [2, 3, 4, 5, 6, 8, 12, 16];

  CL.selectedCodecId = () =>
    document.querySelector('input[name="codec"]:checked')?.value || "webp";

  CL.selectedCodec = () => CL.codecs[CL.selectedCodecId()];

  // Single place that selects a codec radio, so support/disabled handling and
  // the "does this input exist" check are not copy-pasted across files.
  CL.setCodec = function (id) {
    const input = document.querySelector(`input[name="codec"][value="${id}"]`);
    if (input) input.checked = true;
    return Boolean(input);
  };

  CL.selectedLevels = () =>
    CL.paletteLevels[Number(document.querySelector("#paletteRange").value) - 1];

  const descriptions = {
    webp: "Modern default",
    jpeg: "Most compatible photo format",
    png: "Lossless, exact pixels",
    "png-palette": "Fewer colors, smaller PNG",
    avif: "Efficient, browser-dependent",
  };

  async function supportsMime(mime) {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const blob = await CL.canvasToBlob(canvas, mime, 0.8);
    return Boolean(blob && blob.type === mime);
  }

  CL.detectSupport = async function () {
    const [jpeg, webp, avif] = await Promise.all([
      supportsMime(CL.codecs.jpeg.mime),
      supportsMime(CL.codecs.webp.mime),
      supportsMime(CL.codecs.avif.mime),
    ]);
    CL.state.supported = { png: true, "png-palette": true, jpeg, webp, avif };

    Object.entries(CL.state.supported).forEach(([id, supported]) => {
      const input = document.querySelector(`.codec-card input[value="${id}"]`);
      const card = input?.closest(".codec-card");
      if (!card || !input) return;
      card.classList.toggle("is-disabled", !supported);
      input.disabled = !supported;
      const description = card.querySelector("small");
      if (description) {
        description.textContent = supported
          ? descriptions[id]
          : "Not available in this browser";
      }
    });

    if (!CL.state.supported[CL.selectedCodecId()]) {
      CL.setCodec(CL.state.supported.webp ? "webp" : "jpeg");
    }

    const pill = document.querySelector("#supportPill");
    const count = Object.values(CL.state.supported).filter(Boolean).length;
    pill.textContent = `${count} formats available`;
    pill.title =
      "Grey formats are not broken. This browser just cannot create that output format from a web page.";
  };

  // Suggest a codec + quality for a freshly loaded file. Only used when the
  // user has no saved settings, so explicit choices always win.
  CL.recommendCodec = function (file, hasAlpha) {
    const sourceIsModern = file.type === "image/webp" || file.type === "image/avif";
    if (sourceIsModern && CL.state.supported.avif) {
      CL.setCodec("avif");
      document.querySelector("#qualityRange").value = 80;
      return;
    }
    if (CL.state.supported.webp) {
      CL.setCodec("webp");
      document.querySelector("#qualityRange").value = 82;
      return;
    }
    if (hasAlpha) {
      CL.setCodec("png");
      return;
    }
    CL.setCodec("jpeg");
  };
})(window.CL = window.CL || {});
