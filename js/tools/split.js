// Split image: cut one picture into equal pieces (carousel columns or a
// rows × columns grid), optionally cropping first so every piece has an
// Instagram-friendly shape. Live preview of the cut lines; ZIP, single-piece
// download, share, or send the pieces to Compress.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const PRESETS = {
    "1x3": [1, 3],
    "1x2": [1, 2],
    "1x4": [1, 4],
    "2x2": [2, 2],
    "3x3": [3, 3],
  };
  const SHAPES = { keep: 0, "1:1": 1, "4:5": 4 / 5, "3:4": 3 / 4 };

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="splitTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Split image</p>
              <h2 id="splitTitle">Preview</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="change">${T.icon(T.icons.upload, 16)}<span>Choose image</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
          <div class="split-results" data-slot="results" hidden>
            <div class="section-label"><strong>Pieces</strong><small data-slot="results-note"></small></div>
            <ol class="tile-grid" data-slot="tiles"></ol>
          </div>
        </section>
        <section class="panel tool-controls" aria-labelledby="splitSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="splitSettingsTitle">How to cut</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const stage = view.querySelector('[data-slot="stage"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const results = view.querySelector('[data-slot="results"]');
    const resultsNote = view.querySelector('[data-slot="results-note"]');
    const tileGrid = view.querySelector('[data-slot="tiles"]');
    const changeButton = view.querySelector('[data-act="change"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const preset = T.segmented("split-preset", [
      { value: "1x3", label: "3 across", title: "Three side-by-side pieces, for a swipe carousel" },
      { value: "1x2", label: "2 across" },
      { value: "1x4", label: "4 across" },
      { value: "2x2", label: "2 × 2" },
      { value: "3x3", label: "3 × 3", title: "Nine pieces, for a profile grid" },
      { value: "custom", label: "Custom" },
    ], "1x3", "Layout");
    const grid = T.el(`
      <div class="grid-inputs">
        <label><span>Rows</span><input type="number" class="num-input" min="1" max="20" step="1" value="1" data-grid="rows" /></label>
        <span aria-hidden="true">×</span>
        <label><span>Columns</span><input type="number" class="num-input" min="1" max="20" step="1" value="3" data-grid="cols" /></label>
      </div>`);
    const rowsInput = grid.querySelector('[data-grid="rows"]');
    const colsInput = grid.querySelector('[data-grid="cols"]');
    const shape = T.segmented("split-shape", [
      { value: "keep", label: "Keep" },
      { value: "1:1", label: "1:1" },
      { value: "4:5", label: "4:5" },
      { value: "3:4", label: "3:4" },
    ], "keep", "Piece shape");
    const position = T.el(`
      <label class="field range-field" hidden>
        <span class="field-label"><strong>Crop position</strong><output>Centre</output></span>
        <input type="range" min="0" max="100" step="1" value="50" aria-label="Crop position" />
      </label>`);
    const positionInput = position.querySelector("input");
    const positionOutput = position.querySelector("output");
    const format = T.formatField("split");
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const splitButton = T.el(`<button type="button" class="primary-button" disabled>Split image</button>`);
    const actions = T.outputActions({
      downloadLabel: "Download all (.zip)",
      onDownload: downloadZip,
      onShare: () => T.share(pieces, "Split image"),
      onCompress: () => T.sendToCompress(pieces),
    });
    actions.hidden = true;

    const layoutField = T.el(`<div class="field"><div class="field-label"><strong>Layout</strong><small>Pieces are numbered left to right, top to bottom</small></div></div>`);
    layoutField.append(preset, grid);
    const shapeField = T.el(`<div class="field"><div class="field-label"><strong>Piece shape</strong><small>Crop so every piece has this shape. Instagram posts use 1:1, 4:5 or 3:4.</small></div></div>`);
    shapeField.appendChild(shape);
    controls.append(layoutField, shapeField, position, format, summary, splitButton, actions);

    const canvas = T.el('<canvas class="split-canvas" role="img" aria-label="Image with cut lines"></canvas>');
    const drop = T.dropzone({
      title: "Choose an image to split",
      hint: "Drop a panorama or photo here, tap to choose, or paste. You'll see the cut lines before anything is saved.",
      onFiles: addFiles,
    });

    let item = null;
    let pieces = [];

    function settings() {
      const rows = CL.clamp(Math.round(Number(rowsInput.value)) || 1, 1, 20);
      const cols = CL.clamp(Math.round(Number(colsInput.value)) || 1, 1, 20);
      return { rows, cols, shape: shape.value(), position: Number(positionInput.value) };
    }

    // Region of the source that gets cut (the whole image unless a piece
    // shape asks for a crop), plus every piece's rectangle in source pixels.
    function plan(s = settings()) {
      const W = item.width;
      const H = item.height;
      let region = { x: 0, y: 0, w: W, h: H };
      let axis = "";
      const ratio = SHAPES[s.shape];
      if (ratio) {
        // Pick one whole-pixel piece size first, so every piece is exactly
        // the chosen shape (1:1 really is square), then crop to fit them.
        let tw = Math.max(1, Math.floor(Math.min(W / s.cols, (H / s.rows) * ratio)));
        let th = Math.max(1, Math.round(tw / ratio));
        if (th * s.rows > H) {
          th = Math.max(1, Math.floor(H / s.rows));
          tw = Math.max(1, Math.min(Math.floor(W / s.cols), Math.round(th * ratio)));
        }
        const w = tw * s.cols;
        const h = th * s.rows;
        const slackX = W - w;
        const slackY = H - h;
        axis = slackX / W >= slackY / H ? "x" : "y";
        const px = axis === "x" ? s.position / 100 : 0.5;
        const py = axis === "y" ? s.position / 100 : 0.5;
        region = { x: Math.round(slackX * px), y: Math.round(slackY * py), w, h };
        if ((axis === "x" ? slackX : slackY) <= 2) axis = ""; // nothing worth moving
      }
      const tiles = [];
      for (let r = 0; r < s.rows; r += 1) {
        const y0 = region.y + Math.round((r * region.h) / s.rows);
        const y1 = region.y + Math.round(((r + 1) * region.h) / s.rows);
        for (let c = 0; c < s.cols; c += 1) {
          const x0 = region.x + Math.round((c * region.w) / s.cols);
          const x1 = region.x + Math.round(((c + 1) * region.w) / s.cols);
          tiles.push({ n: tiles.length + 1, row: r, col: c, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
      }
      return { region, tiles, axis };
    }

    function drawPreview() {
      if (!item) return;
      const { region, tiles } = plan();
      const dpr = window.devicePixelRatio || 1;
      const maxW = Math.max(200, stage.clientWidth);
      const maxH = Math.max(240, Math.min(620, window.innerHeight * 0.62));
      const k = Math.min(maxW / item.width, maxH / item.height);
      const cssW = Math.max(1, Math.round(item.width * k));
      const cssH = Math.max(1, Math.round(item.height * k));
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(item.image, 0, 0, item.width, item.height);

      // Dim whatever the crop leaves out.
      ctx.fillStyle = "rgba(10, 16, 15, 0.62)";
      ctx.fillRect(0, 0, item.width, region.y);
      ctx.fillRect(0, region.y + region.h, item.width, item.height - region.y - region.h);
      ctx.fillRect(0, region.y, region.x, region.h);
      ctx.fillRect(region.x + region.w, region.y, item.width - region.x - region.w, region.h);

      // Cut lines: dark halo under a white line so they show on any photo.
      const line = (x0, y0, x1, y1) => {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.lineWidth = 4 / k;
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 / k;
        ctx.setLineDash([8 / k, 5 / k]);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      const s = settings();
      for (let c = 1; c < s.cols; c += 1) {
        const x = tiles[c].x;
        line(x, region.y, x, region.y + region.h);
      }
      for (let r = 1; r < s.rows; r += 1) {
        const y = tiles[r * s.cols].y;
        line(region.x, y, region.x + region.w, y);
      }
      if (region.w < item.width || region.h < item.height) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 / k;
        ctx.strokeRect(region.x, region.y, region.w, region.h);
      }

      // Piece numbers.
      const radius = Math.min(16, Math.max(9, Math.min(...tiles.map((t) => Math.min(t.w, t.h))) * k * 0.18)) / k;
      ctx.font = `800 ${radius * 1.1}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const t of tiles) {
        const cx = t.x + t.w / 2;
        const cy = t.y + t.h / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(15, 118, 110, 0.92)";
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(t.n), cx, cy + radius * 0.05);
      }
    }

    function describePosition(axis, value) {
      if (value === 50) return "Centre";
      if (axis === "x") return value < 50 ? `${50 - value}% left` : `${value - 50}% right`;
      return value < 50 ? `${50 - value}% up` : `${value - 50}% down`;
    }

    function clearPieces() {
      pieces.forEach((p) => URL.revokeObjectURL(p.url));
      pieces = [];
      tileGrid.textContent = "";
      results.hidden = true;
      actions.hidden = true;
      // Before a split, "Split image" is the main action; after, Download is.
      splitButton.className = "primary-button";
      splitButton.textContent = "Split image";
    }

    function refresh() {
      const s = settings();
      const matched = Object.entries(PRESETS).find(([, v]) => v[0] === s.rows && v[1] === s.cols);
      preset.set(matched ? matched[0] : "custom");
      stage.textContent = "";
      stage.appendChild(item ? canvas : drop);
      clearButton.disabled = !item;
      splitButton.disabled = !item;
      if (!item) {
        summary.textContent = "";
        position.hidden = true;
        return;
      }
      const { tiles, axis } = plan(s);
      position.hidden = !axis;
      positionOutput.value = describePosition(axis, s.position);
      const sizes = new Set(tiles.map((t) => `${t.w} × ${t.h}`));
      const sizeText = sizes.size === 1 ? `each ${[...sizes][0]} px` : `about ${tiles[0].w} × ${tiles[0].h} px each`;
      summary.textContent = `${tiles.length} ${tiles.length === 1 ? "piece" : "pieces"}, ${sizeText}. Saved as ${format.get().label}.`;
      drawPreview();
    }

    async function addFiles(files) {
      const [next] = await T.loadItems(T.imageFiles(files).slice(0, 1));
      if (!next) return;
      if (T.imageFiles(files).length > 1) CL.toast("Split works on one image at a time. Using the first one.");
      T.releaseItem(item);
      item = next;
      format.setSource(item.file.type);
      clearPieces();
      refresh();
    }

    async function split() {
      if (!item) return;
      clearPieces();
      splitButton.disabled = true;
      splitButton.textContent = "Splitting…";
      try {
        const s = settings();
        const fmt = format.get();
        const base = T.baseName(item.file.name);
        const digits = String(s.rows * s.cols).length < 2 ? 2 : String(s.rows * s.cols).length;
        for (const t of plan(s).tiles) {
          const c = T.canvas(t.w, t.h);
          c.getContext("2d").drawImage(item.image, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
          const blob = await T.encode(c, fmt);
          pieces.push({
            blob,
            name: `${base}-${String(t.n).padStart(digits, "0")}.${fmt.ext}`,
            url: URL.createObjectURL(blob),
            tile: t,
          });
        }
        renderPieces(s);
      } catch (error) {
        console.error(error);
        CL.toast(error.message || "Could not split the image.");
      } finally {
        splitButton.disabled = false;
        if (pieces.length) {
          splitButton.className = "ghost-button split-again";
          splitButton.textContent = "Split again";
        } else {
          splitButton.textContent = "Split image";
        }
      }
    }

    function renderPieces(s) {
      tileGrid.style.setProperty("--cols", String(Math.min(s.cols, 6)));
      tileGrid.textContent = "";
      for (const p of pieces) {
        const li = T.el(`
          <li>
            <button type="button" class="tile-button" aria-label="Download piece ${p.tile.n}">
              <img src="${p.url}" alt="" />
              <span class="img-card-num">${p.tile.n}</span>
              <small>${p.tile.w} × ${p.tile.h} · ${CL.formatBytes(p.blob.size)}</small>
            </button>
          </li>`);
        li.querySelector("button").addEventListener("click", () => T.download(p.blob, p.name));
        tileGrid.appendChild(li);
      }
      const total = pieces.reduce((sum, p) => sum + p.blob.size, 0);
      resultsNote.textContent = `Tap a piece to save just that one · ${CL.formatBytes(total)} in total`;
      results.hidden = false;
      actions.hidden = false;
      actions.setEnabled(true, { shareable: T.canShare(pieces) });
    }

    async function downloadZip() {
      if (!pieces.length) return;
      await T.zip(pieces, `${T.baseName(item.file.name)}-split.zip`);
      CL.toast(`ZIP with ${pieces.length} pieces ready.`);
    }

    preset.addEventListener("change", () => {
      const value = preset.value();
      if (PRESETS[value]) {
        [rowsInput.value, colsInput.value] = PRESETS[value];
      }
      clearPieces();
      refresh();
      if (value === "custom") colsInput.focus();
    });
    [rowsInput, colsInput].forEach((input) =>
      input.addEventListener("input", () => {
        clearPieces();
        refresh();
      }),
    );
    [rowsInput, colsInput].forEach((input) =>
      input.addEventListener("change", () => {
        input.value = settings()[input.dataset.grid];
      }),
    );
    shape.addEventListener("change", () => {
      clearPieces();
      refresh();
    });
    positionInput.addEventListener("input", () => {
      clearPieces();
      refresh();
    });
    format.addEventListener("formatchange", () => {
      clearPieces();
      refresh();
    });
    splitButton.addEventListener("click", split);
    changeButton.addEventListener("click", () => T.pickFiles({}, addFiles));
    clearButton.addEventListener("click", () => {
      T.releaseItem(item);
      item = null;
      clearPieces();
      refresh();
    });
    new ResizeObserver(() => {
      if (item && !view.hidden) drawPreview();
    }).observe(stage);

    refresh();
    return {
      addFiles,
      onShow: () => item && drawPreview(),
      plan: () => (item ? plan() : null),
      split,
      pieces: () => pieces,
    };
  }

  T.register({
    id: "split",
    name: "Split image",
    short: "Split",
    blurb: "Cut a picture into equal pieces: 3 across for a carousel, or any rows × columns grid.",
    tags: ["Instagram", "ZIP"],
    group: "combine",
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14"/><path d="M15 5v14"/>',
    create,
  });
})(window.CL = window.CL || {});
