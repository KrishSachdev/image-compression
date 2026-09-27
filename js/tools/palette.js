// Colours: tap (or drag) on a picture to pick a colour (HEX / RGB / HSL with
// copy buttons), and pull out a 5–8 colour palette of its main colours.
(function (CL) {
  "use strict";

  const T = CL.toolkit;

  const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  const rgb = ([r, g, b]) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  function hsl([r, g, b]) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  }
  // Readable text colour on top of a swatch.
  const inkFor = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111" : "#fff");

  // Main colours of RGBA pixel data: histogram (5 bits per channel), seeds
  // from the most common, well-separated bins, then weighted k-means.
  function extract(data, k) {
    const bins = new Map();
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // skip see-through pixels
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      let bin = bins.get(key);
      if (!bin) bins.set(key, (bin = [0, 0, 0, 0]));
      bin[0] += data[i];
      bin[1] += data[i + 1];
      bin[2] += data[i + 2];
      bin[3] += 1;
      total += 1;
    }
    if (!total) return [];
    const points = [...bins.values()]
      .map((b) => ({ c: [b[0] / b[3], b[1] / b[3], b[2] / b[3]], n: b[3] }))
      .sort((a, b) => b.n - a.n);
    const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

    let centres = [];
    for (const gap of [64, 44, 28, 14, 0]) {
      for (const p of points) {
        if (centres.length >= k) break;
        if (centres.every((c) => dist(c, p.c) >= gap * gap)) centres.push(p.c.slice());
      }
      if (centres.length >= k) break;
    }

    let counts = [];
    for (let iter = 0; iter < 12; iter += 1) {
      const sums = centres.map(() => [0, 0, 0, 0]);
      for (const p of points) {
        let best = 0;
        let bestD = Infinity;
        centres.forEach((c, j) => {
          const d = dist(c, p.c);
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        });
        const s = sums[best];
        s[0] += p.c[0] * p.n;
        s[1] += p.c[1] * p.n;
        s[2] += p.c[2] * p.n;
        s[3] += p.n;
      }
      centres = sums.map((s, j) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centres[j]));
      counts = sums.map((s) => s[3]);
    }
    return centres
      .map((c, j) => ({ color: c, share: counts[j] / total }))
      .filter((x) => x.share > 0)
      .sort((a, b) => b.share - a.share);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // file:// and older browsers: fall back to a hidden text box.
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      document.execCommand("copy");
      box.remove();
    }
    CL.toast(`Copied ${text.length > 60 ? `${text.slice(0, 57)}…` : text}`);
  }

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="palTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Colours</p>
              <h2 id="palTitle">Tap to pick a colour</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="change">${T.icon(T.icons.upload, 16)}<span>Choose image</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
          <p class="tool-hint" data-slot="hint" hidden>Tap anywhere on the picture, or drag to explore. Arrow keys move the picker when the picture is focused.</p>
        </section>
        <section class="panel tool-controls" aria-labelledby="palSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Result</p><h2 id="palSettingsTitle">Colours</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const hint = view.querySelector('[data-slot="hint"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const picked = T.el(`
      <div class="field">
        <div class="field-label"><strong>Picked colour</strong><small data-slot="where">Tap the picture</small></div>
        <div class="pick-card">
          <span class="pick-swatch" aria-hidden="true"></span>
          <div class="pick-values">
            ${["hex", "rgb", "hsl"].map((f) => `<div class="pick-row"><code data-f="${f}">-</code><button type="button" class="ghost-button" data-copy="${f}" disabled>Copy</button></div>`).join("")}
          </div>
        </div>
        <div class="pick-history" aria-label="Recent picks"></div>
      </div>`);
    const swatch = picked.querySelector(".pick-swatch");
    const where = picked.querySelector('[data-slot="where"]');
    const history = picked.querySelector(".pick-history");

    const count = T.segmented("pal-count", ["5", "6", "7", "8"].map((n) => ({ value: n, label: n })), "6", "Number of colours");
    const paletteField = T.el(`
      <div class="field">
        <div class="field-label"><strong>Palette</strong><small>The main colours, most common first</small></div>
      </div>`);
    const swatches = T.el('<ol class="pal-list" aria-label="Palette"></ol>');
    const paletteActions = T.el(`
      <div class="button-row">
        <button type="button" class="ghost-button" data-pal="copy" disabled>Copy all HEX</button>
        <button type="button" class="ghost-button" data-pal="css" disabled>Copy as CSS</button>
        <button type="button" class="ghost-button" data-pal="png" disabled>${T.icon(T.icons.download, 14)}<span>Palette image</span></button>
      </div>`);
    paletteField.append(count, swatches, paletteActions);
    controls.append(picked, paletteField);

    const stage = CL.editorStage({ label: "Picture to pick colours from" });
    stage.onFit = draw;
    const marker = T.el('<span class="pick-marker" hidden aria-hidden="true"></span>');
    stage.frame.appendChild(marker);
    stage.canvas.tabIndex = 0;
    const drop = T.dropzone({
      title: "Choose an image to take colours from",
      hint: "Drop a photo, screenshot or design here, tap to choose, or paste.",
      onFiles: addFiles,
    });

    let item = null;
    let current = null; // { color, x, y }
    let recent = [];
    let palette = [];
    const sampler = T.canvas(1, 1);
    const sctx = sampler.getContext("2d", { willReadFrequently: true });

    function draw() {
      if (!item) return;
      const ctx = stage.canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, stage.canvas.width, stage.canvas.height);
      ctx.drawImage(item.image, 0, 0, stage.canvas.width, stage.canvas.height);
      placeMarker();
    }

    function sample(x, y) {
      sctx.clearRect(0, 0, 1, 1);
      sctx.drawImage(item.image, x, y, 1, 1, 0, 0, 1, 1);
      const d = sctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    }

    function placeMarker() {
      if (!current || !item) {
        marker.hidden = true;
        return;
      }
      marker.hidden = false;
      marker.style.left = `${((current.x + 0.5) / item.width) * 100}%`;
      marker.style.top = `${((current.y + 0.5) / item.height) * 100}%`;
      marker.style.background = hex(current.color);
    }

    function showPick() {
      const has = Boolean(current);
      picked.querySelectorAll("[data-copy]").forEach((b) => (b.disabled = !has));
      if (!has) {
        swatch.style.background = "";
        picked.querySelectorAll("code").forEach((c) => (c.textContent = "-"));
        where.textContent = item ? "Tap the picture" : "Add an image first";
        return;
      }
      const c = current.color;
      swatch.style.background = hex(c);
      picked.querySelector('[data-f="hex"]').textContent = hex(c);
      picked.querySelector('[data-f="rgb"]').textContent = rgb(c);
      picked.querySelector('[data-f="hsl"]').textContent = hsl(c);
      where.textContent = `At ${current.x}, ${current.y}${c[3] < 255 ? ` · ${Math.round((c[3] / 255) * 100)}% opaque` : ""}`;
      placeMarker();
    }

    function pickAt(x, y, keep) {
      x = CL.clamp(Math.floor(x), 0, item.width - 1);
      y = CL.clamp(Math.floor(y), 0, item.height - 1);
      current = { x, y, color: sample(x, y) };
      showPick();
      if (keep) {
        const h = hex(current.color);
        recent = [h, ...recent.filter((x2) => x2 !== h)].slice(0, 8);
        history.innerHTML = recent.map((c) => `<button type="button" class="pal-chip" style="background:${c};color:${inkFor(hexToRgb(c))}" data-hex="${c}" title="Copy ${c}" aria-label="Copy ${c}"></button>`).join("");
      }
    }

    const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

    function buildPalette() {
      palette = [];
      if (item) {
        const k = Math.min(1, 160 / Math.max(item.width, item.height));
        const small = T.canvas(item.width * k, item.height * k);
        const ctx = small.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(item.image, 0, 0, small.width, small.height);
        palette = extract(ctx.getImageData(0, 0, small.width, small.height).data, Number(count.value()));
      }
      swatches.innerHTML = palette
        .map(
          (p, i) => `
          <li><button type="button" class="pal-swatch" data-i="${i}" style="background:${hex(p.color)};color:${inkFor(p.color)}" aria-label="Copy ${hex(p.color)}">
            <strong>${hex(p.color)}</strong><small>${Math.max(1, Math.round(p.share * 100))}%</small>
          </button></li>`,
        )
        .join("");
      paletteActions.querySelectorAll("button").forEach((b) => (b.disabled = !palette.length));
    }

    function refresh() {
      slot.textContent = "";
      slot.appendChild(item ? stage.el : drop);
      hint.hidden = !item;
      clearButton.disabled = !item;
      if (item) stage.fit(item.width, item.height);
      showPick();
      buildPalette();
    }

    async function addFiles(files) {
      const [next] = await T.loadItems(T.imageFiles(files).slice(0, 1));
      if (!next) return;
      T.releaseItem(item);
      item = next;
      current = null;
      refresh();
    }

    function paletteImage() {
      const w = 160;
      const canvas = T.canvas(w * palette.length, 220);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      palette.forEach((p, i) => {
        ctx.fillStyle = hex(p.color);
        ctx.fillRect(i * w, 0, w, 170);
        ctx.fillStyle = "#222222";
        ctx.font = "600 20px ui-monospace, Menlo, Consolas, monospace";
        ctx.fillText(hex(p.color), i * w + 14, 202);
      });
      return canvas;
    }

    // Pointer: press and drag to explore, release to keep the colour.
    let pressing = false;
    const toImage = (event) => {
      const box = stage.canvas.getBoundingClientRect();
      return [((event.clientX - box.left) / box.width) * item.width, ((event.clientY - box.top) / box.height) * item.height];
    };
    stage.canvas.addEventListener("pointerdown", (event) => {
      if (!item) return;
      pressing = true;
      try {
        stage.canvas.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic pointer */
      }
      pickAt(...toImage(event), false);
    });
    stage.canvas.addEventListener("pointermove", (event) => pressing && pickAt(...toImage(event), false));
    stage.canvas.addEventListener("pointerup", (event) => {
      if (!pressing) return;
      pressing = false;
      pickAt(...toImage(event), true);
    });
    stage.canvas.addEventListener("pointercancel", () => (pressing = false));
    stage.canvas.addEventListener("keydown", (event) => {
      if (!item) return;
      const step = event.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (!d && event.key !== "Enter") return;
      event.preventDefault();
      const base = current || { x: Math.floor(item.width / 2), y: Math.floor(item.height / 2) };
      pickAt(base.x + (d ? d[0] : 0), base.y + (d ? d[1] : 0), true);
    });

    picked.addEventListener("click", (event) => {
      const copy = event.target.closest("[data-copy]");
      const chip = event.target.closest("[data-hex]");
      if (copy && current) copyText(picked.querySelector(`[data-f="${copy.dataset.copy}"]`).textContent);
      if (chip) copyText(chip.dataset.hex);
    });
    swatches.addEventListener("click", (event) => {
      const b = event.target.closest("[data-i]");
      if (b) copyText(hex(palette[Number(b.dataset.i)].color));
    });
    paletteActions.addEventListener("click", async (event) => {
      const b = event.target.closest("[data-pal]");
      if (!b || !palette.length) return;
      const list = palette.map((p) => hex(p.color));
      if (b.dataset.pal === "copy") copyText(list.join(", "));
      if (b.dataset.pal === "css") copyText(list.map((h, i) => `--color-${i + 1}: ${h};`).join("\n"));
      if (b.dataset.pal === "png") {
        const blob = await T.encode(paletteImage(), { mime: "image/png", ext: "png", lossy: false });
        T.download(blob, `${T.baseName(item.file.name)}-palette.png`);
      }
    });
    count.addEventListener("change", buildPalette);
    view.querySelector('[data-act="change"]').addEventListener("click", () => T.pickFiles({}, addFiles));
    clearButton.addEventListener("click", () => {
      T.releaseItem(item);
      item = null;
      current = null;
      refresh();
    });

    refresh();
    return { addFiles, pickAt: (x, y) => (pickAt(x, y, true), current), palette: () => palette.map((p) => ({ hex: hex(p.color), share: p.share })), extract, hsl };
  }

  T.register({
    id: "palette",
    name: "Colour picker & palette",
    short: "Colours",
    blurb: "Tap a picture to get a colour's HEX, RGB and HSL, and pull out its 5–8 main colours.",
    tags: ["Copy"],
    group: "colour",
    icon: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 10c0-4.4-4.5-8-10-8z"/>',
    create,
  });
})(window.CL = window.CL || {});
