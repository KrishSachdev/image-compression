// Collage: pick a template (grid or a featured/asymmetric layout) for 2–9
// photos, tap a cell to fill it, drag inside a cell to pan and use the zoom
// slider to zoom, then pick spacing, corner radius, background and an
// output size preset.
(function (CL) {
  "use strict";

  const T = CL.toolkit;

  const PRESETS = {
    square: { label: "Square (1080)", w: 1080, h: 1080 },
    portrait: { label: "4:5 (1080×1350)", w: 1080, h: 1350 },
    story: { label: "Story (1080×1920)", w: 1080, h: 1920 },
    custom: { label: "Custom", w: 1080, h: 1080 },
  };

  function gridCells(count) {
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cells = [];
    for (let r = 0; r < rows; r += 1) {
      const inRow = Math.min(cols, count - r * cols);
      const offset = (cols - inRow) / 2 / cols;
      for (let c = 0; c < inRow; c += 1) cells.push({ x: offset + c / cols, y: r / rows, w: 1 / cols, h: 1 / rows });
    }
    return cells;
  }

  const FEATURED = {
    3: [{ x: 0, y: 0, w: 0.55, h: 1 }, { x: 0.55, y: 0, w: 0.45, h: 0.5 }, { x: 0.55, y: 0.5, w: 0.45, h: 0.5 }],
    4: [{ x: 0, y: 0, w: 0.6, h: 1 }, { x: 0.6, y: 0, w: 0.4, h: 1 / 3 }, { x: 0.6, y: 1 / 3, w: 0.4, h: 1 / 3 }, { x: 0.6, y: 2 / 3, w: 0.4, h: 1 / 3 }],
    5: [{ x: 0, y: 0, w: 1, h: 0.55 }, { x: 0, y: 0.55, w: 0.25, h: 0.45 }, { x: 0.25, y: 0.55, w: 0.25, h: 0.45 }, { x: 0.5, y: 0.55, w: 0.25, h: 0.45 }, { x: 0.75, y: 0.55, w: 0.25, h: 0.45 }],
    7: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 1 / 3, h: 0.5 }, { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.25 }, { x: 1 / 3, y: 0.75, w: 1 / 3, h: 0.25 }, { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.25 }, { x: 2 / 3, y: 0.75, w: 1 / 3, h: 0.25 }],
  };

  const templatesFor = (count) => {
    const list = [{ id: "grid", label: "Grid", cells: gridCells(count) }];
    if (FEATURED[count]) list.push({ id: "featured", label: "Featured", cells: FEATURED[count] });
    return list;
  };

  function coverScale(cellW, cellH, imgW, imgH) {
    return Math.max(cellW / imgW, cellH / imgH);
  }

  // Absolute pixel geometry for one cell: outer rect, and the (clamped) draw
  // rect for its photo given zoom + normalized pan (-1..1).
  function cellGeometry(cellUnit, W, H, spacing, slot) {
    const outer = { x: cellUnit.x * W, y: cellUnit.y * H, w: cellUnit.w * W, h: cellUnit.h * H };
    const rect = { x: outer.x + spacing / 2, y: outer.y + spacing / 2, w: Math.max(1, outer.w - spacing), h: Math.max(1, outer.h - spacing) };
    let draw = null;
    if (slot && slot.item) {
      const zoom = slot.zoom || 1;
      const base = coverScale(rect.w, rect.h, slot.item.width, slot.item.height);
      const scale = base * zoom;
      const dw = slot.item.width * scale;
      const dh = slot.item.height * scale;
      const maxPanX = Math.max(0, (dw - rect.w) / 2);
      const maxPanY = Math.max(0, (dh - rect.h) / 2);
      const cx = rect.x + rect.w / 2 + (slot.nx || 0) * maxPanX;
      const cy = rect.y + rect.h / 2 + (slot.ny || 0) * maxPanY;
      draw = { dw, dh, x: cx - dw / 2, y: cy - dh / 2, maxPanX, maxPanY };
    }
    return { outer, rect, draw };
  }

  function roundedPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    r = Math.min(r, w / 2, h / 2);
    if (r <= 0.5) {
      ctx.rect(x, y, w, h);
      return;
    }
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  function render(ctx, cells, slots, s, W, H, { selected = -1, placeholders = false } = {}) {
    ctx.save();
    if (!s.transparent) {
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, W, H);
    } else ctx.clearRect(0, 0, W, H);
    cells.forEach((cellUnit, i) => {
      const slot = slots[i];
      const g = cellGeometry(cellUnit, W, H, s.spacing, slot);
      const r = s.radius;
      if (slot && slot.item) {
        ctx.save();
        roundedPath(ctx, g.rect.x, g.rect.y, g.rect.w, g.rect.h, r);
        ctx.clip();
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(slot.item.image, g.draw.x, g.draw.y, g.draw.dw, g.draw.dh);
        ctx.restore();
      } else if (placeholders) {
        ctx.save();
        roundedPath(ctx, g.rect.x, g.rect.y, g.rect.w, g.rect.h, r);
        ctx.fillStyle = "#00000014";
        ctx.fill();
        ctx.strokeStyle = "#00000033";
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        const cx = g.rect.x + g.rect.w / 2;
        const cy = g.rect.y + g.rect.h / 2;
        const s2 = Math.min(g.rect.w, g.rect.h) * 0.12;
        ctx.setLineDash([]);
        ctx.strokeStyle = "#00000066";
        ctx.lineWidth = Math.max(2, s2 * 0.18);
        ctx.beginPath();
        ctx.moveTo(cx - s2, cy);
        ctx.lineTo(cx + s2, cy);
        ctx.moveTo(cx, cy - s2);
        ctx.lineTo(cx, cy + s2);
        ctx.stroke();
        ctx.restore();
      }
      if (placeholders && i === selected) {
        ctx.save();
        roundedPath(ctx, g.rect.x, g.rect.y, g.rect.w, g.rect.h, r);
        ctx.lineWidth = Math.max(3, Math.min(W, H) * 0.006);
        ctx.strokeStyle = "#2aa198";
        ctx.stroke();
        ctx.restore();
      }
    });
    ctx.restore();
  }

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="collageTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Collage</p>
              <h2 id="collageTitle">Layout</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="add">${T.icon(T.icons.plus, 16)}<span>Add photos</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage">
            <div class="stitch-canvas-wrap"><canvas class="stitch-canvas collage-canvas" role="img" aria-label="Collage preview, tap a cell to add or select a photo"></canvas></div>
          </div>
          <p class="tool-hint">Tap an empty cell to add a photo. Tap a filled cell to select it, then drag on it to pan and use the zoom slider.</p>
        </section>
        <section class="panel tool-controls" aria-labelledby="collageSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="collageSettingsTitle">Template</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const canvas = view.querySelector(".collage-canvas");
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const countField = T.el(`
      <label class="field">
        <span class="field-label"><strong>Photos</strong></span>
        <input type="number" class="num-input" min="2" max="9" step="1" value="4" aria-label="Number of photos" />
      </label>`);
    const countInput = countField.querySelector("input");
    const templateField = T.el('<div class="field"><div class="field-label"><strong>Template</strong></div></div>');
    let template = T.segmented("collage-template", [{ value: "grid", label: "Grid" }], "grid", "Template");
    templateField.appendChild(template);

    const presetField = T.el('<div class="field"><div class="field-label"><strong>Output size</strong></div></div>');
    const preset = T.segmented("collage-preset", Object.entries(PRESETS).map(([v, p]) => ({ value: v, label: p.label.split(" ")[0] })), "square", "Output size");
    presetField.appendChild(preset);
    const customField = T.el(`
      <div class="field" data-slot="custom" hidden>
        <span class="field-label"><strong>Custom size</strong></span>
        <div class="exact-inputs">
          <input type="number" min="100" max="6000" step="1" value="1080" data-c="w" aria-label="Custom width" />
          <span aria-hidden="true">×</span>
          <input type="number" min="100" max="6000" step="1" value="1080" data-c="h" aria-label="Custom height" />
        </div>
      </div>`);

    const selectedField = T.el(`
      <div class="field" data-slot="selected" hidden>
        <div class="field-label"><strong>Selected photo</strong></div>
        <label class="range-field">
          <span class="field-label"><small>Zoom</small><output>100%</output></span>
          <input type="range" min="100" max="300" step="1" value="100" aria-label="Zoom selected photo" />
        </label>
        <div class="button-row">
          <button type="button" class="ghost-button" data-act="replace">Replace photo</button>
          <button type="button" class="ghost-button" data-act="reset-cell">Reset pan/zoom</button>
        </div>
      </div>`);
    const zoomInput = selectedField.querySelector('input[type="range"]');

    const spacingField = T.el(`
      <label class="field range-field">
        <span class="field-label"><strong>Spacing</strong><output>10 px</output></span>
        <input type="range" min="0" max="60" step="1" value="10" aria-label="Spacing in pixels" />
      </label>`);
    const spacingInput = spacingField.querySelector("input");
    const radiusField = T.el(`
      <label class="field range-field">
        <span class="field-label"><strong>Corner radius</strong><output>0 px</output></span>
        <input type="range" min="0" max="80" step="1" value="0" aria-label="Corner radius in pixels" />
      </label>`);
    const radiusInput = radiusField.querySelector("input");
    const bgField = T.el(`
      <div class="field">
        <div class="field-label"><strong>Background</strong></div>
        <div class="color-line">
          <input type="color" value="#ffffff" aria-label="Background colour" />
          <label class="lock-label"><input type="checkbox" /> Transparent</label>
        </div>
      </div>`);
    const bgInput = bgField.querySelector('input[type="color"]');
    const transparentInput = bgField.querySelector('input[type="checkbox"]');
    const format = T.formatField("collage", { initial: "image/jpeg" });
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download collage",
      onDownload: () => output().then((e) => e && T.download(e.blob, e.name)),
      onShare: () => output().then((e) => e && T.share([e], e.name)),
      onCompress: () => output().then((e) => e && T.sendToCompress([e])),
    });
    controls.append(countField, templateField, presetField, customField, spacingField, radiusField, bgField, selectedField, format, summary, actions);

    let slots = [null, null, null, null];
    let selected = -1;

    function count() {
      return CL.clamp(Math.round(Number(countInput.value)) || 4, 2, 9);
    }
    function currentTemplate() {
      const list = templatesFor(count());
      return list.find((t) => t.id === template.value()) || list[0];
    }
    function outputSize() {
      const p = preset.value();
      if (p === "custom") {
        const w = CL.clamp(Math.round(Number(customField.querySelector('[data-c="w"]').value)) || 1080, 100, 6000);
        const h = CL.clamp(Math.round(Number(customField.querySelector('[data-c="h"]').value)) || 1080, 100, 6000);
        return { w, h };
      }
      return { w: PRESETS[p].w, h: PRESETS[p].h };
    }
    function settings() {
      return { spacing: Number(spacingInput.value), radius: Number(radiusInput.value), background: bgInput.value, transparent: transparentInput.checked };
    }

    function syncSlotsLength() {
      const n = count();
      while (slots.length < n) slots.push(null);
      slots.length = n;
      if (selected >= n) selected = -1;
    }

    function rebuildTemplateOptions() {
      const list = templatesFor(count());
      const current = template.value();
      const wrap = T.segmented("collage-template", list.map((t) => ({ value: t.id, label: t.label })), list.some((t) => t.id === current) ? current : "grid", "Template");
      template.replaceWith(wrap);
      template = wrap;
    }

    function previewScale() {
      const { w, h } = outputSize();
      const dpr = window.devicePixelRatio || 1;
      const maxW = Math.max(200, slot.clientWidth - 4);
      const maxH = Math.max(200, Math.min(600, window.innerHeight * 0.6));
      const k = Math.min(maxW / w, maxH / h, 1);
      canvas.style.width = `${Math.round(w * k)}px`;
      canvas.style.height = `${Math.round(h * k)}px`;
      canvas.width = Math.max(1, Math.round(w * k * dpr));
      canvas.height = Math.max(1, Math.round(h * k * dpr));
      return { w, h, k: (k * dpr * w) / w, pxPerOut: (canvas.width / w) };
    }

    function draw() {
      const { w, h } = outputSize();
      const pxPerOut = canvas.width / w;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(pxPerOut, 0, 0, pxPerOut, 0, 0);
      ctx.clearRect(0, 0, w, h);
      render(ctx, currentTemplate().cells, slots, settings(), w, h, { selected, placeholders: true });
    }

    function refresh() {
      syncSlotsLength();
      customField.hidden = preset.value() !== "custom";
      spacingField.querySelector("output").textContent = `${spacingInput.value} px`;
      radiusField.querySelector("output").textContent = `${radiusInput.value} px`;
      bgInput.disabled = transparentInput.checked;
      const filled = slots.filter(Boolean).length;
      selectedField.hidden = selected < 0 || !slots[selected];
      if (!selectedField.hidden) zoomInput.value = Math.round((slots[selected].zoom || 1) * 100);
      selectedField.querySelector("output").textContent = `${zoomInput.value}%`;
      clearButton.disabled = filled === 0;
      const shareableBlob = { blob: new Blob([], { type: "image/png" }), name: "a.png" };
      actions.setEnabled(filled > 0, { shareable: T.canShare([shareableBlob]) });
      const { w, h } = outputSize();
      summary.textContent = filled ? `${filled} of ${count()} cells filled. Output ${w} × ${h} px, saved as ${format.get().label}.` : `Choose ${count()} photos to fill the template.`;
      previewScale();
      draw();
    }

    function assign(index, item) {
      T.releaseItem(slots[index]?.item);
      slots[index] = { item, zoom: 1, nx: 0, ny: 0 };
      selected = index;
      refresh();
    }

    async function addFiles(files) {
      const items = await T.loadItems(files);
      if (!items.length) return;
      let i = 0;
      for (const item of items) {
        while (i < slots.length && slots[i]) i += 1;
        if (i >= slots.length) {
          T.releaseItem(item);
          continue;
        }
        slots[i] = { item, zoom: 1, nx: 0, ny: 0 };
      }
      refresh();
    }

    function hitCell(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      const u = (clientX - box.left) / box.width;
      const v = (clientY - box.top) / box.height;
      const cells = currentTemplate().cells;
      for (let i = 0; i < cells.length; i += 1) {
        const c = cells[i];
        if (u >= c.x && u <= c.x + c.w && v >= c.y && v <= c.y + c.h) return i;
      }
      return -1;
    }

    let drag = null;
    canvas.addEventListener("pointerdown", (event) => {
      const idx = hitCell(event.clientX, event.clientY);
      if (idx < 0) return;
      if (!slots[idx]) {
        T.pickFiles({}, (files) => addFilesReplace(idx, files));
        return;
      }
      selected = idx;
      const { w } = outputSize();
      const box = canvas.getBoundingClientRect();
      drag = { idx, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, nx: slots[idx].nx, ny: slots[idx].ny, pxPerOut: box.width / w };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic pointer */
      }
      refresh();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const slotData = slots[drag.idx];
      if (!slotData) return;
      const cellUnit = currentTemplate().cells[drag.idx];
      const { w, h } = outputSize();
      const g = cellGeometry(cellUnit, w, h, settings().spacing, slotData);
      const deltaOutX = (event.clientX - drag.startX) / drag.pxPerOut;
      const deltaOutY = (event.clientY - drag.startY) / drag.pxPerOut;
      slotData.nx = g.draw.maxPanX > 0 ? CL.clamp(drag.nx + deltaOutX / g.draw.maxPanX, -1, 1) : 0;
      slotData.ny = g.draw.maxPanY > 0 ? CL.clamp(drag.ny + deltaOutY / g.draw.maxPanY, -1, 1) : 0;
      draw();
    });
    const endDrag = (event) => {
      if (drag && event.pointerId === drag.pointerId) drag = null;
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    async function output() {
      const { w, h } = outputSize();
      const out = T.canvas(w, h);
      render(out.getContext("2d"), currentTemplate().cells, slots, settings(), w, h, { placeholders: false });
      const fmt = format.get();
      try {
        const blob = await T.encode(out, fmt);
        return { blob, name: `collage.${fmt.ext}` };
      } catch (error) {
        CL.toast(error.message);
        return null;
      }
    }

    countInput.addEventListener("change", () => {
      rebuildTemplateOptions();
      refresh();
    });
    controls.addEventListener("change", (event) => {
      if (event.target.closest('[name="collage-template"]')) {
        refresh();
        return;
      }
      refresh();
    });
    controls.addEventListener("input", (event) => {
      if (event.target === zoomInput && selected >= 0 && slots[selected]) {
        slots[selected].zoom = Number(zoomInput.value) / 100;
        const cellUnit = currentTemplate().cells[selected];
        const { w, h } = outputSize();
        const g = cellGeometry(cellUnit, w, h, settings().spacing, slots[selected]);
        slots[selected].nx = g.draw.maxPanX > 0 ? CL.clamp(slots[selected].nx, -1, 1) : 0;
        slots[selected].ny = g.draw.maxPanY > 0 ? CL.clamp(slots[selected].ny, -1, 1) : 0;
        refresh();
        return;
      }
      if (event.target.matches('input[type="range"], input[type="color"], input[type="number"]')) refresh();
    });
    selectedField.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-act]");
      if (!btn || selected < 0) return;
      if (btn.dataset.act === "replace") T.pickFiles({}, (files) => addFilesReplace(selected, files));
      if (btn.dataset.act === "reset-cell" && slots[selected]) {
        slots[selected].zoom = 1;
        slots[selected].nx = 0;
        slots[selected].ny = 0;
        refresh();
      }
    });
    async function addFilesReplace(index, files) {
      const [item] = await T.loadItems(T.imageFiles(files).slice(0, 1));
      if (item) assign(index, item);
    }
    view.querySelector('[data-act="add"]').addEventListener("click", () => T.pickFiles({ multiple: true }, addFiles));
    clearButton.addEventListener("click", () => {
      slots.forEach((s) => T.releaseItem(s?.item));
      slots = slots.map(() => null);
      selected = -1;
      refresh();
    });
    new ResizeObserver(() => refresh()).observe(slot);

    rebuildTemplateOptions();
    refresh();
    return { addFiles, onShow: refresh, output };
  }

  T.register({
    id: "collage",
    name: "Collage",
    short: "Collage",
    blurb: "Arrange 2–9 photos in a grid or a featured layout. Pan and zoom each photo, then export at a preset size.",
    tags: ["Multiple images", "Instagram"],
    group: "combine",
    icon: '<rect x="3" y="3" width="8" height="18" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    create,
  });
})(window.CL = window.CL || {});
