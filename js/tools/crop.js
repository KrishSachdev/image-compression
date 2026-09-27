// Crop: draw or drag a crop box on the picture, with aspect presets for
// common posts and screens, exact pixel inputs, and rotate / flip.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const RATIOS = [
    { value: "free", label: "Free" },
    { value: "original", label: "Original" },
    { value: "1:1", label: "1:1" },
    { value: "4:5", label: "4:5" },
    { value: "3:4", label: "3:4" },
    { value: "2:3", label: "2:3" },
    { value: "9:16", label: "9:16" },
    { value: "16:9", label: "16:9" },
    { value: "4:3", label: "4:3" },
    { value: "3:2", label: "3:2" },
  ];

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="cropTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Crop</p>
              <h2 id="cropTitle">Picture</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="change">${T.icon(T.icons.upload, 16)}<span>Choose image</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
          <p class="tool-hint" data-slot="hint" hidden>Drag the box to move it, drag a corner to resize, or drag on the picture to draw a new box. With the box focused, arrow keys nudge it (Shift = 10 px, Alt = resize).</p>
        </section>
        <section class="panel tool-controls" aria-labelledby="cropSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="cropSettingsTitle">Crop box</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const hint = view.querySelector('[data-slot="hint"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const ratio = T.segmented("crop-ratio", RATIOS, "free", "Aspect ratio");
    ratio.classList.add("seg-wrap");
    const ratioField = T.el(`<div class="field"><div class="field-label"><strong>Shape</strong><small>1:1 and 4:5 for posts, 9:16 for stories, 16:9 for video</small></div></div>`);
    ratioField.appendChild(ratio);

    const sizeField = T.el(`
      <div class="field">
        <div class="field-label"><strong>Size</strong><small>In pixels</small></div>
        <div class="grid-inputs">
          <label><span>Width</span><input type="number" class="num-input" min="1" step="1" data-dim="w" /></label>
          <span aria-hidden="true">×</span>
          <label><span>Height</span><input type="number" class="num-input" min="1" step="1" data-dim="h" /></label>
        </div>
      </div>`);
    const wInput = sizeField.querySelector('[data-dim="w"]');
    const hInput = sizeField.querySelector('[data-dim="h"]');

    const turnField = T.el(`
      <div class="field">
        <div class="field-label"><strong>Rotate and flip</strong></div>
        <div class="button-row" role="group" aria-label="Rotate and flip">
          <button type="button" class="ghost-button" data-turn="left" title="Rotate 90° left">${T.icon('<path d="M3 12a9 9 0 1 0 2.64-6.36"/><path d="M3 3v6h6"/>', 16)}<span>Left</span></button>
          <button type="button" class="ghost-button" data-turn="right" title="Rotate 90° right">${T.icon(T.icons.rotate, 16)}<span>Right</span></button>
          <button type="button" class="ghost-button" data-turn="fliph" title="Flip horizontally">${T.icon('<path d="M8 7 4 12l4 5"/><path d="m16 7 4 5-4 5"/><path d="M12 3v18"/>', 16)}<span>Flip</span></button>
          <button type="button" class="ghost-button" data-turn="reset" title="Undo all changes">Reset</button>
        </div>
      </div>`);

    const format = T.formatField("crop");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download cropped image",
      onDownload: () => output().then((e) => e && T.download(e.blob, e.name)),
      onShare: () => output().then((e) => e && T.share([e], e.name)),
      onCompress: () => output().then((e) => e && T.sendToCompress([e])),
    });
    controls.append(ratioField, sizeField, turnField, format, summary, actions);

    const stage = CL.editorStage({ label: "Picture to crop" });
    const editor = CL.rectEditor(stage.frame, {
      aspect: () => currentRatio(),
      onChange: () => syncInfo(),
      label: (r) => `Crop box, ${r.w} by ${r.h} pixels. Arrow keys move it.`,
    });
    stage.onFit = draw;

    const drop = T.dropzone({
      title: "Choose an image to crop",
      hint: "Drop a photo or screenshot here, tap to choose, or paste.",
      onFiles: addFiles,
    });

    let item = null;
    let work = null; // the picture after rotate/flip, full size
    let turn = 0;
    let flip = false;

    function currentRatio() {
      const value = ratio.value();
      if (value === "free" || !work) return 0;
      if (value === "original") return work.width / work.height;
      const [a, b] = value.split(":").map(Number);
      return a / b;
    }

    function buildWork() {
      const src = item.image;
      const sideways = turn % 180 !== 0;
      const canvas = T.canvas(sideways ? item.height : item.width, sideways ? item.width : item.height);
      const ctx = canvas.getContext("2d");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((turn * Math.PI) / 180);
      ctx.scale(flip ? -1 : 1, 1);
      ctx.drawImage(src, -item.width / 2, -item.height / 2, item.width, item.height);
      work = canvas;
      editor.setSize(work.width, work.height);
      stage.fit(work.width, work.height);
    }

    function draw() {
      if (!work) return;
      const ctx = stage.canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, stage.canvas.width, stage.canvas.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(work, 0, 0, stage.canvas.width, stage.canvas.height);
    }

    function resetBox() {
      const r = currentRatio();
      const b = r ? editor.fitRatio(r) : { x: 0, y: 0, w: work.width, h: work.height };
      editor.setRects([{ ...b, id: "crop" }], "crop");
    }

    function box() {
      return editor.rects[0] || null;
    }

    function syncInfo() {
      const b = box();
      if (!b) return;
      if (document.activeElement !== wInput) wInput.value = b.w;
      if (document.activeElement !== hInput) hInput.value = b.h;
      wInput.max = work.width;
      hInput.max = work.height;
      const full = b.w === work.width && b.h === work.height;
      summary.textContent = full
        ? `Whole picture, ${b.w} × ${b.h} px. Draw or drag the box to crop.`
        : `Crop ${b.w} × ${b.h} px from ${work.width} × ${work.height}, starting ${b.x}, ${b.y}. Saved as ${format.get().label}.`;
    }

    function refresh() {
      slot.textContent = "";
      slot.appendChild(item ? stage.el : drop);
      hint.hidden = !item;
      clearButton.disabled = !item;
      actions.setEnabled(Boolean(item), { shareable: item && T.canShare([{ blob: new Blob([], { type: "image/png" }), name: "a.png" }]) });
      turnField.querySelectorAll("button").forEach((b) => (b.disabled = !item));
      wInput.disabled = hInput.disabled = !item;
      if (!item) {
        summary.textContent = "";
        wInput.value = hInput.value = "";
        return;
      }
      stage.fit(work.width, work.height);
      syncInfo();
    }

    async function addFiles(files) {
      const [next] = await T.loadItems(T.imageFiles(files).slice(0, 1));
      if (!next) return;
      T.releaseItem(item);
      item = next;
      turn = 0;
      flip = false;
      format.setSource(item.file.type);
      buildWork();
      resetBox();
      refresh();
    }

    async function output() {
      const b = box();
      if (!item || !b) return null;
      const canvas = T.canvas(b.w, b.h);
      canvas.getContext("2d").drawImage(work, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      const fmt = format.get();
      try {
        const blob = await T.encode(canvas, fmt);
        return { blob, name: `${T.baseName(item.file.name)}-cropped.${fmt.ext}` };
      } catch (error) {
        CL.toast(error.message);
        return null;
      }
    }

    ratio.addEventListener("change", () => {
      if (!work) return;
      const r = currentRatio();
      const b = box();
      if (r && b) {
        editor.setRects([{ ...editor.fitRatio(r, b.x + b.w / 2, b.y + b.h / 2), id: "crop" }], "crop");
      }
      syncInfo();
    });

    function setDim(which) {
      const b = box();
      if (!b) return;
      const r = currentRatio();
      let w = CL.clamp(Math.round(Number(wInput.value)) || b.w, 1, work.width);
      let h = CL.clamp(Math.round(Number(hInput.value)) || b.h, 1, work.height);
      if (r) {
        if (which === "w") h = Math.round(w / r);
        else w = Math.round(h * r);
        if (h > work.height) {
          h = work.height;
          w = Math.round(h * r);
        }
        if (w > work.width) {
          w = work.width;
          h = Math.round(w / r);
        }
      }
      editor.update("crop", { w, h, x: Math.min(b.x, work.width - w), y: Math.min(b.y, work.height - h) });
    }
    wInput.addEventListener("change", () => setDim("w"));
    hInput.addEventListener("change", () => setDim("h"));
    wInput.addEventListener("input", () => wInput.value && setDim("w"));
    hInput.addEventListener("input", () => hInput.value && setDim("h"));

    turnField.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-turn]");
      if (!button || !item) return;
      const act = button.dataset.turn;
      if (act === "left") turn = (turn + 270) % 360;
      if (act === "right") turn = (turn + 90) % 360;
      if (act === "fliph") flip = !flip;
      if (act === "reset") {
        turn = 0;
        flip = false;
        ratio.set("free");
      }
      buildWork();
      resetBox();
      syncInfo();
    });
    format.addEventListener("formatchange", syncInfo);
    view.querySelector('[data-act="change"]').addEventListener("click", () => T.pickFiles({}, addFiles));
    clearButton.addEventListener("click", () => {
      T.releaseItem(item);
      item = null;
      work = null;
      editor.clear();
      refresh();
    });

    refresh();
    return {
      addFiles,
      onShow: () => work && stage.fit(),
      box,
      output,
      editor,
    };
  }

  T.register({
    id: "crop",
    name: "Crop",
    short: "Crop",
    blurb: "Cut out part of a picture. Shapes for posts (1:1, 4:5), stories (9:16) and video (16:9), plus rotate and flip.",
    tags: ["Presets"],
    group: "edit",
    icon: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    create,
  });
})(window.CL = window.CL || {});
