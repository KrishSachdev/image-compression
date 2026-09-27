// Stitch: join several images side by side, stacked, or in a grid, with
// optional matching sizes, spacing and a background colour.
(function (CL) {
  "use strict";

  const T = CL.toolkit;

  const dims = (item) => ((item.turn || 0) % 180 ? [item.height, item.width] : [item.width, item.height]);

  // Where every image goes, in output pixels.
  function layout(items, s) {
    const gap = s.gap;
    const pad = s.outer ? gap : 0;
    const sizes = items.map(dims);
    const places = [];
    let W = 0;
    let H = 0;
    const alignOffset = (space, size) => (s.align === "start" ? 0 : s.align === "end" ? space - size : (space - size) / 2);

    if (s.mode === "row" || s.mode === "column") {
      const row = s.mode === "row";
      // Cross size: the side that must line up (height for a row).
      const cross = sizes.map(([w, h]) => (row ? h : w));
      const target = s.match ? Math.min(...cross) : Math.max(...cross);
      let along = pad;
      sizes.forEach(([w, h], i) => {
        const k = s.match ? target / (row ? h : w) : 1;
        const pw = Math.max(1, Math.round(w * k));
        const ph = Math.max(1, Math.round(h * k));
        const off = pad + (s.match ? 0 : alignOffset(target, row ? ph : pw));
        places.push(row ? { item: items[i], x: along, y: off, w: pw, h: ph } : { item: items[i], x: off, y: along, w: pw, h: ph });
        along += (row ? pw : ph) + gap;
      });
      const total = along - gap + pad;
      W = row ? total : target + 2 * pad;
      H = row ? target + 2 * pad : total;
    } else {
      const cols = Math.max(1, Math.min(s.cols, items.length));
      const cellW = s.match ? Math.min(...sizes.map(([w]) => w)) : Math.max(...sizes.map(([w]) => w));
      const scaled = sizes.map(([w, h]) => {
        const k = s.match ? cellW / w : 1;
        return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
      });
      let y = pad;
      for (let start = 0; start < items.length; start += cols) {
        const rowItems = scaled.slice(start, start + cols);
        const rowH = Math.max(...rowItems.map(([, h]) => h));
        rowItems.forEach(([w, h], j) => {
          places.push({
            item: items[start + j],
            x: pad + j * (cellW + gap) + alignOffset(cellW, w),
            y: y + alignOffset(rowH, h),
            w,
            h,
          });
        });
        y += rowH + gap;
      }
      W = cols * cellW + (cols - 1) * gap + 2 * pad;
      H = y - gap + pad;
    }
    return { W: Math.round(W), H: Math.round(H), places };
  }

  function drawItem(ctx, item, x, y, w, h) {
    const turn = item.turn || 0;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((turn * Math.PI) / 180);
    const sideways = turn % 180 !== 0;
    const dw = sideways ? h : w;
    const dh = sideways ? w : h;
    ctx.drawImage(item.image, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  function render(ctx, plan, s, k) {
    if (!s.transparent) {
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, plan.W * k, plan.H * k);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const p of plan.places) drawItem(ctx, p.item, p.x * k, p.y * k, p.w * k, p.h * k);
  }

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="stitchTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Stitch images</p>
              <h2 id="stitchTitle">Images</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="add">${T.icon(T.icons.plus, 16)}<span>Add images</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
          <div class="stitch-preview" data-slot="preview" hidden>
            <div class="section-label"><strong>Preview</strong><small data-slot="dims"></small></div>
            <div class="stitch-canvas-wrap"><canvas class="stitch-canvas" role="img" aria-label="Stitched result"></canvas></div>
          </div>
        </section>
        <section class="panel tool-controls" aria-labelledby="stitchSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="stitchSettingsTitle">Layout</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const preview = view.querySelector('[data-slot="preview"]');
    const dimsLabel = view.querySelector('[data-slot="dims"]');
    const canvas = view.querySelector(".stitch-canvas");
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const mode = T.segmented("stitch-mode", [
      { value: "row", label: "Side by side" },
      { value: "column", label: "Stacked" },
      { value: "grid", label: "Grid" },
    ], "row", "Direction");
    const modeField = T.el('<div class="field"><div class="field-label"><strong>Direction</strong></div></div>');
    modeField.appendChild(mode);
    const colsField = T.el(`
      <label class="field">
        <span class="field-label"><strong>Columns</strong></span>
        <input type="number" class="num-input" min="1" max="12" step="1" value="2" aria-label="Grid columns" />
      </label>`);
    const colsInput = colsField.querySelector("input");
    const matchField = T.el(`
      <label class="check-line"><input type="checkbox" checked /><span><strong>Make them line up</strong><small data-slot="match-note">Same height, scaled to the smallest so nothing gets blurry</small></span></label>`);
    const matchInput = matchField.querySelector("input");
    const matchNote = matchField.querySelector("small");
    const align = T.segmented("stitch-align", [
      { value: "start", label: "Start" },
      { value: "center", label: "Centre" },
      { value: "end", label: "End" },
    ], "center", "Alignment");
    const alignField = T.el('<div class="field"><div class="field-label"><strong>Align</strong><small>For images of different sizes</small></div></div>');
    alignField.appendChild(align);
    const gapField = T.el(`
      <label class="field range-field">
        <span class="field-label"><strong>Spacing</strong><output>0 px</output></span>
        <input type="range" min="0" max="80" step="1" value="0" aria-label="Spacing in pixels" />
      </label>`);
    const gapInput = gapField.querySelector("input");
    const gapOutput = gapField.querySelector("output");
    const outerField = T.el(`<label class="check-line"><input type="checkbox" /><span><strong>Spacing around the edges too</strong><small>Adds a frame of the same width</small></span></label>`);
    const outerInput = outerField.querySelector("input");
    const bgField = T.el(`
      <div class="field">
        <div class="field-label"><strong>Background</strong><small>Shows in gaps and around smaller images</small></div>
        <div class="color-line">
          <input type="color" value="#ffffff" aria-label="Background colour" />
          <label class="lock-label"><input type="checkbox" /> Transparent</label>
        </div>
      </div>`);
    const bgInput = bgField.querySelector('input[type="color"]');
    const transparentInput = bgField.querySelector('input[type="checkbox"]');
    const format = T.formatField("stitch");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download stitched image",
      onDownload: () => output().then((e) => e && T.download(e.blob, e.name)),
      onShare: () => output().then((e) => e && T.share([e], e.name)),
      onCompress: () => output().then((e) => e && T.sendToCompress([e])),
    });
    controls.append(modeField, colsField, matchField, alignField, gapField, outerField, bgField, format, summary, actions);

    const list = T.imageList({
      label: "Images to stitch, in order",
      rotate: true,
      figure: (item) => `<img class="stitch-thumb" src="${item.thumb}" alt="" style="transform:rotate(${item.turn || 0}deg)" />`,
      onChange: refresh,
    });
    const drop = T.dropzone({
      multiple: true,
      title: "Add images to join together",
      hint: "Drop two or more pictures here, tap to choose, or paste. Reorder them after.",
      onFiles: addFiles,
    });

    function settings() {
      return {
        mode: mode.value(),
        cols: CL.clamp(Math.round(Number(colsInput.value)) || 2, 1, 12),
        match: matchInput.checked,
        align: align.value(),
        gap: Number(gapInput.value),
        outer: outerInput.checked,
        background: bgInput.value,
        transparent: transparentInput.checked,
      };
    }

    function plan() {
      const s = settings();
      const p = layout(list.items, s);
      const k = T.fitScale(p.W, p.H);
      return { ...p, s, k };
    }

    function drawPreview(p) {
      const dpr = window.devicePixelRatio || 1;
      const maxW = Math.max(200, preview.clientWidth || slot.clientWidth);
      const maxH = Math.max(200, Math.min(560, window.innerHeight * 0.55));
      const k = Math.min(maxW / p.W, maxH / p.H, 1);
      canvas.style.width = `${Math.round(p.W * k)}px`;
      canvas.style.height = `${Math.round(p.H * k)}px`;
      canvas.width = Math.max(1, Math.round(p.W * k * dpr));
      canvas.height = Math.max(1, Math.round(p.H * k * dpr));
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      render(ctx, p, p.s, k * dpr);
    }

    function refresh() {
      const count = list.items.length;
      const s = settings();
      slot.textContent = "";
      slot.appendChild(count ? list.el : drop);
      clearButton.disabled = !count;
      colsField.hidden = s.mode !== "grid";
      alignField.hidden = s.match && s.mode !== "grid";
      gapOutput.value = `${s.gap} px`;
      bgInput.disabled = s.transparent;
      matchNote.textContent =
        s.mode === "row"
          ? "Same height, scaled to the smallest so nothing gets blurry"
          : s.mode === "column"
            ? "Same width, scaled to the narrowest so nothing gets blurry"
            : "Same width in every cell, scaled to the narrowest";
      format.setSource(list.items[0]?.file.type);
      const fmt = format.get();
      actions.setEnabled(count >= 1, { shareable: T.canShare([{ blob: new Blob([], { type: "image/png" }), name: "a.png" }]) });
      preview.hidden = !count;
      if (!count) {
        summary.textContent = "";
        return;
      }
      const p = plan();
      const outW = Math.round(p.W * p.k);
      const outH = Math.round(p.H * p.k);
      dimsLabel.textContent = `${outW} × ${outH} px`;
      const note = s.transparent && fmt.mime === "image/jpeg" ? " JPEG can't be transparent, so the background will be white." : "";
      summary.textContent = `${count} ${count === 1 ? "image" : "images"} → ${outW} × ${outH} px, saved as ${fmt.label}.${p.k < 1 ? " Scaled down to a size browsers can save." : ""}${note}`;
      drawPreview(p);
    }

    async function addFiles(files) {
      const items = await T.loadItems(files);
      if (items.length) list.add(items);
    }

    async function output() {
      if (!list.items.length) return null;
      const p = plan();
      const out = T.canvas(p.W * p.k, p.H * p.k);
      render(out.getContext("2d"), p, p.s, p.k);
      const fmt = format.get();
      try {
        const blob = await T.encode(out, fmt);
        return { blob, name: `${T.baseName(list.items[0].file.name)}-stitched.${fmt.ext}` };
      } catch (error) {
        CL.toast(error.message);
        return null;
      }
    }

    controls.addEventListener("change", refresh);
    controls.addEventListener("input", (event) => {
      if (event.target.matches('input[type="range"], input[type="number"], input[type="color"]')) refresh();
    });
    view.querySelector('[data-act="add"]').addEventListener("click", () => T.pickFiles({ multiple: true }, addFiles));
    clearButton.addEventListener("click", () => list.clear());
    new ResizeObserver(() => {
      if (list.items.length && !view.hidden) drawPreview(plan());
    }).observe(slot);

    refresh();
    return { addFiles, plan, output, list };
  }

  T.register({
    id: "stitch",
    name: "Stitch images",
    short: "Stitch",
    blurb: "Join pictures side by side, stacked, or in a grid, with optional spacing and background.",
    tags: ["Multiple images"],
    group: "combine",
    icon: '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>',
    create,
  });
})(window.CL = window.CL || {});
