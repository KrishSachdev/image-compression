// Resize: one image or a batch, by width/height (shape kept or not), by
// percent, or to fit inside a box. Quick sizes for common screens/posts.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const QUICK = [3840, 1920, 1280, 1080, 800];

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="resizeTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Resize</p>
              <h2 id="resizeTitle">Images</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="add">${T.icon(T.icons.plus, 16)}<span>Add images</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
        </section>
        <section class="panel tool-controls" aria-labelledby="resizeSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="resizeSettingsTitle">New size</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const quick = T.el(`
      <div class="field">
        <div class="field-label"><strong>Quick widths</strong><small>Keeps the shape</small></div>
        <div class="chip-row">${QUICK.map((w) => `<button type="button" class="chip" data-quick="${w}">${w} px</button>`).join("")}</div>
      </div>`);
    const mode = T.segmented("resize-mode", [
      { value: "size", label: "Width & height" },
      { value: "percent", label: "Percent" },
      { value: "fit", label: "Fit inside" },
    ], "size", "Resize by");
    const modeField = T.el('<div class="field"><div class="field-label"><strong>Resize by</strong></div></div>');
    modeField.appendChild(mode);

    const sizeField = T.el(`
      <div class="field" data-for="size">
        <div class="grid-inputs">
          <label><span>Width</span><input type="number" class="num-input" min="1" max="20000" step="1" data-dim="w" placeholder="Auto" /></label>
          <span aria-hidden="true">×</span>
          <label><span>Height</span><input type="number" class="num-input" min="1" max="20000" step="1" data-dim="h" placeholder="Auto" /></label>
        </div>
        <label class="lock-label"><input type="checkbox" data-opt="lock" checked /> Keep the shape (fill in one side, the other follows)</label>
      </div>`);
    const wInput = sizeField.querySelector('[data-dim="w"]');
    const hInput = sizeField.querySelector('[data-dim="h"]');
    const lockInput = sizeField.querySelector('[data-opt="lock"]');
    const percentField = T.el(`
      <label class="field range-field" data-for="percent" hidden>
        <span class="field-label"><strong>Scale</strong><output>50%</output></span>
        <input type="range" min="1" max="400" step="1" value="50" aria-label="Scale in percent" />
      </label>`);
    const percentInput = percentField.querySelector("input");
    const fitField = T.el(`
      <div class="field" data-for="fit" hidden>
        <div class="field-label"><small>The whole image fits inside this box, shape kept</small></div>
        <div class="grid-inputs">
          <label><span>Max width</span><input type="number" class="num-input" min="1" max="20000" step="1" data-fit="w" value="1920" /></label>
          <span aria-hidden="true">×</span>
          <label><span>Max height</span><input type="number" class="num-input" min="1" max="20000" step="1" data-fit="h" value="1080" /></label>
        </div>
      </div>`);
    const fitW = fitField.querySelector('[data-fit="w"]');
    const fitH = fitField.querySelector('[data-fit="h"]');
    const enlargeField = T.el('<label class="check-line"><input type="checkbox" /><span><strong>Allow making images bigger</strong><small>Off: smaller images stay as they are (enlarging adds blur, not detail)</small></span></label>');
    const enlargeInput = enlargeField.querySelector("input");
    const format = T.formatField("resize");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download",
      onDownload: download,
      onShare: () => outputs().then((list) => list.length && T.share(list, "Resized images")),
      onCompress: () => outputs().then((list) => list.length && T.sendToCompress(list)),
    });
    controls.append(quick, modeField, sizeField, percentField, fitField, enlargeField, format, summary, actions);

    let driver = "w"; // which box the user typed in last (shape kept)

    const list = T.imageList({
      label: "Images to resize",
      reorder: false,
      figure(item) {
        const t = target(item);
        const same = t.w === item.width && t.h === item.height;
        return `<img class="stitch-thumb" src="${item.thumb}" alt="" /><span class="dim-badge${same ? " is-same" : ""}">${item.width} × ${item.height} → ${t.w} × ${t.h}</span>`;
      },
      onChange: refresh,
    });
    const drop = T.dropzone({
      multiple: true,
      title: "Add images to resize",
      hint: "Drop one picture or a whole batch here, tap to choose, or paste. Every image gets the same rule.",
      onFiles: addFiles,
    });

    function settings() {
      return {
        mode: mode.value(),
        w: Math.round(Number(wInput.value)) || 0,
        h: Math.round(Number(hInput.value)) || 0,
        lock: lockInput.checked,
        pct: CL.clamp(Number(percentInput.value) || 100, 1, 400),
        fw: Math.round(Number(fitW.value)) || 0,
        fh: Math.round(Number(fitH.value)) || 0,
        enlarge: enlargeInput.checked,
      };
    }

    function target(item, s = settings()) {
      const iw = item.width;
      const ih = item.height;
      let w = iw;
      let h = ih;
      let exact = false;
      if (s.mode === "size") {
        if (s.lock) {
          if (driver === "h" && s.h) {
            h = s.h;
            w = (iw * s.h) / ih;
          } else if (s.w) {
            w = s.w;
            h = (ih * s.w) / iw;
          } else if (s.h) {
            h = s.h;
            w = (iw * s.h) / ih;
          }
        } else if (s.w || s.h) {
          w = s.w || iw;
          h = s.h || ih;
          exact = true; // typed numbers are used as-is, even if bigger
        }
      } else if (s.mode === "percent") {
        w = (iw * s.pct) / 100;
        h = (ih * s.pct) / 100;
      } else {
        const k = Math.min(s.fw ? s.fw / iw : Infinity, s.fh ? s.fh / ih : Infinity);
        if (Number.isFinite(k)) {
          w = iw * k;
          h = ih * k;
        }
      }
      if (!exact && !s.enlarge && (w > iw || h > ih)) {
        w = iw;
        h = ih;
      }
      const f = T.fitScale(w, h);
      return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
    }

    function refresh() {
      const count = list.items.length;
      const s = settings();
      slot.textContent = "";
      slot.appendChild(count ? list.el : drop);
      clearButton.disabled = !count;
      sizeField.hidden = s.mode !== "size";
      percentField.hidden = s.mode !== "percent";
      fitField.hidden = s.mode !== "fit";
      percentField.querySelector("output").value = `${s.pct}%`;
      format.setSource(list.items[0]?.file.type);
      actions.setEnabled(count > 0, { shareable: count > 0 && T.canShare([{ blob: new Blob([], { type: "image/png" }), name: "a.png" }]) });
      actions.setLabel(count > 1 ? "Download all (.zip)" : "Download image");
      if (!count) {
        summary.textContent = "";
        return;
      }
      const first = list.items[0];
      const t = target(first, s);
      const unchanged = list.items.filter((item) => {
        const x = target(item, s);
        return x.w === item.width && x.h === item.height;
      }).length;
      summary.textContent =
        `${count === 1 ? "Becomes" : `${count} images. The first becomes`} ${t.w} × ${t.h} px, saved as ${count > 1 && format.isOriginal() ? "each file's own type" : format.get().label}.` +
        (unchanged ? ` ${unchanged === count ? "No image changes size" : `${unchanged} ${unchanged === 1 ? "stays" : "stay"} the same size`}${!s.enlarge ? " (already small enough)" : ""}.` : "");
    }

    function rerender() {
      list.render();
      refresh();
    }

    async function addFiles(files) {
      const items = await T.loadItems(files);
      if (items.length) list.add(items);
    }

    async function outputs() {
      const s = settings();
      const out = [];
      const used = new Set();
      for (const item of list.items) {
        const fmt = format.get(item.file.type);
        const t = target(item, s);
        const canvas = T.resample(item.image, item.width, item.height, t.w, t.h);
        try {
          const blob = await T.encode(canvas, fmt);
          let name = `${T.baseName(item.file.name)}-${t.w}x${t.h}.${fmt.ext}`;
          for (let n = 2; used.has(name); n += 1) name = `${T.baseName(item.file.name)}-${t.w}x${t.h}-${n}.${fmt.ext}`;
          used.add(name);
          out.push({ blob, name, width: t.w, height: t.h });
        } catch (error) {
          CL.toast(`${item.file.name}: ${error.message}`);
        }
      }
      return out;
    }

    let busy = false;
    async function download() {
      if (busy || !list.items.length) return;
      busy = true;
      actions.setEnabled(false);
      actions.setLabel("Resizing…");
      try {
        const files = await outputs();
        if (files.length === 1) T.download(files[0].blob, files[0].name);
        else if (files.length > 1) {
          await T.zip(files, "resized-images.zip");
          CL.toast(`ZIP with ${files.length} resized images ready.`);
        }
      } finally {
        busy = false;
        refresh();
      }
    }

    quick.addEventListener("click", (event) => {
      const button = event.target.closest("[data-quick]");
      if (!button) return;
      mode.set("size");
      lockInput.checked = true;
      wInput.value = button.dataset.quick;
      hInput.value = "";
      driver = "w";
      syncOther();
      rerender();
    });
    // With the shape kept, show the other side for the first image.
    function syncOther() {
      const first = list.items[0];
      if (!lockInput.checked || !first) return;
      if (driver === "w" && Number(wInput.value) > 0) hInput.value = Math.round((first.height * Number(wInput.value)) / first.width);
      if (driver === "h" && Number(hInput.value) > 0) wInput.value = Math.round((first.width * Number(hInput.value)) / first.height);
    }
    wInput.addEventListener("input", () => {
      driver = "w";
      syncOther();
    });
    hInput.addEventListener("input", () => {
      driver = "h";
      syncOther();
    });
    controls.addEventListener("input", (event) => {
      if (event.target.matches('input[type="number"], input[type="range"]')) rerender();
    });
    controls.addEventListener("change", rerender);
    view.querySelector('[data-act="add"]').addEventListener("click", () => T.pickFiles({ multiple: true }, addFiles));
    clearButton.addEventListener("click", () => list.clear());

    refresh();
    return { addFiles, outputs, target: (item) => target(item), list };
  }

  T.register({
    id: "resize",
    name: "Resize",
    short: "Resize",
    blurb: "Change the pixel size of one image or a whole batch: by width and height, percent, or to fit inside a box.",
    tags: ["Batch", "ZIP"],
    group: "optimise",
    icon: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
    create,
  });
})(window.CL = window.CL || {});
