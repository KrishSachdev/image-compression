// Hide details: draw boxes over faces, names, numbers or addresses, and each
// box is covered with a solid block, pixelated or blurred. The saved image is
// re-drawn from scratch, so it also carries no metadata.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const EFFECTS = [
    { value: "box", label: "Solid box" },
    { value: "pixelate", label: "Pixelate" },
    { value: "blur", label: "Blur" },
  ];

  // Size of a pixel block (source px) for a strength of 1–100.
  const blockSize = (w, h, strength) => Math.max(3, Math.round(Math.max(w, h) / (160 - strength * 1.4)));

  // Cover each rect of `source` on ctx. `scale` maps source px → ctx px.
  function applyEffects(ctx, source, rects, scale, strength, W, H) {
    const block = blockSize(W, H, strength);
    for (const r of rects) {
      const dx = r.x * scale;
      const dy = r.y * scale;
      const dw = r.w * scale;
      const dh = r.h * scale;
      if (r.effect === "box") {
        ctx.fillStyle = r.color || "#000000";
        ctx.fillRect(dx, dy, dw, dh);
        continue;
      }
      const tw = Math.max(1, Math.round(r.w / (r.effect === "blur" ? block * 1.6 : block)));
      const th = Math.max(1, Math.round(r.h / (r.effect === "blur" ? block * 1.6 : block)));
      const tiny = T.canvas(tw, th);
      const tctx = tiny.getContext("2d");
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = "high";
      tctx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, tw, th);
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx, dy, dw, dh);
      ctx.clip();
      if (r.effect === "pixelate") {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tiny, dx, dy, dw, dh);
      } else {
        // Blur: go up in two smooth steps so edges look soft, not blocky.
        const mid = T.canvas(Math.min(tw * 4, Math.max(1, Math.round(dw))), Math.min(th * 4, Math.max(1, Math.round(dh))));
        const mctx = mid.getContext("2d");
        mctx.imageSmoothingEnabled = true;
        mctx.imageSmoothingQuality = "high";
        mctx.drawImage(tiny, 0, 0, mid.width, mid.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(mid, dx, dy, dw, dh);
      }
      ctx.restore();
    }
  }

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="redactTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Hide details</p>
              <h2 id="redactTitle">Picture</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="change">${T.icon(T.icons.upload, 16)}<span>Choose image</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
          <p class="tool-hint" data-slot="hint" hidden>Drag on the picture to cover an area. Tap a box to select it, then move it, drag its corners, change its effect or delete it. Tap empty space to deselect.</p>
        </section>
        <section class="panel tool-controls" aria-labelledby="redactSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="redactSettingsTitle">Cover with</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const hint = view.querySelector('[data-slot="hint"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const effect = T.segmented("redact-effect", EFFECTS, "box", "Effect");
    const effectField = T.el(`<div class="field"><div class="field-label"><strong>Effect</strong><small data-slot="effect-note">Used for the next box you draw</small></div></div>`);
    effectField.appendChild(effect);
    const colorField = T.el(`
      <label class="field color-field">
        <span class="field-label"><strong>Box colour</strong></span>
        <input type="color" value="#000000" aria-label="Box colour" />
      </label>`);
    const colorInput = colorField.querySelector("input");
    const strengthField = T.el(`
      <label class="field range-field">
        <span class="field-label"><strong>Strength</strong><output>60</output></span>
        <input type="range" min="10" max="100" step="1" value="60" aria-label="Pixelate and blur strength" />
      </label>`);
    const strengthInput = strengthField.querySelector("input");
    const strengthOutput = strengthField.querySelector("output");
    const boxButtons = T.el(`
      <div class="button-row">
        <button type="button" class="ghost-button" data-box="delete" disabled>Delete box</button>
        <button type="button" class="ghost-button" data-box="all" disabled>Remove all boxes</button>
      </div>`);
    const warn = T.el(`<p class="field-note warn-note">For passwords, card or ID numbers, use <strong>Solid box</strong>. Blur and pixelate can sometimes be partly undone.</p>`);
    const format = T.formatField("redact");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download image",
      onDownload: () => output().then((e) => e && T.download(e.blob, e.name)),
      onShare: () => output().then((e) => e && T.share([e], e.name)),
      onCompress: () => output().then((e) => e && T.sendToCompress([e])),
    });
    controls.append(effectField, colorField, strengthField, boxButtons, warn, format, summary, actions);

    const stage = CL.editorStage({ label: "Picture with hidden areas" });
    const editor = CL.rectEditor(stage.frame, {
      multi: true,
      selectNew: false,
      defaults: () => ({ effect: effect.value(), color: colorInput.value }),
      onChange: () => {
        draw();
        sync();
      },
      onSelect: (r) => {
        if (r) {
          effect.set(r.effect);
          if (r.color) colorInput.value = r.color;
        }
        sync();
      },
      label: (r) => `${EFFECTS.find((e) => e.value === r.effect)?.label || "Box"}, ${r.w} by ${r.h} pixels. Delete removes it.`,
    });
    stage.onFit = draw;

    const drop = T.dropzone({
      title: "Choose an image to hide details in",
      hint: "Drop a screenshot or photo here, tap to choose, or paste. Then drag over anything you want hidden.",
      onFiles: addFiles,
    });

    let item = null;

    function strength() {
      return Number(strengthInput.value);
    }

    function draw() {
      if (!item) return;
      const ctx = stage.canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, stage.canvas.width, stage.canvas.height);
      ctx.drawImage(item.image, 0, 0, stage.canvas.width, stage.canvas.height);
      applyEffects(ctx, item.image, editor.rects, stage.scale, strength(), item.width, item.height);
    }

    const effectNote = effectField.querySelector('[data-slot="effect-note"]');

    function sync() {
      const count = editor.rects.length;
      const sel = editor.selected;
      effectNote.textContent = sel ? "Changing the selected box" : "Used for the next box you draw";
      boxButtons.querySelector('[data-box="delete"]').disabled = !sel;
      boxButtons.querySelector('[data-box="all"]').disabled = !count;
      colorField.hidden = effect.value() !== "box";
      strengthField.hidden = effect.value() === "box";
      strengthOutput.value = strengthInput.value;
      actions.setEnabled(Boolean(item), { shareable: item && T.canShare([{ blob: new Blob([], { type: "image/png" }), name: "a.png" }]) });
      if (!item) {
        summary.textContent = "";
        return;
      }
      summary.textContent = count
        ? `${count} ${count === 1 ? "area" : "areas"} hidden. Saved as ${format.get().label}, with no metadata.`
        : "Drag on the picture to cover something.";
    }

    function refresh() {
      slot.textContent = "";
      slot.appendChild(item ? stage.el : drop);
      hint.hidden = !item;
      clearButton.disabled = !item;
      if (item) stage.fit(item.width, item.height);
      sync();
    }

    async function addFiles(files) {
      const [next] = await T.loadItems(T.imageFiles(files).slice(0, 1));
      if (!next) return;
      T.releaseItem(item);
      item = next;
      format.setSource(item.file.type);
      editor.setSize(item.width, item.height);
      editor.clear();
      refresh();
    }

    async function output() {
      if (!item) return null;
      const canvas = T.canvas(item.width, item.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(item.image, 0, 0);
      applyEffects(ctx, item.image, editor.rects, 1, strength(), item.width, item.height);
      const fmt = format.get();
      try {
        const blob = await T.encode(canvas, fmt);
        return { blob, name: `${T.baseName(item.file.name)}-hidden.${fmt.ext}` };
      } catch (error) {
        CL.toast(error.message);
        return null;
      }
    }

    effect.addEventListener("change", () => {
      const sel = editor.selected;
      if (sel) editor.update(sel.id, { effect: effect.value() });
      sync();
    });
    colorInput.addEventListener("input", () => {
      const sel = editor.selected;
      if (sel && sel.effect === "box") editor.update(sel.id, { color: colorInput.value });
    });
    strengthInput.addEventListener("input", () => {
      draw();
      sync();
    });
    boxButtons.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-box]");
      if (!button) return;
      if (button.dataset.box === "delete" && editor.selected) editor.remove(editor.selected.id);
      if (button.dataset.box === "all") editor.clear();
      sync();
    });
    format.addEventListener("formatchange", sync);
    view.querySelector('[data-act="change"]').addEventListener("click", () => T.pickFiles({}, addFiles));
    clearButton.addEventListener("click", () => {
      T.releaseItem(item);
      item = null;
      editor.clear();
      refresh();
    });

    refresh();
    return { addFiles, onShow: () => item && stage.fit(), editor, output };
  }

  T.register({
    id: "redact",
    name: "Hide details",
    short: "Hide details",
    blurb: "Cover faces, names, numbers or addresses with a solid box, pixelation or blur before you share.",
    tags: ["Privacy"],
    group: "privacy",
    icon: '<path d="M9.9 4.2A10 10 0 0 1 12 4c7 0 10 8 10 8a17 17 0 0 1-2.2 3.3"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    create,
  });
})(window.CL = window.CL || {});
