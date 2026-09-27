// Watermark: stamp text or a logo on one image or a batch. Nine positions,
// opacity, size, margin, or a diagonal repeat across the whole picture.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const POSITIONS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"];
  const POSITION_NAMES = {
    tl: "Top left", tc: "Top centre", tr: "Top right",
    ml: "Middle left", mc: "Centre", mr: "Middle right",
    bl: "Bottom left", bc: "Bottom centre", br: "Bottom right",
  };

  // Draw the watermark on ctx in image units (W × H = image size).
  function stamp(ctx, W, H, s, logo) {
    const short = Math.min(W, H);
    const margin = (short * s.margin) / 100;
    let w;
    let h;
    let draw;
    if (s.kind === "logo") {
      if (!logo) return;
      w = (W * s.size) / 100;
      h = (w * logo.height) / logo.width;
      draw = (x, y) => ctx.drawImage(logo, x, y, w, h);
    } else {
      const text = s.text.trim();
      if (!text) return;
      const px = Math.max(6, (short * s.size) / 200);
      ctx.font = `700 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textBaseline = "alphabetic";
      const m = ctx.measureText(text);
      const ascent = m.actualBoundingBoxAscent || px * 0.75;
      const descent = m.actualBoundingBoxDescent || px * 0.2;
      w = m.width;
      h = ascent + descent;
      draw = (x, y) => {
        ctx.fillStyle = s.color;
        ctx.fillText(text, x, y + ascent);
      };
    }

    ctx.save();
    ctx.globalAlpha = s.opacity / 100;
    if (s.kind === "text" && s.shadow) {
      // A soft dark halo keeps light text readable on bright photos.
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = Math.max(2, h * 0.25);
    }
    if (s.tiled) {
      const gapX = Math.max(w * 0.6, short * 0.08);
      const gapY = Math.max(h * 2.2, short * 0.12);
      const reach = Math.hypot(W, H);
      ctx.translate(W / 2, H / 2);
      ctx.rotate((-30 * Math.PI) / 180);
      let row = 0;
      for (let y = -reach; y < reach; y += h + gapY, row += 1) {
        const shift = row % 2 ? (w + gapX) / 2 : 0;
        for (let x = -reach - shift; x < reach; x += w + gapX) draw(x, y);
      }
    } else {
      const col = s.position[1];
      const rowPos = s.position[0];
      const x = col === "l" ? margin : col === "c" ? (W - w) / 2 : W - margin - w;
      const y = rowPos === "t" ? margin : rowPos === "m" ? (H - h) / 2 : H - margin - h;
      draw(x, y);
    }
    ctx.restore();
  }

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="wmTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Watermark</p>
              <h2 id="wmTitle">Preview</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="add">${T.icon(T.icons.plus, 16)}<span>Add images</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
          <div class="wm-batch" data-slot="batch" hidden>
            <div class="section-label"><strong>All images</strong><small>Tap one to preview it. Every image gets the same watermark.</small></div>
          </div>
        </section>
        <section class="panel tool-controls" aria-labelledby="wmSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="wmSettingsTitle">Watermark</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const batchBox = view.querySelector('[data-slot="batch"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const kind = T.segmented("wm-kind", [
      { value: "text", label: "Text" },
      { value: "logo", label: "Logo image" },
    ], "text", "Watermark type");
    const kindField = T.el('<div class="field"><div class="field-label"><strong>Type</strong></div></div>');
    kindField.appendChild(kind);
    const textField = T.el(`
      <div class="field" data-for="text">
        <label class="field">
          <span class="field-label"><strong>Text</strong></span>
          <input type="text" class="text-input" value="© Your name" maxlength="120" aria-label="Watermark text" />
        </label>
        <div class="color-line">
          <input type="color" value="#ffffff" aria-label="Text colour" />
          <label class="lock-label"><input type="checkbox" checked /> Soft shadow (easier to read)</label>
        </div>
      </div>`);
    const textInput = textField.querySelector('input[type="text"]');
    const colorInput = textField.querySelector('input[type="color"]');
    const shadowInput = textField.querySelector('input[type="checkbox"]');
    const logoField = T.el(`
      <div class="field" data-for="logo" hidden>
        <div class="field-label"><strong>Logo</strong><small>A PNG with a transparent background works best</small></div>
        <div class="logo-pick">
          <img alt="" hidden />
          <button type="button" class="ghost-button">${T.icon(T.icons.upload, 16)}<span>Choose logo</span></button>
        </div>
      </div>`);
    const logoPreview = logoField.querySelector("img");
    const logoButton = logoField.querySelector("button");
    const posField = T.el(`
      <div class="field">
        <div class="field-label"><strong>Position</strong></div>
        <div class="pos-grid" role="radiogroup" aria-label="Position">
          ${POSITIONS.map((p) => `<label title="${POSITION_NAMES[p]}"><input type="radio" name="wm-pos" value="${p}" ${p === "br" ? "checked" : ""} aria-label="${POSITION_NAMES[p]}" /><span></span></label>`).join("")}
        </div>
      </div>`);
    const tiledField = T.el('<label class="check-line"><input type="checkbox" /><span><strong>Repeat across the picture</strong><small>Diagonal pattern, much harder to crop out</small></span></label>');
    const tiledInput = tiledField.querySelector("input");
    const range = (label, aria, min, max, value, unit) => {
      const f = T.el(`
        <label class="field range-field">
          <span class="field-label"><strong>${label}</strong><output></output></span>
          <input type="range" min="${min}" max="${max}" step="1" value="${value}" aria-label="${aria}" />
        </label>`);
      f.input = f.querySelector("input");
      f.sync = () => (f.querySelector("output").value = `${f.input.value}${unit}`);
      f.sync();
      return f;
    };
    const size = range("Size", "Watermark size", 1, 50, 10, "");
    const opacity = range("Opacity", "Watermark opacity", 5, 100, 60, "%");
    const margin = range("Distance from edge", "Distance from the edge", 0, 15, 3, "%");
    const format = T.formatField("wm");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download",
      onDownload: download,
      onShare: () => outputs().then((files) => files.length && T.share(files, "Watermarked images")),
      onCompress: () => outputs().then((files) => files.length && T.sendToCompress(files)),
    });
    // Position grid and "Repeat" share a row so the panel fits without scrolling.
    const posRow = T.el('<div class="wm-pos-row"></div>');
    posRow.append(posField, tiledField);
    controls.append(kindField, textField, logoField, posRow, size, opacity, margin, format, summary, actions);

    const stage = CL.editorStage({ label: "Watermark preview" });
    stage.onFit = draw;
    let previewId = null;
    const list = T.imageList({
      label: "Images to watermark",
      reorder: false,
      figure: (item) => `<img class="stitch-thumb" src="${item.thumb}" alt="" />${item.id === previewId ? '<span class="dim-badge">Previewing</span>' : ""}`,
      onChange: refresh,
    });
    batchBox.appendChild(list.el);
    const drop = T.dropzone({
      multiple: true,
      title: "Add images to watermark",
      hint: "Drop one picture or a batch here, tap to choose, or paste.",
      onFiles: addFiles,
    });

    let logo = null;
    const sizes = { text: 10, logo: 20 }; // remembered per type

    function settings() {
      return {
        kind: kind.value(),
        text: textInput.value,
        color: colorInput.value,
        shadow: shadowInput.checked,
        position: posField.querySelector("input:checked").value,
        tiled: tiledInput.checked,
        size: Number(size.input.value),
        opacity: Number(opacity.input.value),
        margin: Number(margin.input.value),
      };
    }

    function current() {
      return list.items.find((item) => item.id === previewId) || list.items[0] || null;
    }

    function draw() {
      const item = current();
      if (!item) return;
      const ctx = stage.canvas.getContext("2d");
      const k = stage.canvas.width / item.width;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, stage.canvas.width, stage.canvas.height);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(item.image, 0, 0, item.width, item.height);
      stamp(ctx, item.width, item.height, settings(), logo);
    }

    function refresh() {
      const count = list.items.length;
      const s = settings();
      const item = current();
      slot.textContent = "";
      slot.appendChild(item ? stage.el : drop);
      batchBox.hidden = count < 2;
      clearButton.disabled = !count;
      textField.hidden = s.kind !== "text";
      logoField.hidden = s.kind !== "logo";
      posField.hidden = s.tiled;
      margin.hidden = s.tiled;
      size.sync();
      opacity.sync();
      margin.sync();
      format.setSource(item?.file.type);
      const ready = count > 0 && (s.kind === "text" ? s.text.trim() : logo);
      actions.setEnabled(Boolean(ready), { shareable: T.canShare([{ blob: new Blob([], { type: "image/png" }), name: "a.png" }]) });
      actions.setLabel(count > 1 ? "Download all (.zip)" : "Download image");
      if (!count) summary.textContent = "";
      else if (s.kind === "logo" && !logo) summary.textContent = "Choose a logo image.";
      else if (s.kind === "text" && !s.text.trim()) summary.textContent = "Type the watermark text.";
      else {
        summary.textContent = `${count} ${count === 1 ? "image" : "images"} · ${s.tiled ? "repeated diagonally" : POSITION_NAMES[s.position].toLowerCase()} · ${s.opacity}% opacity. Saved as ${count > 1 && format.isOriginal() ? "each file's own type" : format.get().label}.`;
      }
      if (item) {
        stage.fit(item.width, item.height);
        draw();
      }
    }

    async function addFiles(files) {
      const items = await T.loadItems(files);
      if (!items.length) return;
      if (!previewId) previewId = items[0].id;
      list.add(items);
    }

    async function outputs() {
      const s = settings();
      const out = [];
      const used = new Set();
      for (const item of list.items) {
        const canvas = T.canvas(item.width, item.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(item.image, 0, 0);
        stamp(ctx, item.width, item.height, s, logo);
        const fmt = format.get(item.file.type);
        try {
          const blob = await T.encode(canvas, fmt);
          let name = `${T.baseName(item.file.name)}-watermarked.${fmt.ext}`;
          for (let n = 2; used.has(name); n += 1) name = `${T.baseName(item.file.name)}-watermarked-${n}.${fmt.ext}`;
          used.add(name);
          out.push({ blob, name });
        } catch (error) {
          CL.toast(`${item.file.name}: ${error.message}`);
        }
      }
      return out;
    }

    let busy = false;
    async function download() {
      if (busy) return;
      busy = true;
      actions.setEnabled(false);
      try {
        const files = await outputs();
        if (files.length === 1) T.download(files[0].blob, files[0].name);
        else if (files.length > 1) {
          await T.zip(files, "watermarked-images.zip");
          CL.toast(`ZIP with ${files.length} watermarked images ready.`);
        }
      } finally {
        busy = false;
        refresh();
      }
    }

    async function setLogo(files) {
      const [file] = T.imageFiles(files);
      if (!file) return;
      try {
        const url = URL.createObjectURL(file);
        logo = await CL.loadImage(url);
        logoPreview.src = url;
        logoPreview.hidden = false;
        logoButton.querySelector("span").textContent = "Change logo";
        refresh();
      } catch (error) {
        CL.toast(error.message);
      }
    }

    kind.addEventListener("change", () => {
      const k = kind.value();
      sizes[k === "text" ? "logo" : "text"] = Number(size.input.value);
      size.input.value = sizes[k];
    });
    size.input.addEventListener("input", () => (sizes[kind.value()] = Number(size.input.value)));
    controls.addEventListener("input", refresh);
    controls.addEventListener("change", refresh);
    logoButton.addEventListener("click", () => T.pickFiles({}, setLogo));
    list.el.addEventListener("click", (event) => {
      const card = event.target.closest(".img-card");
      if (!card || event.target.closest("button")) return;
      previewId = card.dataset.id;
      list.render();
      refresh();
    });
    view.querySelector('[data-act="add"]').addEventListener("click", () => T.pickFiles({ multiple: true }, addFiles));
    clearButton.addEventListener("click", () => {
      previewId = null;
      list.clear();
    });

    refresh();
    return { addFiles, outputs, setLogo, settings, stamp };
  }

  T.register({
    id: "watermark",
    name: "Watermark",
    short: "Watermark",
    blurb: "Stamp your name or logo on one photo or a batch: nine positions, opacity, size, or repeated across the picture.",
    tags: ["Batch", "ZIP"],
    group: "edit",
    icon: '<path d="M12 3 5 13a7 7 0 1 0 14 0z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
    create,
  });
})(window.CL = window.CL || {});
