// Images → PDF: many images, reorder, rotate, page size, orientation,
// margin, quality; one PDF out. The page cards double as a live preview.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const MM = 72 / 25.4; // PDF points per millimetre
  const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
  const MARGINS = { none: 0, small: 6, normal: 12, large: 20 }; // mm
  const QUALITY = {
    original: {
      maxEdge: 0,
      jpeg: 0.92,
      keepJpeg: true,
      lossless: true,
      note: "JPEG photos go in untouched and other images without any loss. Biggest file.",
    },
    high: { maxEdge: 3000, jpeg: 0.88, note: "Sharp enough to print. Longest side up to 3000 px, saved as JPEG." },
    balanced: { maxEdge: 2000, jpeg: 0.8, note: "Good for email and sharing. Longest side up to 2000 px." },
    small: { maxEdge: 1400, jpeg: 0.65, note: "Smallest file. Fine on screens, a bit soft if printed." },
  };

  function displayDims(item) {
    return (item.turn || 0) % 180 ? [item.height, item.width] : [item.width, item.height];
  }

  // Page size and image box (PDF points, origin bottom-left) for one image.
  function layout(item, s) {
    const [dw, dh] = displayDims(item);
    const m = MARGINS[s.margin] * MM;
    let pw;
    let ph;
    if (s.size === "fit") {
      // Page matches the picture at 96 pixels per inch; PDF pages top out
      // at 200 inches (14 400 pt), so giant images are scaled to fit.
      let w = dw * 0.75;
      let h = dh * 0.75;
      const k = Math.min(1, (14400 - 2 * m) / w, (14400 - 2 * m) / h);
      w *= k;
      h *= k;
      pw = w + 2 * m;
      ph = h + 2 * m;
    } else {
      [pw, ph] = PAGE_SIZES[s.size];
      const landscape = s.orient === "landscape" || (s.orient === "auto" && dw > dh);
      if (landscape) [pw, ph] = [ph, pw];
    }
    const cw = pw - 2 * m;
    const ch = ph - 2 * m;
    const k = Math.min(cw / dw, ch / dh);
    const w = dw * k;
    const h = dh * k;
    return { pw, ph, box: { x: m + (cw - w) / 2, y: m + (ch - h) / 2, w, h } };
  }

  // A stored JPEG can be embedded byte-for-byte when it is plain 8-bit RGB or
  // greyscale; its EXIF rotation is applied by the page matrix instead.
  async function jpegAsIs(item, box) {
    if (item.file.type !== "image/jpeg" || item.downscaled) return null;
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const info = CL.meta.jpegInfo(bytes);
    if (!info) return null;
    const { sof } = info;
    if (sof.precision !== 8 || ![0xc0, 0xc1, 0xc2].includes(sof.marker)) return null;
    if (sof.components !== 1 && sof.components !== 3) return null;
    const t = CL.meta.orientationTransform(info.orientation);
    const upright = t.rotate % 180 ? [sof.height, sof.width] : [sof.width, sof.height];
    // If the browser's upright size disagrees with ours, don't guess.
    if (upright[0] !== item.width || upright[1] !== item.height) return null;
    return {
      kind: "jpeg",
      bytes,
      pixelWidth: sof.width,
      pixelHeight: sof.height,
      colorSpace: sof.components === 1 ? "DeviceGray" : "DeviceRGB",
      matrix: CL.pdf.placementMatrix(box, t.rotate + (item.turn || 0), t.flipH),
    };
  }

  async function reencode(item, box, q) {
    const scale = q.maxEdge ? Math.min(1, q.maxEdge / Math.max(item.width, item.height)) : 1;
    const canvas = T.canvas(item.width * scale, item.height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: q.lossless });
    ctx.fillStyle = "#ffffff"; // pages are white; transparency becomes white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(item.image, 0, 0, canvas.width, canvas.height);
    const matrix = CL.pdf.placementMatrix(box, item.turn || 0, false);

    if (q.lossless && CL.pdf.canDeflate()) {
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const rgb = new Uint8Array(canvas.width * canvas.height * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        rgb[j] = rgba[i];
        rgb[j + 1] = rgba[i + 1];
        rgb[j + 2] = rgba[i + 2];
      }
      return {
        kind: "flate",
        bytes: await CL.pdf.deflate(rgb),
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        matrix,
      };
    }
    const blob = await CL.canvasToBlob(canvas, "image/jpeg", q.jpeg);
    if (!blob) throw new Error("This browser could not prepare one of the images.");
    return {
      kind: "jpeg",
      bytes: new Uint8Array(await blob.arrayBuffer()),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      matrix,
    };
  }

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="pdfTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Images to PDF</p>
              <h2 id="pdfTitle">Pages</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="add">${T.icon(T.icons.plus, 16)}<span>Add images</span></button>
              <button type="button" class="ghost-button" data-act="sort" disabled>Sort A–Z</button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
          <p class="tool-hint" data-slot="hint" hidden>Drag the grip or use the arrows to change the order. Each card shows how its page will look.</p>
        </section>
        <section class="panel tool-controls" aria-labelledby="pdfSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="pdfSettingsTitle">PDF options</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const stage = view.querySelector('[data-slot="stage"]');
    const hint = view.querySelector('[data-slot="hint"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const addButton = view.querySelector('[data-act="add"]');
    const sortButton = view.querySelector('[data-act="sort"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const size = T.segmented("pdf-size", [
      { value: "fit", label: "Fit to image" },
      { value: "a4", label: "A4" },
      { value: "letter", label: "Letter" },
    ], "a4", "Page size");
    const orient = T.segmented("pdf-orient", [
      { value: "auto", label: "Auto", title: "Each page turns to match its image" },
      { value: "portrait", label: "Portrait" },
      { value: "landscape", label: "Landscape" },
    ], "auto", "Orientation");
    const margin = T.segmented("pdf-margin", [
      { value: "none", label: "None" },
      { value: "small", label: "Small" },
      { value: "normal", label: "Normal" },
      { value: "large", label: "Large" },
    ], "small", "Margin");
    const quality = T.segmented("pdf-quality", [
      { value: "original", label: "Original" },
      { value: "high", label: "High" },
      { value: "balanced", label: "Balanced" },
      { value: "small", label: "Small" },
    ], "balanced", "Image quality");

    const field = (label, help, control) => {
      const wrap = T.el(`<div class="field"><div class="field-label"><strong>${label}</strong>${help ? `<small>${help}</small>` : ""}</div></div>`);
      wrap.appendChild(control);
      return wrap;
    };
    const orientField = field("Orientation", "", orient);
    const qualityField = field("Image quality", "", quality);
    const qualityNote = T.el('<p class="field-note"></p>');
    qualityField.appendChild(qualityNote);
    const nameField = T.el(`
      <label class="field">
        <span class="field-label"><strong>File name</strong></span>
        <span class="text-input-wrap"><input type="text" class="text-input" value="images" spellcheck="false" autocomplete="off" aria-label="PDF file name" /><span>.pdf</span></span>
      </label>`);
    const nameInput = nameField.querySelector("input");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download PDF",
      onDownload: () => run("download"),
      onShare: () => run("share"),
    });
    controls.append(
      field("Page size", "", size),
      orientField,
      field("Margin", "White space around each image", margin),
      qualityField,
      nameField,
      summary,
      actions,
    );

    const settings = () => ({
      size: size.value(),
      orient: orient.value(),
      margin: margin.value(),
      quality: quality.value(),
      name: nameInput.value.trim() || "images",
    });

    const list = T.imageList({
      label: "PDF pages, in order",
      rotate: true,
      figure(item) {
        const { pw, ph, box } = layout(item, settings());
        const turn = item.turn || 0;
        const sideways = turn % 180 !== 0;
        const imgStyle = sideways
          ? `width:${(box.h / box.w) * 100}%;height:${(box.w / box.h) * 100}%;transform:translate(-50%,-50%) rotate(${turn}deg)`
          : `width:100%;height:100%;transform:translate(-50%,-50%) rotate(${turn}deg)`;
        return `
          <div class="pdf-page" style="--ar:${(pw / ph).toFixed(4)}">
            <div class="pdf-page-box" style="left:${(box.x / pw) * 100}%;top:${((ph - box.y - box.h) / ph) * 100}%;width:${(box.w / pw) * 100}%;height:${(box.h / ph) * 100}%">
              <img src="${item.thumb}" alt="" style="${imgStyle}" />
            </div>
          </div>`;
      },
      onChange: refresh,
    });

    const drop = T.dropzone({
      multiple: true,
      title: "Add images for your PDF",
      hint: "Drop photos, scans or screenshots here, tap to choose, or paste. One image becomes one page.",
      onFiles: addFiles,
    });

    let lastSize = 0;
    function refresh() {
      const count = list.items.length;
      const s = settings();
      stage.textContent = "";
      stage.appendChild(count ? list.el : drop);
      hint.hidden = count < 2;
      sortButton.disabled = count < 2;
      clearButton.disabled = !count;
      orientField.hidden = s.size === "fit";
      qualityNote.textContent = QUALITY[s.quality].note;
      actions.setEnabled(count > 0, { shareable: T.canShare([{ blob: new Blob([], { type: "application/pdf" }), name: "a.pdf" }]) });
      if (!count) {
        summary.textContent = "";
        return;
      }
      const sizeLabel = s.size === "fit" ? "pages sized to each image" : `${s.size === "a4" ? "A4" : "Letter"}${s.orient === "auto" ? "" : `, ${s.orient}`}`;
      summary.textContent = `${count} ${count === 1 ? "page" : "pages"} · ${sizeLabel}${lastSize ? ` · last PDF ${CL.formatBytes(lastSize)}` : ""}`;
    }

    async function addFiles(files) {
      const items = await T.loadItems(files);
      if (!items.length) return;
      const wasEmpty = !list.items.length;
      list.add(items);
      if (wasEmpty) nameInput.value = T.baseName(items[0].file.name);
      lastSize = 0;
      refresh();
    }

    async function build() {
      const s = settings();
      const q = QUALITY[s.quality];
      const pages = [];
      for (const item of list.items) {
        const { pw, ph, box } = layout(item, s);
        const image = (q.keepJpeg && (await jpegAsIs(item, box))) || (await reencode(item, box, q));
        pages.push({ width: pw, height: ph, image });
      }
      return CL.pdf.build(pages, { title: s.name });
    }

    let busy = false;
    async function run(mode) {
      if (busy || !list.items.length) return;
      busy = true;
      actions.setEnabled(false);
      actions.setLabel("Making PDF…");
      try {
        const blob = await build();
        lastSize = blob.size;
        const name = `${settings().name.replace(/[\\/:*?"<>|]+/g, "-")}.pdf`;
        if (mode === "share") await T.share([{ blob, name }], name);
        else T.download(blob, name);
        CL.toast(`PDF ready: ${list.items.length} ${list.items.length === 1 ? "page" : "pages"}, ${CL.formatBytes(blob.size)}.`);
      } catch (error) {
        console.error(error);
        CL.toast(error.message || "Could not make the PDF.");
      } finally {
        busy = false;
        actions.setLabel("Download PDF");
        refresh();
      }
    }

    controls.addEventListener("change", () => {
      lastSize = 0;
      list.render();
      refresh();
    });
    addButton.addEventListener("click", () => T.pickFiles({ multiple: true }, addFiles));
    sortButton.addEventListener("click", () => list.sortByName());
    clearButton.addEventListener("click", () => {
      list.clear();
      lastSize = 0;
      refresh();
    });

    refresh();
    return { addFiles, build, list, layout: (item) => layout(item, settings()) };
  }

  T.register({
    id: "pdf",
    name: "Images to PDF",
    short: "To PDF",
    blurb: "Turn photos, scans or screenshots into one PDF. Reorder, rotate, pick A4, Letter or fit-to-image.",
    tags: ["Multiple images"],
    group: "combine",
    icon: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    create,
  });
})(window.CL = window.CL || {});
