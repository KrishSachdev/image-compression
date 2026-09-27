// Adjust & filters: brightness, contrast, saturation, warmth, plus black &
// white, sepia and invert. A split view compares before and after.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const SLIDERS = [
    { key: "brightness", label: "Brightness" },
    { key: "contrast", label: "Contrast" },
    { key: "saturation", label: "Saturation" },
    { key: "warmth", label: "Warmth" },
  ];
  const FILTERS = [
    { value: "none", label: "None" },
    { value: "gray", label: "Black & white" },
    { value: "sepia", label: "Sepia" },
    { value: "invert", label: "Invert" },
  ];

  // Returns a function that edits RGBA pixel data in place.
  function makeAdjuster(s) {
    const lut = new Uint8ClampedArray(256);
    const bright = 1 + s.brightness / 100;
    // Linear contrast around mid-grey: +100 doubles it, −100 flattens it.
    const cf = 1 + s.contrast / 100;
    for (let i = 0; i < 256; i += 1) lut[i] = cf * (i * bright - 128) + 128;
    const sat = 1 + s.saturation / 100;
    const warm = s.warmth * 0.3;
    const filter = s.filter;
    return (d) => {
      for (let i = 0; i < d.length; i += 4) {
        let r = lut[d[i]];
        let g = lut[d[i + 1]];
        let b = lut[d[i + 2]];
        if (sat !== 1) {
          const y = 0.299 * r + 0.587 * g + 0.114 * b;
          r = y + (r - y) * sat;
          g = y + (g - y) * sat;
          b = y + (b - y) * sat;
        }
        if (warm) {
          r += warm;
          b -= warm;
        }
        if (filter === "gray") {
          r = g = b = 0.299 * r + 0.587 * g + 0.114 * b;
        } else if (filter === "sepia") {
          const nr = 0.393 * r + 0.769 * g + 0.189 * b;
          const ng = 0.349 * r + 0.686 * g + 0.168 * b;
          const nb = 0.272 * r + 0.534 * g + 0.131 * b;
          r = nr;
          g = ng;
          b = nb;
        } else if (filter === "invert") {
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
        }
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
    };
  }

  const isNeutral = (s) => s.filter === "none" && SLIDERS.every((x) => !s[x.key]);

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="adjustTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Adjust & filters</p>
              <h2 id="adjustTitle">Before / after</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="change">${T.icon(T.icons.upload, 16)}<span>Choose image</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
        </section>
        <section class="panel tool-controls" aria-labelledby="adjustSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="adjustSettingsTitle">Look</h2></div>
            <button type="button" class="ghost-button" data-act="reset" disabled>Reset</button></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');
    const resetButton = view.querySelector('[data-act="reset"]');

    const filter = T.segmented("adjust-filter", FILTERS, "none", "Filter");
    filter.classList.add("seg-wrap");
    const filterField = T.el('<div class="field"><div class="field-label"><strong>Filter</strong></div></div>');
    filterField.appendChild(filter);
    const sliders = {};
    const sliderFields = SLIDERS.map((x) => {
      const f = T.el(`
        <label class="field range-field">
          <span class="field-label"><strong>${x.label}</strong><output>0</output></span>
          <input type="range" min="-100" max="100" step="1" value="0" aria-label="${x.label}" data-key="${x.key}" />
        </label>`);
      sliders[x.key] = f.querySelector("input");
      // Double-click / double-tap a slider to put it back to 0.
      sliders[x.key].addEventListener("dblclick", () => {
        sliders[x.key].value = 0;
        update();
      });
      return f;
    });
    const format = T.formatField("adjust");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download edited image",
      onDownload: () => output().then((e) => e && T.download(e.blob, e.name)),
      onShare: () => output().then((e) => e && T.share([e], e.name)),
      onCompress: () => output().then((e) => e && T.sendToCompress([e])),
    });
    controls.append(filterField, ...sliderFields, format, summary, actions);

    // Split compare: "before" canvas underneath, "after" clipped on top.
    const stage = T.el(`
      <div class="cmp-stage">
        <div class="cmp-frame">
          <canvas class="cmp-before" aria-hidden="true"></canvas>
          <canvas class="cmp-after" role="img" aria-label="Edited picture (left of the line shows the original)"></canvas>
          <span class="cmp-line" aria-hidden="true"><span></span></span>
          <span class="cmp-tag cmp-tag-left" aria-hidden="true">Before</span>
          <span class="cmp-tag cmp-tag-right" aria-hidden="true">After</span>
        </div>
        <label class="cmp-slider"><span class="sr-only">Compare before and after</span><input type="range" min="0" max="100" step="1" value="50" /></label>
      </div>`);
    const frame = stage.querySelector(".cmp-frame");
    const before = stage.querySelector(".cmp-before");
    const after = stage.querySelector(".cmp-after");
    const line = stage.querySelector(".cmp-line");
    const split = stage.querySelector(".cmp-slider input");
    const drop = T.dropzone({
      title: "Choose a photo to adjust",
      hint: "Drop a photo here, tap to choose, or paste. Drag the line to compare before and after.",
      onFiles: addFiles,
    });

    let item = null;
    let base = null; // preview-size original pixels

    function settings() {
      const s = { filter: filter.value() };
      for (const x of SLIDERS) s[x.key] = Number(sliders[x.key].value);
      return s;
    }

    function fit() {
      if (!item || !stage.isConnected) return;
      const availW = Math.max(160, stage.clientWidth - 20);
      const availH = Math.max(220, Math.min(620, window.innerHeight * 0.6));
      const k = Math.min(availW / item.width, availH / item.height, 1.5);
      const cssW = Math.max(1, Math.round(item.width * k));
      const cssH = Math.max(1, Math.round(item.height * k));
      frame.style.width = `${cssW}px`;
      frame.style.height = `${cssH}px`;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pw = Math.min(item.width, Math.round(cssW * dpr));
      const ph = Math.min(item.height, Math.round(cssH * dpr));
      for (const c of [before, after]) {
        c.width = pw;
        c.height = ph;
      }
      const bctx = before.getContext("2d", { willReadFrequently: true });
      bctx.imageSmoothingQuality = "high";
      bctx.drawImage(item.image, 0, 0, pw, ph);
      base = bctx.getImageData(0, 0, pw, ph);
      paint();
    }

    let frameRequest = 0;
    function paint() {
      cancelAnimationFrame(frameRequest);
      frameRequest = requestAnimationFrame(() => {
        if (!base) return;
        const img = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
        makeAdjuster(settings())(img.data);
        after.getContext("2d").putImageData(img, 0, 0);
      });
    }

    function setSplit(value) {
      const v = CL.clamp(value, 0, 100);
      split.value = v;
      after.style.clipPath = `inset(0 0 0 ${v}%)`;
      line.style.left = `${v}%`;
    }

    function update() {
      const s = settings();
      SLIDERS.forEach((x, i) => {
        const v = s[x.key];
        sliderFields[i].querySelector("output").value = v > 0 ? `+${v}` : String(v);
      });
      resetButton.disabled = !item || isNeutral(s);
      if (item) {
        const changed = SLIDERS.filter((x) => s[x.key]).map((x) => `${x.label.toLowerCase()} ${s[x.key] > 0 ? "+" : ""}${s[x.key]}`);
        if (s.filter !== "none") changed.unshift(FILTERS.find((f) => f.value === s.filter).label.toLowerCase());
        const text = changed.join(", ");
        summary.textContent = changed.length
          ? `${text[0].toUpperCase()}${text.slice(1)}. ${item.width} × ${item.height} px, saved as ${format.get().label}.`
          : "No changes yet. Move a slider or pick a filter.";
      }
      paint();
    }

    function refresh() {
      slot.textContent = "";
      slot.appendChild(item ? stage : drop);
      clearButton.disabled = !item;
      actions.setEnabled(Boolean(item), { shareable: item && T.canShare([{ blob: new Blob([], { type: "image/png" }), name: "a.png" }]) });
      if (!item) summary.textContent = "";
      fit();
      update();
    }

    async function addFiles(files) {
      const [next] = await T.loadItems(T.imageFiles(files).slice(0, 1));
      if (!next) return;
      T.releaseItem(item);
      item = next;
      format.setSource(item.file.type);
      setSplit(50);
      refresh();
    }

    async function output() {
      if (!item) return null;
      const canvas = T.canvas(item.width, item.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(item.image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      makeAdjuster(settings())(data.data);
      ctx.putImageData(data, 0, 0);
      const fmt = format.get();
      try {
        const blob = await T.encode(canvas, fmt);
        return { blob, name: `${T.baseName(item.file.name)}-edited.${fmt.ext}` };
      } catch (error) {
        CL.toast(error.message);
        return null;
      }
    }

    // Drag anywhere on the picture to move the compare line.
    let dragging = false;
    const moveTo = (event) => {
      const box = frame.getBoundingClientRect();
      setSplit(((event.clientX - box.left) / box.width) * 100);
    };
    frame.addEventListener("pointerdown", (event) => {
      dragging = true;
      try {
        frame.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic pointer */
      }
      moveTo(event);
    });
    frame.addEventListener("pointermove", (event) => dragging && moveTo(event));
    frame.addEventListener("pointerup", () => (dragging = false));
    frame.addEventListener("pointercancel", () => (dragging = false));
    split.addEventListener("input", () => setSplit(Number(split.value)));

    controls.addEventListener("input", (event) => {
      if (event.target.matches('input[type="range"][data-key]')) update();
    });
    controls.addEventListener("change", update);
    resetButton.addEventListener("click", () => {
      SLIDERS.forEach((x) => (sliders[x.key].value = 0));
      filter.set("none");
      update();
    });
    view.querySelector('[data-act="change"]').addEventListener("click", () => T.pickFiles({}, addFiles));
    clearButton.addEventListener("click", () => {
      T.releaseItem(item);
      item = null;
      base = null;
      refresh();
    });
    new ResizeObserver(() => item && !view.hidden && fit()).observe(slot);

    setSplit(50);
    refresh();
    return { addFiles, output, settings, makeAdjuster };
  }

  T.register({
    id: "adjust",
    name: "Adjust & filters",
    short: "Adjust",
    blurb: "Brightness, contrast, saturation and warmth, or black & white, sepia and invert, with a before/after view.",
    tags: ["Compare"],
    group: "edit",
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 7h5"/><path d="M12 11h8"/><path d="M12 15h7"/>',
    create,
  });
})(window.CL = window.CL || {});
