// Frame: fit a whole photo into a square / 4:5 / story canvas without
// cropping, on a colour, blurred-photo or transparent background, with a
// border, rounded corners and an optional shadow.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const SHAPES = { original: 0, "1:1": 1, "4:5": 4 / 5, "9:16": 9 / 16, "16:9": 16 / 9, "3:4": 3 / 4 };

  function plan(item, s) {
    const w = item.width;
    const h = item.height;
    const pad = Math.round((Math.min(w, h) * s.border) / 100);
    let CW = w + 2 * pad;
    let CH = h + 2 * pad;
    const r = SHAPES[s.shape];
    if (r) {
      if (CW / CH < r) CW = Math.round(CH * r);
      else CH = Math.round(CW / r);
    }
    const k = T.fitScale(CW, CH);
    return {
      W: Math.max(1, Math.round(CW * k)),
      H: Math.max(1, Math.round(CH * k)),
      box: { x: ((CW - w) / 2) * k, y: ((CH - h) / 2) * k, w: w * k, h: h * k },
      radius: ((Math.min(w, h) / 2) * s.corners * k) / 100,
      k,
    };
  }

  function roundedPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (r <= 0) {
      ctx.rect(x, y, w, h);
      return;
    }
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Draw the framed picture onto ctx at scale `z` (1 = full size).
  function render(ctx, item, p, s, z) {
    const W = p.W * z;
    const H = p.H * z;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (s.bg === "color") {
      ctx.fillStyle = s.color;
      ctx.fillRect(0, 0, W, H);
    } else if (s.bg === "blur") {
      // Cover-fit a tiny copy, then stretch it: a strong, even blur that
      // works in every browser (no canvas filter needed).
      const cover = Math.max(W / item.width, H / item.height);
      const tw = Math.max(1, Math.round((item.width * cover) / 40));
      const th = Math.max(1, Math.round((item.height * cover) / 40));
      const tiny = T.canvas(tw, th);
      tiny.getContext("2d").drawImage(item.image, 0, 0, tw, th);
      const mid = T.canvas(tw * 4, th * 4);
      const mctx = mid.getContext("2d");
      mctx.imageSmoothingQuality = "high";
      mctx.drawImage(tiny, 0, 0, mid.width, mid.height);
      const dw = item.width * cover;
      const dh = item.height * cover;
      ctx.drawImage(mid, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
      ctx.fillRect(0, 0, W, H);
    }
    const x = p.box.x * z;
    const y = p.box.y * z;
    const w = p.box.w * z;
    const h = p.box.h * z;
    const r = p.radius * z;
    if (s.shadow) {
      ctx.save();
      const m = Math.min(w, h);
      ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
      ctx.shadowBlur = m * 0.06;
      ctx.shadowOffsetY = m * 0.02;
      roundedPath(ctx, x, y, w, h, r);
      ctx.fillStyle = "#000000";
      ctx.fill();
      ctx.restore();
    }
    roundedPath(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.drawImage(item.image, x, y, w, h);
    ctx.restore();
  }

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="frameTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Frame</p>
              <h2 id="frameTitle">Preview</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="change">${T.icon(T.icons.upload, 16)}<span>Choose image</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
        </section>
        <section class="panel tool-controls" aria-labelledby="frameSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="frameSettingsTitle">Frame</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const shape = T.segmented("frame-shape", [
      { value: "original", label: "As is" },
      { value: "1:1", label: "1:1" },
      { value: "4:5", label: "4:5" },
      { value: "3:4", label: "3:4" },
      { value: "9:16", label: "9:16" },
      { value: "16:9", label: "16:9" },
    ], "1:1", "Canvas shape");
    shape.classList.add("seg-wrap");
    const shapeField = T.el('<div class="field"><div class="field-label"><strong>Canvas shape</strong><small>The whole photo fits inside, nothing is cut off</small></div></div>');
    shapeField.appendChild(shape);
    const bg = T.segmented("frame-bg", [
      { value: "color", label: "Colour" },
      { value: "blur", label: "Blurred photo" },
      { value: "none", label: "Transparent" },
    ], "color", "Background");
    const bgField = T.el(`
      <div class="field">
        <div class="field-label"><strong>Background</strong></div>
        <div class="color-line" data-slot="color"><input type="color" value="#ffffff" aria-label="Background colour" /><small class="field-note">Tip: white or black look clean on Instagram</small></div>
      </div>`);
    bgField.insertBefore(bg, bgField.querySelector('[data-slot="color"]'));
    const colorLine = bgField.querySelector('[data-slot="color"]');
    const colorInput = colorLine.querySelector("input");
    const range = (label, aria, max, value, unit) => {
      const f = T.el(`
        <label class="field range-field">
          <span class="field-label"><strong>${label}</strong><output></output></span>
          <input type="range" min="0" max="${max}" step="1" value="${value}" aria-label="${aria}" />
        </label>`);
      f.input = f.querySelector("input");
      f.sync = () => (f.querySelector("output").value = `${f.input.value}${unit}`);
      f.sync();
      return f;
    };
    const border = range("Border", "Border width in percent", 30, 4, "%");
    const corners = range("Rounded corners", "Corner roundness in percent", 50, 0, "%");
    const shadowField = T.el('<label class="check-line"><input type="checkbox" /><span><strong>Soft shadow</strong><small>Lifts the photo off the background</small></span></label>');
    const shadowInput = shadowField.querySelector("input");
    const format = T.formatField("frame");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download framed image",
      onDownload: () => output().then((e) => e && T.download(e.blob, e.name)),
      onShare: () => output().then((e) => e && T.share([e], e.name)),
      onCompress: () => output().then((e) => e && T.sendToCompress([e])),
    });
    controls.append(shapeField, bgField, border, corners, shadowField, format, summary, actions);

    const stage = CL.editorStage({ label: "Framed picture" });
    stage.onFit = draw;
    const drop = T.dropzone({
      title: "Choose a photo to frame",
      hint: "Drop a photo here, tap to choose, or paste. Great for posting a tall or wide photo without cropping it.",
      onFiles: addFiles,
    });

    let item = null;

    function settings() {
      return {
        shape: shape.value(),
        bg: bg.value(),
        color: colorInput.value,
        border: Number(border.input.value),
        corners: Number(corners.input.value),
        shadow: shadowInput.checked,
      };
    }

    function draw() {
      if (!item) return;
      const p = plan(item, settings());
      const ctx = stage.canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, stage.canvas.width, stage.canvas.height);
      render(ctx, item, p, settings(), stage.canvas.width / p.W);
    }

    function refresh() {
      const s = settings();
      slot.textContent = "";
      slot.appendChild(item ? stage.el : drop);
      clearButton.disabled = !item;
      colorLine.hidden = s.bg !== "color";
      border.sync();
      corners.sync();
      actions.setEnabled(Boolean(item), { shareable: item && T.canShare([{ blob: new Blob([], { type: "image/png" }), name: "a.png" }]) });
      if (!item) {
        summary.textContent = "";
        return;
      }
      const p = plan(item, s);
      const fmt = format.get();
      const clear = s.bg === "none" || (s.corners > 0 && s.border === 0 && s.shape === "original");
      summary.textContent = `${p.W} × ${p.H} px, saved as ${fmt.label}.${clear && fmt.mime === "image/jpeg" ? " JPEG can't be transparent, so see-through parts become white. Pick PNG or WebP to keep them." : ""}`;
      stage.fit(p.W, p.H);
      draw();
    }

    async function addFiles(files) {
      const [next] = await T.loadItems(T.imageFiles(files).slice(0, 1));
      if (!next) return;
      T.releaseItem(item);
      item = next;
      format.setSource(item.file.type);
      refresh();
    }

    async function output() {
      if (!item) return null;
      const s = settings();
      const p = plan(item, s);
      const canvas = T.canvas(p.W, p.H);
      render(canvas.getContext("2d"), item, p, s, 1);
      const fmt = format.get();
      try {
        const blob = await T.encode(canvas, fmt);
        return { blob, name: `${T.baseName(item.file.name)}-framed.${fmt.ext}` };
      } catch (error) {
        CL.toast(error.message);
        return null;
      }
    }

    controls.addEventListener("change", refresh);
    controls.addEventListener("input", (event) => {
      if (event.target.matches('input[type="range"], input[type="color"]')) refresh();
    });
    view.querySelector('[data-act="change"]').addEventListener("click", () => T.pickFiles({}, addFiles));
    clearButton.addEventListener("click", () => {
      T.releaseItem(item);
      item = null;
      refresh();
    });

    refresh();
    return { addFiles, onShow: () => item && stage.fit(), output, plan: () => item && plan(item, settings()) };
  }

  T.register({
    id: "frame",
    name: "Frame & border",
    short: "Frame",
    blurb: "Fit a whole photo into a square, 4:5 or story canvas with no cropping. Colour or blurred background, border, rounded corners.",
    tags: ["Instagram"],
    group: "edit",
    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
    create,
  });
})(window.CL = window.CL || {});
