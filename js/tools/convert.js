// Convert: the plain version of "change the file type". Any image the browser
// can open → JPEG, PNG, WebP or AVIF, same name, same size; batches as a ZIP.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const TARGETS = {
    "image/jpeg": { ext: "jpg", label: "JPEG", lossy: true, alpha: false, note: "Opens everywhere. No transparency." },
    "image/png": { ext: "png", label: "PNG", lossy: false, alpha: true, note: "Exact pixels and transparency. Bigger files." },
    "image/webp": { ext: "webp", label: "WebP", lossy: true, alpha: true, note: "Small files with transparency. Works in all modern browsers and apps." },
    "image/avif": { ext: "avif", label: "AVIF", lossy: true, alpha: true, note: "Smallest files. Some older apps can't open it." },
  };

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="convTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Convert</p>
              <h2 id="convTitle">Images</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="add">${T.icon(T.icons.plus, 16)}<span>Add images</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
        </section>
        <section class="panel tool-controls" aria-labelledby="convSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="convSettingsTitle">Convert to</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const target = T.segmented(
      "conv-target",
      Object.entries(TARGETS).map(([value, t]) => ({ value, label: t.label })),
      "image/jpeg",
      "Convert to",
    );
    const targetField = T.el('<div class="field"><div class="field-label"><strong>New format</strong></div></div>');
    const targetNote = T.el('<p class="field-note"></p>');
    targetField.append(target, targetNote);
    const quality = T.el(`
      <label class="field range-field">
        <span class="field-label"><strong>Quality</strong><output>90%</output></span>
        <input type="range" min="40" max="100" step="1" value="90" aria-label="Quality" />
      </label>`);
    const qualityInput = quality.querySelector("input");
    const matte = T.el(`
      <label class="field color-field">
        <span class="field-label"><strong>Background for see-through parts</strong></span>
        <input type="color" value="#ffffff" aria-label="Background colour for transparent areas" />
      </label>`);
    const matteInput = matte.querySelector("input");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download",
      onDownload: download,
      onShare: () => outputs().then((files) => files.length && T.share(files, "Converted images")),
      onCompress: () => outputs().then((files) => files.length && T.sendToCompress(files)),
    });
    controls.append(targetField, quality, matte, summary, actions);

    const list = T.imageList({
      label: "Images to convert",
      reorder: false,
      figure: (item) => {
        const from = (item.file.type.replace("image/", "") || "image").replace("svg+xml", "svg").toUpperCase();
        return `<img class="stitch-thumb" src="${item.thumb}" alt="" /><span class="dim-badge">${T.escape(from)} → ${TARGETS[target.value()].label}</span>`;
      },
      onChange: refresh,
    });
    const drop = T.dropzone({
      multiple: true,
      title: "Add images to convert",
      hint: "PNG, JPEG, WebP, AVIF, GIF, BMP, SVG… one or a whole folder's worth. Names stay the same; only the type changes.",
      onFiles: addFiles,
    });

    function syncAvif() {
      // Grey out formats this browser can't create.
      Object.keys(TARGETS).forEach((mime) => {
        const input = target.querySelector(`input[value="${mime}"]`);
        const ok = mime === "image/png" || CL.state.supported[{ "image/jpeg": "jpeg", "image/webp": "webp", "image/avif": "avif" }[mime]] !== false;
        input.disabled = !ok;
        input.closest(".seg-option").title = ok ? "" : "This browser can't save this format";
      });
    }

    function refresh() {
      syncAvif();
      const count = list.items.length;
      const t = TARGETS[target.value()];
      slot.textContent = "";
      slot.appendChild(count ? list.el : drop);
      clearButton.disabled = !count;
      targetNote.textContent = t.note;
      quality.hidden = !t.lossy;
      quality.querySelector("output").value = `${qualityInput.value}%`;
      const anyAlpha = list.items.some((item) => item.hasAlpha);
      matte.hidden = t.alpha || (count > 0 && !anyAlpha);
      actions.setEnabled(count > 0, { shareable: count > 0 && T.canShare([{ blob: new Blob([], { type: "image/png" }), name: "a.png" }]) });
      actions.setLabel(count > 1 ? "Download all (.zip)" : "Download image");
      if (!count) summary.textContent = "";
      else {
        const same = list.items.filter((item) => item.file.type === target.value()).length;
        summary.textContent = `${count} ${count === 1 ? "image" : "images"} → ${t.label}${t.lossy ? ` at ${qualityInput.value}%` : ""}.${same ? ` ${same} already ${same === 1 ? "is" : "are"} ${t.label} and will just be re-saved.` : ""}${!t.alpha && anyAlpha ? " See-through parts get the background colour." : ""}`;
      }
    }

    async function addFiles(files) {
      const items = await T.loadItems(files);
      if (items.length) list.add(items);
    }

    async function outputs() {
      const mime = target.value();
      const t = TARGETS[mime];
      const out = [];
      const used = new Set();
      for (const item of list.items) {
        const canvas = T.canvas(item.width, item.height);
        const ctx = canvas.getContext("2d");
        if (!t.alpha) {
          ctx.fillStyle = matteInput.value;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(item.image, 0, 0);
        const blob = await CL.canvasToBlob(canvas, mime, t.lossy ? Number(qualityInput.value) / 100 : undefined);
        if (!blob || blob.type !== mime) {
          CL.toast(`${t.label} isn't supported by this browser.`);
          return out;
        }
        let name = `${T.baseName(item.file.name)}.${t.ext}`;
        for (let n = 2; used.has(name); n += 1) name = `${T.baseName(item.file.name)}-${n}.${t.ext}`;
        used.add(name);
        out.push({ blob, name });
      }
      return out;
    }

    let busy = false;
    async function download() {
      if (busy) return;
      busy = true;
      actions.setEnabled(false);
      actions.setLabel("Converting…");
      try {
        const files = await outputs();
        if (files.length === 1) T.download(files[0].blob, files[0].name);
        else if (files.length > 1) {
          await T.zip(files, "converted-images.zip");
          CL.toast(`ZIP with ${files.length} converted images ready.`);
        }
      } finally {
        busy = false;
        refresh();
      }
    }

    controls.addEventListener("change", () => {
      list.render();
      refresh();
    });
    controls.addEventListener("input", (event) => {
      if (event.target.matches('input[type="range"]')) refresh();
    });
    view.querySelector('[data-act="add"]').addEventListener("click", () => T.pickFiles({ multiple: true }, addFiles));
    clearButton.addEventListener("click", () => list.clear());

    refresh();
    return { addFiles, outputs, onShow: refresh };
  }

  T.register({
    id: "convert",
    name: "Convert format",
    short: "Convert",
    blurb: "Change the file type of one image or many: to JPEG, PNG, WebP or AVIF. Same names, same size.",
    tags: ["Batch", "ZIP"],
    group: "optimise",
    icon: '<path d="M4 7h13"/><path d="m14 4 3 3-3 3"/><path d="M20 17H7"/><path d="m10 14-3 3 3 3"/>',
    create,
  });
})(window.CL = window.CL || {});
