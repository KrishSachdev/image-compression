// Remove background: tap the background to pick its colour and make it
// see-through. Colour-based (not AI), so it suits plain backgrounds:
// product shots, logos, signatures, scans and green screens.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const PREVIEW_MAX = 1400; // longest side used while adjusting
  const WORK_MAX = 16_000_000; // pixels processed when saving
  const FULL = 441.7; // largest possible RGB distance

  // Alpha per pixel (255 = keep, 0 = see-through). picks hold 0..1 positions
  // plus the colour sampled there.
  function buildMask(data, w, h, picks, s) {
    const n = w * h;
    const alpha = new Uint8ClampedArray(n).fill(255);
    if (!picks.length) return alpha;
    const thr = (s.tolerance / 100) * FULL * 0.6;
    const soft = (s.soft / 100) * FULL * 0.25;
    const limit = thr + soft;
    const nearest = (i) => {
      const o = i * 4;
      let best = Infinity;
      for (const p of picks) {
        const dr = data[o] - p.r;
        const dg = data[o + 1] - p.g;
        const db = data[o + 2] - p.b;
        const d = dr * dr + dg * dg + db * db;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    };
    const alphaFor = (d) => (d <= thr ? 0 : Math.round((255 * (d - thr)) / (limit - thr || 1)));

    if (s.mode === "all") {
      for (let i = 0; i < n; i += 1) {
        const d = nearest(i);
        if (d < limit) alpha[i] = alphaFor(d);
      }
      return alpha;
    }

    // Connected: spread from each tapped spot through similar colours only,
    // so the same colour inside the subject stays.
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    let top = 0;
    for (const p of picks) {
      const x = Math.min(w - 1, Math.max(0, Math.round(p.x * (w - 1))));
      const y = Math.min(h - 1, Math.max(0, Math.round(p.y * (h - 1))));
      const start = y * w + x;
      if (!seen[start]) {
        seen[start] = 1;
        stack[top++] = start;
      }
    }
    while (top) {
      const i = stack[--top];
      const d = nearest(i);
      if (d >= limit) continue;
      alpha[i] = alphaFor(d);
      const x = i % w;
      if (x > 0 && !seen[i - 1]) (seen[i - 1] = 1), (stack[top++] = i - 1);
      if (x < w - 1 && !seen[i + 1]) (seen[i + 1] = 1), (stack[top++] = i + 1);
      if (i >= w && !seen[i - w]) (seen[i - w] = 1), (stack[top++] = i - w);
      if (i < n - w && !seen[i + w]) (seen[i + w] = 1), (stack[top++] = i + w);
    }
    return alpha;
  }

  // Draw `item` at w × h and apply the mask. Returns { canvas, cleared }.
  function compose(item, w, h, picks, s) {
    const canvas = T.canvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(item.image, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    const alpha = buildMask(px, canvas.width, canvas.height, picks, s);
    let cleared = 0;
    for (let i = 0; i < alpha.length; i += 1) {
      const a = Math.min(px[i * 4 + 3], alpha[i]);
      if (a < 128) cleared += 1;
      px[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    return { canvas, cleared: cleared / alpha.length };
  }

  function sizeFor(item, maxSide, maxArea) {
    const k = Math.min(1, maxSide / Math.max(item.width, item.height), Math.sqrt(maxArea / (item.width * item.height)));
    return { w: Math.max(1, Math.round(item.width * k)), h: Math.max(1, Math.round(item.height * k)) };
  }

  const FORMATS = {
    png: { mime: "image/png", ext: "png", label: "PNG", lossy: false },
    webp: { mime: "image/webp", ext: "webp", label: "WebP", lossy: true, quality: 0.95 },
  };

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="bgTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Remove background</p>
              <h2 id="bgTitle">Preview</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="change">${T.icon(T.icons.upload, 16)}<span>Choose image</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
        </section>
        <section class="panel tool-controls" aria-labelledby="bgSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="bgSettingsTitle">Background</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const picksField = T.el(`
      <div class="field">
        <div class="field-label"><strong>Background colour</strong><small>Tap it in the picture. Tap more spots to add colours.</small></div>
        <div class="bg-picks">
          <span class="bg-chips" data-slot="chips"></span>
          <button type="button" class="ghost-button bg-mini" data-act="undo" disabled>Undo</button>
          <button type="button" class="ghost-button bg-mini" data-act="reset" disabled>Clear picks</button>
        </div>
      </div>`);
    const chips = picksField.querySelector('[data-slot="chips"]');
    const undoButton = picksField.querySelector('[data-act="undo"]');
    const resetButton = picksField.querySelector('[data-act="reset"]');
    const mode = T.segmented("bg-mode", [
      { value: "connected", label: "Connected area", title: "Only the background joined to the spots you tapped" },
      { value: "all", label: "Everywhere", title: "That colour anywhere in the picture" },
    ], "connected", "Where to remove");
    const modeField = T.el('<div class="field"><div class="field-label"><strong>Where</strong><small>Connected keeps matching colours inside the subject</small></div></div>');
    modeField.appendChild(mode);
    const range = (label, aria, value) => {
      const f = T.el(`
        <label class="field range-field">
          <span class="field-label"><strong>${label}</strong><output></output></span>
          <input type="range" min="0" max="100" step="1" value="${value}" aria-label="${aria}" />
        </label>`);
      f.input = f.querySelector("input");
      f.sync = () => (f.querySelector("output").value = `${f.input.value}`);
      f.sync();
      return f;
    };
    const tolerance = range("Tolerance", "How different a colour can be and still count as background", 25);
    const soft = range("Edge softness", "How gently the edge fades out", 35);
    const originalField = T.el('<label class="check-line"><input type="checkbox" /><span><strong>Show original</strong><small>Compare with the untouched picture</small></span></label>');
    const originalInput = originalField.querySelector("input");
    const format = T.segmented("bg-format", [
      { value: "png", label: "PNG" },
      ...(CL.state.supported.webp !== false ? [{ value: "webp", label: "WebP" }] : []),
    ], "png", "Save as");
    const formatField = T.el('<div class="field"><div class="field-label"><strong>Save as</strong><small>Both keep the see-through parts</small></div></div>');
    formatField.appendChild(format);
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download image",
      onDownload: () => output().then((e) => e && T.download(e.blob, e.name)),
      onShare: () => output().then((e) => e && T.share([e], e.name)),
      onCompress: () => output().then((e) => e && T.sendToCompress([e])),
    });
    controls.append(picksField, modeField, tolerance, soft, originalField, formatField, summary, actions);

    const stage = CL.editorStage({ label: "Picture with the background removed" });
    stage.el.classList.add("bg-stage");
    stage.frame.classList.add("is-checker");
    stage.onFit = draw;
    const drop = T.dropzone({
      title: "Choose a picture",
      hint: "Best for plain backgrounds: product photos, logos, signatures, scans and green screens.",
      onFiles: addFiles,
    });

    let item = null;
    let preview = null; // { canvas, cleared } at preview size
    let picks = [];

    const settings = () => ({ mode: mode.value(), tolerance: Number(tolerance.input.value), soft: Number(soft.input.value) });

    // Colour under a 0..1 position, sampled from a small copy of the source.
    let sampler = null;
    function sample(x, y) {
      if (!sampler) {
        const size = sizeFor(item, PREVIEW_MAX, WORK_MAX);
        sampler = T.canvas(size.w, size.h).getContext("2d", { willReadFrequently: true });
        sampler.drawImage(item.image, 0, 0, size.w, size.h);
      }
      const { width, height } = sampler.canvas;
      const px = sampler.getImageData(Math.min(width - 1, Math.round(x * (width - 1))), Math.min(height - 1, Math.round(y * (height - 1))), 1, 1).data;
      return { x, y, r: px[0], g: px[1], b: px[2] };
    }

    function draw() {
      if (!item || !preview) return;
      const ctx = stage.canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, stage.canvas.width, stage.canvas.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(originalInput.checked ? item.image : preview.canvas, 0, 0, stage.canvas.width, stage.canvas.height);
    }

    function recompute() {
      if (!item) return;
      const size = sizeFor(item, PREVIEW_MAX, WORK_MAX);
      preview = compose(item, size.w, size.h, picks, settings());
      stage.fit(size.w, size.h);
      draw();
    }

    function refresh(recalc = true) {
      slot.textContent = "";
      slot.appendChild(item ? stage.el : drop);
      clearButton.disabled = !item;
      tolerance.sync();
      soft.sync();
      chips.innerHTML = picks
        .map((p) => `<span class="bg-chip" title="rgb(${p.r}, ${p.g}, ${p.b})" style="background: rgb(${p.r}, ${p.g}, ${p.b})"></span>`)
        .join("");
      undoButton.disabled = !picks.length;
      resetButton.disabled = !picks.length;
      actions.setEnabled(Boolean(item && picks.length), { shareable: item && T.canShare([{ blob: new Blob([], { type: "image/png" }), name: "a.png" }]) });
      if (!item) {
        summary.textContent = "";
        return;
      }
      if (recalc) recompute();
      else draw();
      summary.textContent = picks.length
        ? `${Math.round(preview.cleared * 100)}% of the picture is see-through. Saved as ${FORMATS[format.value()].label}.`
        : "Tap the background in the picture to remove it.";
    }

    async function addFiles(files) {
      const [next] = await T.loadItems(T.imageFiles(files).slice(0, 1));
      if (!next) return;
      T.releaseItem(item);
      item = next;
      sampler = null;
      // Start from the top-left corner colour: most plain backgrounds reach it.
      picks = [sample(0, 0)];
      refresh();
    }

    async function output() {
      if (!item || !picks.length) return null;
      const size = sizeFor(item, Infinity, WORK_MAX);
      const { canvas } = compose(item, size.w, size.h, picks, settings());
      const fmt = FORMATS[format.value()];
      try {
        const blob = await T.encode(canvas, fmt);
        return { blob, name: `${T.baseName(item.file.name)}-no-background.${fmt.ext}` };
      } catch (error) {
        CL.toast(error.message);
        return null;
      }
    }

    stage.canvas.addEventListener("click", (event) => {
      if (!item) return;
      const r = stage.canvas.getBoundingClientRect();
      const x = (event.clientX - r.left) / r.width;
      const y = (event.clientY - r.top) / r.height;
      if (x < 0 || y < 0 || x > 1 || y > 1) return;
      picks.push(sample(x, y));
      refresh();
    });
    undoButton.addEventListener("click", () => {
      picks.pop();
      refresh();
    });
    resetButton.addEventListener("click", () => {
      picks = [];
      refresh();
    });
    let pending = 0;
    controls.addEventListener("input", (event) => {
      if (!event.target.matches('input[type="range"]')) return;
      tolerance.sync();
      soft.sync();
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => refresh());
    });
    controls.addEventListener("change", (event) => {
      if (event.target === originalInput) refresh(false);
      else if (!event.target.matches('input[type="range"]')) refresh();
    });
    view.querySelector('[data-act="change"]').addEventListener("click", () => T.pickFiles({}, addFiles));
    clearButton.addEventListener("click", () => {
      T.releaseItem(item);
      item = null;
      preview = null;
      picks = [];
      refresh();
    });

    refresh();
    return {
      addFiles,
      onShow: () => item && stage.fit(),
      output,
      pick: (x, y) => { picks.push(sample(x, y)); refresh(); },
      state: () => ({ picks: picks.length, cleared: preview ? preview.cleared : null }),
    };
  }

  T.register({
    id: "bgremove",
    name: "Remove background",
    short: "Background",
    blurb: "Tap a plain background to make it see-through. Best for product photos, logos, signatures and green screens.",
    tags: ["PNG"],
    group: "edit",
    icon: '<path d="M7 21h10"/><path d="m5 13 6-6a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-5 5H9l-4-4a2 2 0 0 1 0-3z"/>',
    create,
  });
})(window.CL = window.CL || {});
