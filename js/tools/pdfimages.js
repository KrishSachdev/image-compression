// PDF to images: turn the pages of a PDF into pictures (PNG, JPEG or WebP).
// Uses Mozilla's pdf.js (js/vendor/pdfjs, Apache-2.0), loaded only the
// first time this tool opens a PDF, so the rest of the app stays light.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const ENGINE = "js/vendor/pdfjs/pdf.min.js";
  const WORKER = "js/vendor/pdfjs/pdf.worker.min.js";
  const SIZES = {
    screen: { label: "Screen", scale: 1, note: "72 dpi, small files" },
    sharp: { label: "Sharp", scale: 2, note: "144 dpi, good on phones" },
    print: { label: "Print", scale: 300 / 72, note: "300 dpi, for printing" },
  };
  const FORMATS = {
    png: { mime: "image/png", ext: "png", label: "PNG", lossy: false },
    jpeg: { mime: "image/jpeg", ext: "jpg", label: "JPEG", lossy: true },
    webp: { mime: "image/webp", ext: "webp", label: "WebP", lossy: true },
  };

  let engine = null;
  function loadEngine() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (engine) return engine;
    engine = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = ENGINE;
      script.onload = () => {
        const lib = window.pdfjsLib || window["pdfjs-dist/build/pdf"];
        if (!lib) return reject(new Error("The PDF engine did not start."));
        lib.GlobalWorkerOptions.workerSrc = WORKER;
        resolve(lib);
      };
      script.onerror = () => {
        engine = null;
        reject(new Error("PDF engine not installed yet."));
      };
      document.head.appendChild(script);
    });
    return engine;
  }

  const isPdf = (file) => file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="pdfImgTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">PDF to images</p>
              <h2 id="pdfImgTitle">Pages</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="all" hidden>Select all</button>
              <button type="button" class="ghost-button" data-act="none" hidden>Select none</button>
              <button type="button" class="ghost-button" data-act="change">${T.icon(T.icons.upload, 16)}<span>Choose PDF</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
        </section>
        <section class="panel tool-controls" aria-labelledby="pdfImgSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="pdfImgSettingsTitle">Images</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');
    const allButton = view.querySelector('[data-act="all"]');
    const noneButton = view.querySelector('[data-act="none"]');

    const size = T.segmented("pdfimg-size", Object.entries(SIZES).map(([value, s]) => ({ value, label: s.label, title: s.note })), "sharp", "Image size");
    const sizeField = T.el('<div class="field"><div class="field-label"><strong>Size</strong><small data-slot="sizeNote"></small></div></div>');
    sizeField.appendChild(size);
    const sizeNote = sizeField.querySelector('[data-slot="sizeNote"]');
    const format = T.segmented("pdfimg-format", [
      { value: "png", label: "PNG" },
      { value: "jpeg", label: "JPEG" },
      ...(CL.state.supported.webp !== false ? [{ value: "webp", label: "WebP" }] : []),
    ], "jpeg", "Save as");
    const formatField = T.el('<div class="field"><div class="field-label"><strong>Save as</strong><small>JPEG is smallest for scans and photos</small></div></div>');
    formatField.appendChild(format);
    const quality = T.el(`
      <label class="field range-field">
        <span class="field-label"><strong>Quality</strong><output>90%</output></span>
        <input type="range" min="40" max="100" step="1" value="90" aria-label="Image quality" />
      </label>`);
    const qualityInput = quality.querySelector("input");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download images",
      onDownload: () => exportPages().then((list) => {
        if (!list) return;
        if (list.length === 1) T.download(list[0].blob, list[0].name);
        else T.zip(list, `${base()}-pages.zip`);
      }),
      onShare: () => exportPages().then((list) => list && T.share(list, base())),
      onCompress: () => exportPages().then((list) => list && T.sendToCompress(list)),
    });
    controls.append(sizeField, formatField, quality, summary, actions);

    const id = `pdfimg-${Math.random().toString(36).slice(2, 8)}`;
    const drop = T.el(`
      <label class="tool-drop" for="${id}">
        <input id="${id}" type="file" accept="application/pdf,.pdf" />
        <span class="tool-drop-icon">${T.icon(T.icons.upload, 26)}</span>
        <strong>Choose a PDF</strong>
        <span>Every page becomes a picture. Tick the pages you want.</span>
      </label>`);
    drop.querySelector("input").addEventListener("change", (event) => {
      if (event.target.files.length) addFiles(event.target.files);
      event.target.value = "";
    });
    const grid = T.el('<ol class="pdfimg-grid" aria-label="PDF pages"></ol>');

    let doc = null;
    let file = null;
    let pages = []; // { n, width, height, on }
    let busy = false;
    let loadToken = 0;

    const base = () => T.baseName(file ? file.name : "pages");
    const chosen = () => pages.filter((p) => p.on);
    const fmt = () => ({ ...FORMATS[format.value()], quality: Number(qualityInput.value) / 100 });

    function pixelSize(p) {
      const s = SIZES[size.value()].scale;
      const k = T.fitScale(p.width * s, p.height * s);
      return { w: Math.max(1, Math.round(p.width * s * k)), h: Math.max(1, Math.round(p.height * s * k)), scale: s * k };
    }

    function refresh() {
      slot.textContent = "";
      slot.appendChild(doc ? grid : drop);
      clearButton.disabled = !doc;
      allButton.hidden = noneButton.hidden = !doc || pages.length < 2;
      quality.hidden = !fmt().lossy;
      quality.querySelector("output").value = `${qualityInput.value}%`;
      sizeNote.textContent = SIZES[size.value()].note;
      const count = chosen().length;
      actions.setEnabled(Boolean(doc && count && !busy), { shareable: T.canShare([{ blob: new Blob([], { type: "image/png" }), name: "a.png" }]) });
      actions.setLabel(count > 1 ? `Download ${count} images (.zip)` : "Download image");
      if (!doc) {
        summary.textContent = "";
        return;
      }
      if (busy) return;
      const first = chosen()[0] || pages[0];
      const px = pixelSize(first);
      summary.textContent = count
        ? `${count} of ${pages.length} page${pages.length > 1 ? "s" : ""} · about ${px.w} × ${px.h} px each · ${fmt().label}.`
        : "Tick at least one page.";
    }

    function card(p) {
      const li = T.el(`
        <li class="pdfimg-card${p.on ? "" : " is-off"}">
          <label>
            <input type="checkbox" ${p.on ? "checked" : ""} aria-label="Page ${p.n}" />
            <span class="pdfimg-thumb"><canvas></canvas></span>
            <span class="pdfimg-num">Page ${p.n}</span>
          </label>
        </li>`);
      const box = li.querySelector("input");
      box.addEventListener("change", () => {
        p.on = box.checked;
        li.classList.toggle("is-off", !p.on);
        refresh();
      });
      p.el = li;
      return li;
    }

    // intent "print" renders in one go; the default ("display") waits on
    // animation frames, which pause while the tab is in the background.
    async function renderPage(n, scale, intent = "display") {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = T.canvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; // paper is white; also keeps JPEG from going black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, intent }).promise;
      page.cleanup();
      return canvas;
    }

    async function addFiles(files) {
      const next = Array.from(files || []).find(isPdf);
      if (!next) {
        CL.toast("Please choose a PDF file.");
        return;
      }
      const token = ++loadToken;
      let lib;
      try {
        lib = await loadEngine();
      } catch (error) {
        CL.toast(error.message);
        return;
      }
      let loaded;
      try {
        loaded = await lib.getDocument({ data: new Uint8Array(await next.arrayBuffer()) }).promise;
      } catch (error) {
        CL.toast(error && error.name === "PasswordException" ? "This PDF is password-protected, so it can't be opened here." : "This file could not be read as a PDF.");
        return;
      }
      if (token !== loadToken) return;
      if (doc) doc.destroy();
      doc = loaded;
      file = next;
      pages = [];
      grid.textContent = "";
      for (let n = 1; n <= doc.numPages; n += 1) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const p = { n, width: vp.width, height: vp.height, on: true };
        pages.push(p);
        grid.appendChild(card(p));
      }
      refresh();
      // Thumbnails, one page at a time so big PDFs stay responsive.
      for (const p of pages) {
        if (token !== loadToken) return;
        const thumb = await renderPage(p.n, 150 / Math.max(p.width, p.height));
        const shown = p.el.querySelector("canvas");
        shown.width = thumb.width;
        shown.height = thumb.height;
        shown.getContext("2d").drawImage(thumb, 0, 0);
      }
    }

    async function exportPages() {
      const list = chosen();
      if (!doc || !list.length || busy) return null;
      busy = true;
      refresh();
      const f = fmt();
      const out = [];
      try {
        for (const [i, p] of list.entries()) {
          summary.textContent = `Making page ${i + 1} of ${list.length}…`;
          const canvas = await renderPage(p.n, pixelSize(p).scale, "print");
          const blob = await T.encode(canvas, f);
          out.push({ blob, name: `${base()}-page-${String(p.n).padStart(String(pages.length).length, "0")}.${f.ext}` });
        }
        return out;
      } catch (error) {
        CL.toast(error.message || "A page could not be turned into an image.");
        return null;
      } finally {
        busy = false;
        refresh();
      }
    }

    controls.addEventListener("change", refresh);
    qualityInput.addEventListener("input", refresh);
    allButton.addEventListener("click", () => {
      pages.forEach((p) => {
        p.on = true;
        p.el.classList.remove("is-off");
        p.el.querySelector("input").checked = true;
      });
      refresh();
    });
    noneButton.addEventListener("click", () => {
      pages.forEach((p) => {
        p.on = false;
        p.el.classList.add("is-off");
        p.el.querySelector("input").checked = false;
      });
      refresh();
    });
    view.querySelector('[data-act="change"]').addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/pdf,.pdf";
      input.addEventListener("change", () => input.files.length && addFiles(input.files));
      input.click();
    });
    clearButton.addEventListener("click", () => {
      loadToken += 1;
      if (doc) doc.destroy();
      doc = null;
      file = null;
      pages = [];
      grid.textContent = "";
      refresh();
    });

    refresh();
    return {
      addFiles,
      exportPages,
      state: () => ({ pages: pages.length, chosen: chosen().length }),
    };
  }

  T.register({
    id: "pdfimages",
    name: "PDF to images",
    short: "From PDF",
    blurb: "Turn the pages of a PDF into pictures: PNG, JPEG or WebP, screen or print sharpness, one page or all as a ZIP.",
    tags: ["ZIP"],
    group: "optimise",
    icon: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><circle cx="9" cy="13" r="1.5"/><path d="m20 18-4-4-6 6"/>',
    create,
  });
})(window.CL = window.CL || {});
