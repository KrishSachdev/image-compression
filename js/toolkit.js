// Tool hub: the registry every tool adds itself to, the #hash router, the
// tool bar + "All tools" grid, and shared helpers the tools build on
// (drop zones, the "Save as" picker, downloads, sharing, the reorderable
// image list). Compress is registered here and keeps its own markup.
(function (CL) {
  "use strict";

  const T = {};
  const registry = [];
  const byId = new Map();
  let current = "";

  // ── Small helpers ────────────────────────────────────────────────
  T.icon = (paths, size = 18) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  T.el = (html) => {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  };

  T.escape = (text) =>
    String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  T.baseName = (name) => String(name || "image").replace(/\.[^.]+$/, "") || "image";

  T.icons = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    compress: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  };

  // ── Registry and router ──────────────────────────────────────────
  // def: { id, name, short, blurb, tags, icon, create(view) → { addFiles, onShow } }
  T.register = function (def) {
    registry.push(def);
    byId.set(def.id, def);
  };

  // Views are built the first time a tool is opened, so unused tools cost
  // nothing at start-up.
  function ensureView(def) {
    if (!def.view) {
      const view = document.createElement("main");
      view.className = "tool-view";
      view.id = `view-${def.id}`;
      view.hidden = true;
      view.setAttribute("aria-label", def.name);
      document.querySelector("#toolViews").appendChild(view);
      def.view = view;
    }
    if (!def.api) def.api = def.create(def.view) || {};
    return def.view;
  }

  function show(id) {
    const def = byId.get(id) || byId.get("tools");
    const view = ensureView(def);
    if (current && current !== def.id) window.scrollTo(0, 0);
    current = def.id;
    document.body.dataset.view = def.id;
    registry.forEach((other) => {
      if (other.view) other.view.hidden = other !== def;
    });
    document.querySelectorAll(".tool-tab").forEach((tab) => {
      if (tab.dataset.tool === def.id) {
        tab.setAttribute("aria-current", "page");
        // Keep the active tab visible in the scrolling bar on phones.
        tab.scrollIntoView({ block: "nearest", inline: "nearest" });
      } else tab.removeAttribute("aria-current");
    });
    document.title = def.id === "tools" ? "Compress Lab" : `${def.name} · Compress Lab`;
    def.api?.onShow?.();
    return view;
  }

  function routeFromHash() {
    const id = decodeURIComponent(location.hash.replace(/^#/, ""));
    // No hash (a fresh start) opens All tools: the app has many tools now.
    show(byId.has(id) ? id : "tools");
  }

  T.show = (id) => {
    const hash = id === "compress" ? "#compress" : `#${id}`;
    if (location.hash !== hash) location.hash = hash; // hashchange → show()
    else show(id);
  };

  T.current = () => current;

  // A tool's public functions (used by tests and for chaining tools).
  T.api = (id) => byId.get(id)?.api || null;

  // Files from paste or a drop anywhere on the page go to the open tool.
  T.routeFiles = function (files) {
    const def = byId.get(current);
    if (!def || def.id === "compress" || def.id === "tools") {
      if (def?.id === "tools") T.show("compress");
      CL.batch.addFiles(files);
      return;
    }
    def.api?.addFiles?.(files);
  };

  // ── Hub ("All tools") and tool bar ───────────────────────────────
  // Tools are grouped (by `group` in their definition) so the bar and the
  // grid stay tidy as the toolbox grows. Inside a group, script order wins.
  const GROUPS = [
    { id: "hub", label: "" },
    { id: "optimise", label: "Shrink & convert" },
    { id: "combine", label: "Combine & split" },
    { id: "edit", label: "Edit" },
    { id: "privacy", label: "Privacy" },
    { id: "colour", label: "Colour" },
    { id: "make", label: "Make" },
  ];
  const groupIndex = (def) => {
    const i = GROUPS.findIndex((g) => g.id === (def.hub ? "hub" : def.group || "edit"));
    return i < 0 ? GROUPS.length : i;
  };
  const ordered = () =>
    registry
      .map((def, i) => ({ def, i }))
      .sort((a, b) => groupIndex(a.def) - groupIndex(b.def) || a.i - b.i)
      .map((x) => x.def);

  function buildNav() {
    const nav = document.querySelector("#toolNav");
    let lastGroup = -1;
    nav.innerHTML = ordered()
      .map((def) => {
        const g = groupIndex(def);
        const sep = lastGroup >= 0 && g !== lastGroup ? '<span class="tool-sep" aria-hidden="true"></span>' : "";
        lastGroup = g;
        return `${sep}<a class="tool-tab" href="#${def.id}" data-tool="${def.id}">${T.icon(def.icon)}<span>${T.escape(
          def.short || def.name,
        )}</span></a>`;
      })
      .join("");
  }

  T.register({
    id: "tools",
    name: "All tools",
    short: "All tools",
    icon: T.icons.grid,
    hub: true,
    create(view) {
      view.classList.add("hub-view");
      const card = (def) => `
          <li><a class="hub-card" href="#${def.id}">
            <span class="hub-icon">${T.icon(def.icon, 22)}</span>
            <span class="hub-text">
              <strong>${T.escape(def.name)}</strong>
              <small>${T.escape(def.blurb || "")}</small>
              ${def.tags ? `<span class="hub-tags">${def.tags.map((t) => `<em>${T.escape(t)}</em>`).join("")}</span>` : ""}
            </span>
          </a></li>`;
      const tools = ordered().filter((def) => !def.hub);
      // Groups sit in columns so every tool fits on one screen without
      // scrolling; the small groups share the last column.
      const COLUMNS = [["optimise"], ["combine"], ["edit"], ["privacy", "colour", "make"]];
      const placed = new Set(COLUMNS.flat());
      GROUPS.forEach((g) => g.id !== "hub" && !placed.has(g.id) && COLUMNS[COLUMNS.length - 1].push(g.id));
      const group = (id) => {
        const g = GROUPS.find((x) => x.id === id);
        const inGroup = tools.filter((def) => (def.group || "edit") === id);
        if (!g || !inGroup.length) return "";
        return `<div class="hub-group"><h3>${T.escape(g.label)}</h3><ul class="hub-grid">${inGroup.map(card).join("")}</ul></div>`;
      };
      const cards = COLUMNS.map((ids) => `<div class="hub-col">${ids.map(group).join("")}</div>`).join("");
      view.innerHTML = `
        <section class="panel hub-panel" aria-labelledby="hubTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Toolbox</p>
              <h2 id="hubTitle">All tools</h2>
            </div>
          </div>
          <p class="tool-blurb">Every tool runs inside this page. Your images are never uploaded, and the app works offline once it has loaded.</p>
          <div class="hub-groups">${cards}</div>
        </section>`;
      return {};
    },
  });

  T.register({
    id: "compress",
    name: "Compress & convert",
    short: "Compress",
    blurb: "Shrink, convert (WebP, AVIF, JPEG, PNG), resize and rotate. One image or a whole batch.",
    tags: ["Batch", "Compare"],
    group: "optimise",
    icon: T.icons.compress,
    view: document.querySelector("#view-compress"),
    create() {
      return {
        addFiles: (files) => CL.batch.addFiles(files),
        onShow: () => CL.hooks.onCompressShown?.(),
      };
    },
  });

  // ── Image loading ────────────────────────────────────────────────
  T.imageFiles = (fileList) =>
    Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));

  // Decode files into items (same shape Compress uses). Bad files are
  // reported and skipped.
  T.loadItems = async function (fileList) {
    const files = T.imageFiles(fileList);
    if (!files.length) {
      CL.toast("Please choose an image file.");
      return [];
    }
    const items = [];
    for (const file of files) {
      try {
        const item = await CL.imageio.createItem(file);
        item.thumb = T.thumb(item.image, item.width, item.height);
        items.push(item);
        if (item.downscaled) CL.toast("A very large image was scaled down so this browser can handle it.");
      } catch (error) {
        CL.toast(`${file.name}: ${error.message}`);
      }
    }
    return items;
  };

  T.thumb = function (source, width, height, max = 360) {
    const scale = Math.min(1, max / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(CL.state.supported.webp === false ? "image/png" : "image/webp", 0.82);
  };

  T.releaseItem = function (item) {
    if (!item) return;
    if (item.displayUrl && item.displayUrl !== item.sourceUrl) URL.revokeObjectURL(item.displayUrl);
    URL.revokeObjectURL(item.sourceUrl);
  };

  // Largest canvas we try to make. Browsers differ (iOS is the strictest);
  // callers scale down to fit and encode() retries smaller if a browser
  // still refuses.
  T.MAX_SIDE = 16384;
  T.MAX_AREA = 40_000_000;
  T.fitScale = (width, height) =>
    Math.min(1, T.MAX_SIDE / width, T.MAX_SIDE / height, Math.sqrt(T.MAX_AREA / (width * height)));

  T.canvas = function (width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  };

  // Scale an image to width × height. Big reductions go down in halves
  // first, which keeps fine detail sharper than one giant jump.
  T.resample = function (source, srcW, srcH, width, height) {
    let current = source;
    let cw = srcW;
    let ch = srcH;
    while (cw / 2 >= width && ch / 2 >= height) {
      const step = T.canvas(cw / 2, ch / 2);
      const sctx = step.getContext("2d");
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(current, 0, 0, step.width, step.height);
      current = step;
      cw = step.width;
      ch = step.height;
    }
    const out = T.canvas(width, height);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, out.width, out.height);
    return out;
  };

  // ── Drop zone ────────────────────────────────────────────────────
  T.dropzone = function ({ multiple = false, title, hint, onFiles }) {
    const id = `drop-${Math.random().toString(36).slice(2, 8)}`;
    const zone = T.el(`
      <label class="tool-drop" for="${id}">
        <input id="${id}" type="file" accept="image/*" ${multiple ? "multiple" : ""} />
        <span class="tool-drop-icon">${T.icon(T.icons.upload, 26)}</span>
        <strong>${T.escape(title)}</strong>
        <span>${T.escape(hint)}</span>
      </label>`);
    const input = zone.querySelector("input");
    input.addEventListener("change", () => {
      if (input.files.length) onFiles(input.files);
      input.value = "";
    });
    return zone;
  };

  // Opens the file picker without a visible input (for "Add images" buttons).
  T.pickFiles = function ({ multiple = false } = {}, onFiles) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = multiple;
    input.addEventListener("change", () => {
      if (input.files.length) onFiles(input.files);
    });
    input.click();
  };

  // ── Segmented choice (radio group styled as buttons) ─────────────
  T.segmented = function (name, options, value, label) {
    const group = T.el(`<div class="seg" role="radiogroup" aria-label="${T.escape(label || name)}"></div>`);
    for (const option of options) {
      const item = T.el(`
        <label class="seg-option"${option.title ? ` title="${T.escape(option.title)}"` : ""}>
          <input type="radio" name="${name}" value="${T.escape(option.value)}" />
          <span>${T.escape(option.label)}</span>
        </label>`);
      if (option.value === value) item.querySelector("input").checked = true;
      group.appendChild(item);
    }
    group.value = () => group.querySelector("input:checked")?.value;
    group.set = (next) => {
      const input = group.querySelector(`input[value="${CSS.escape(next)}"]`);
      if (input) input.checked = true;
    };
    return group;
  };

  // ── "Save as" picker ─────────────────────────────────────────────
  const FORMATS = {
    "image/png": { ext: "png", label: "PNG", lossy: false },
    "image/jpeg": { ext: "jpg", label: "JPEG", lossy: true },
    "image/webp": { ext: "webp", label: "WebP", lossy: true },
  };

  T.formatField = function (name, { initial = "original", quality = 92 } = {}) {
    const wrap = T.el(`
      <div class="field">
        <div class="field-label"><strong>Save as</strong><small>Original keeps the file type you added</small></div>
      </div>`);
    const options = [
      { value: "original", label: "Original" },
      { value: "image/png", label: "PNG" },
      { value: "image/jpeg", label: "JPEG" },
    ];
    if (CL.state.supported.webp !== false) options.push({ value: "image/webp", label: "WebP" });
    const seg = T.segmented(`${name}-format`, options, initial, "Output format");
    const range = T.el(`
      <label class="field range-field">
        <span class="field-label"><strong>Quality</strong><output>${quality}%</output></span>
        <input type="range" min="40" max="100" step="1" value="${quality}" aria-label="Output quality" />
      </label>`);
    const input = range.querySelector("input");
    const output = range.querySelector("output");
    wrap.append(seg, range);

    let sourceType = "";
    // `type` lets a batch resolve "Original" per file (each keeps its own).
    const resolve = (type) => {
      let mime = seg.value();
      if (mime === "original") {
        const from = type || sourceType;
        mime = FORMATS[from] ? from : "image/png";
        if (mime === "image/webp" && CL.state.supported.webp === false) mime = "image/png";
      }
      return { mime, ...FORMATS[mime], quality: Number(input.value) / 100 };
    };
    const sync = () => {
      output.value = `${input.value}%`;
      range.hidden = !resolve().lossy;
    };
    seg.addEventListener("change", () => {
      sync();
      wrap.dispatchEvent(new Event("formatchange", { bubbles: true }));
    });
    input.addEventListener("input", () => {
      sync();
      wrap.dispatchEvent(new Event("formatchange", { bubbles: true }));
    });
    sync();

    wrap.setSource = (type) => {
      sourceType = type || "";
      sync();
    };
    wrap.get = (type) => resolve(type);
    wrap.isOriginal = () => seg.value() === "original";
    return wrap;
  };

  // Encode a canvas. JPEG has no transparency, so it is flattened onto white.
  // If the browser refuses (canvas too big), retry at smaller sizes.
  T.encode = async function (canvas, format) {
    let source = canvas;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let target = source;
      if (format.mime === "image/jpeg") {
        target = T.canvas(source.width, source.height);
        const ctx = target.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, target.width, target.height);
        ctx.drawImage(source, 0, 0);
      }
      const blob = await CL.canvasToBlob(target, format.mime, format.lossy ? format.quality : undefined);
      if (blob && blob.size) return blob;
      const smaller = T.canvas(source.width * 0.7, source.height * 0.7);
      smaller.getContext("2d").drawImage(source, 0, 0, smaller.width, smaller.height);
      source = smaller;
    }
    throw new Error("This browser could not save an image that large.");
  };

  // ── Output: download, share, hand over to Compress ───────────────
  T.download = function (blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
  };

  T.toFiles = (entries) =>
    entries.map((entry) => new File([entry.blob], entry.name, { type: entry.blob.type }));

  T.canShare = function (entries) {
    try {
      return Boolean(navigator.canShare && navigator.canShare({ files: T.toFiles(entries) }));
    } catch {
      return false;
    }
  };

  T.share = async function (entries, title) {
    try {
      await navigator.share({ files: T.toFiles(entries), title });
    } catch (error) {
      if (error && error.name !== "AbortError") CL.toast("Sharing did not work here. Use Download instead.");
    }
  };

  T.zip = async function (entries, zipName) {
    const blob = await CL.zip.create(entries);
    T.download(blob, zipName);
    return blob;
  };

  T.sendToCompress = function (entries) {
    const files = T.toFiles(entries);
    T.show("compress");
    CL.batch.addFiles(files);
  };

  // Shared result bar: Download / Share / Send to Compress.
  T.outputActions = function ({ onDownload, onShare, onCompress, downloadLabel = "Download" }) {
    const bar = T.el(`
      <div class="tool-actions">
        <button type="button" class="primary-button" data-act="download" disabled>${T.icon(T.icons.download)}<span>${T.escape(downloadLabel)}</span></button>
        <div class="tool-actions-row">
          <button type="button" class="ghost-button" data-act="share" hidden disabled>${T.icon(T.icons.share, 16)}<span>Share</span></button>
          <button type="button" class="ghost-button" data-act="compress" disabled>${T.icon(T.icons.compress, 16)}<span>Send to Compress</span></button>
        </div>
      </div>`);
    const buttons = {
      download: bar.querySelector('[data-act="download"]'),
      share: bar.querySelector('[data-act="share"]'),
      compress: bar.querySelector('[data-act="compress"]'),
    };
    buttons.download.addEventListener("click", onDownload);
    buttons.share.addEventListener("click", onShare || (() => {}));
    buttons.compress.addEventListener("click", onCompress || (() => {}));
    if (!onCompress) buttons.compress.hidden = true;
    bar.setEnabled = (enabled, { shareable = false } = {}) => {
      buttons.download.disabled = !enabled;
      buttons.compress.disabled = !enabled;
      buttons.share.hidden = !(enabled && shareable && onShare);
      buttons.share.disabled = !enabled;
    };
    bar.setLabel = (text) => {
      buttons.download.querySelector("span").textContent = text;
    };
    bar.buttons = buttons;
    return bar;
  };

  // ── Reorderable image list (Images to PDF, Stitch) ───────────────
  // figure(item) returns the HTML for the card's picture area.
  T.imageList = function ({ label, rotate = false, reorder = true, figure, extra, onChange }) {
    const list = T.el(`<ol class="img-list" aria-label="${T.escape(label)}"></ol>`);
    const state = { items: [] };

    function render(focus) {
      list.textContent = "";
      state.items.forEach((item, index) => {
        const card = T.el(`
          <li class="img-card" data-id="${item.id}">
            <div class="img-card-figure">${figure(item, index)}</div>
            <span class="img-card-num">${index + 1}</span>
            ${extra ? `<div class="img-card-extra">${extra(item, index)}</div>` : ""}
            <div class="img-card-foot">
              <span class="img-card-name" title="${T.escape(item.file.name)}">${T.escape(item.file.name)}</span>
              <div class="img-card-actions${reorder ? "" : " is-simple"}">
                ${reorder ? `<button type="button" class="icon-btn drag-handle" aria-label="Drag to reorder ${T.escape(item.file.name)}" title="Drag to reorder">${T.icon(T.icons.grip, 16)}</button>
                <button type="button" class="icon-btn" data-act="left" aria-label="Move ${T.escape(item.file.name)} earlier" title="Move earlier" ${index === 0 ? "disabled" : ""}>${T.icon(T.icons.left, 16)}</button>
                <button type="button" class="icon-btn" data-act="right" aria-label="Move ${T.escape(item.file.name)} later" title="Move later" ${index === state.items.length - 1 ? "disabled" : ""}>${T.icon(T.icons.right, 16)}</button>` : ""}
                ${rotate ? `<button type="button" class="icon-btn" data-act="rotate" aria-label="Rotate ${T.escape(item.file.name)}" title="Rotate 90°">${T.icon(T.icons.rotate, 16)}</button>` : ""}
                <button type="button" class="icon-btn" data-act="remove" aria-label="Remove ${T.escape(item.file.name)}" title="Remove">${T.icon(T.icons.close, 16)}</button>
              </div>
            </div>
          </li>`);
        list.appendChild(card);
      });
      if (focus) {
        const button = list.querySelector(`[data-id="${focus.id}"] [data-act="${focus.act}"]`);
        (button && !button.disabled ? button : list.querySelector(`[data-id="${focus.id}"] .drag-handle`))?.focus();
      }
    }

    function changed(focus) {
      render(focus);
      onChange?.();
    }

    list.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-act]");
      if (!button) return;
      const id = button.closest(".img-card").dataset.id;
      const index = state.items.findIndex((item) => item.id === id);
      const act = button.dataset.act;
      if (act === "left" && index > 0) {
        state.items.splice(index - 1, 0, state.items.splice(index, 1)[0]);
      } else if (act === "right" && index < state.items.length - 1) {
        state.items.splice(index + 1, 0, state.items.splice(index, 1)[0]);
      } else if (act === "rotate") {
        state.items[index].turn = ((state.items[index].turn || 0) + 90) % 360;
      } else if (act === "remove") {
        const [gone] = state.items.splice(index, 1);
        T.releaseItem(gone);
        const next = state.items[index] || state.items[index - 1];
        changed(next ? { id: next.id, act: "remove" } : null);
        return;
      }
      changed({ id, act });
    });

    // Pointer drag on the grip handle: works with mouse, pen and touch.
    let drag = null;
    list.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest(".drag-handle");
      if (!handle || event.button !== 0) return;
      const card = handle.closest(".img-card");
      drag = { card, id: card.dataset.id, pointerId: event.pointerId, moved: false };
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic or already-released pointer */
      }
      card.classList.add("is-dragging");
      event.preventDefault();
    });
    list.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const over = document.elementFromPoint(event.clientX, event.clientY)?.closest(".img-card");
      if (!over || over === drag.card || over.parentElement !== list) return;
      const cards = [...list.children];
      if (cards.indexOf(over) > cards.indexOf(drag.card)) over.after(drag.card);
      else over.before(drag.card);
      drag.moved = true;
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const { moved, id } = drag;
      drag.card.classList.remove("is-dragging");
      drag = null;
      if (!moved) return;
      const order = [...list.children].map((card) => card.dataset.id);
      state.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      changed({ id, act: "drag" });
    };
    list.addEventListener("pointerup", endDrag);
    list.addEventListener("pointercancel", endDrag);
    // Keyboard on the grip: arrows move the image.
    list.addEventListener("keydown", (event) => {
      const handle = event.target.closest(".drag-handle");
      if (!handle) return;
      const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
      if (!delta) return;
      event.preventDefault();
      const id = handle.closest(".img-card").dataset.id;
      const index = state.items.findIndex((item) => item.id === id);
      const target = index + delta;
      if (target < 0 || target >= state.items.length) return;
      state.items.splice(target, 0, state.items.splice(index, 1)[0]);
      changed({ id, act: "drag" });
    });

    return {
      el: list,
      get items() {
        return state.items;
      },
      add(items) {
        state.items.push(...items);
        changed();
      },
      clear() {
        state.items.forEach(T.releaseItem);
        state.items = [];
        changed();
      },
      sortByName(reverse = false) {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
        state.items.sort((a, b) => collator.compare(a.file.name, b.file.name) * (reverse ? -1 : 1));
        changed();
      },
      render,
    };
  };

  // ── Boot ─────────────────────────────────────────────────────────
  function init() {
    buildNav();
    window.addEventListener("hashchange", routeFromHash);

    // On laptop/desktop screens every view fills the window below the tool
    // bar, so the page itself does not scroll (styles.css, "Fit to window").
    // --chrome = where the views start; it changes if the tool bar wraps.
    const navEl = document.querySelector("#toolNav");
    const fitViews = () => {
      const top = navEl.getBoundingClientRect().bottom + window.scrollY;
      document.documentElement.style.setProperty("--chrome", `${Math.ceil(top + 12)}px`);
    };
    fitViews();
    window.addEventListener("resize", fitViews);
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(fitViews);
      ro.observe(navEl);
      ro.observe(document.querySelector(".topbar"));
    }

    // Dropping a file anywhere must never make the browser navigate away
    // from the app (it would lose all work). Route it to the open tool.
    document.addEventListener("dragover", (event) => {
      if (event.dataTransfer && [...event.dataTransfer.types].includes("Files")) {
        event.preventDefault();
        document.body.classList.add("is-file-over");
      }
    });
    document.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget) document.body.classList.remove("is-file-over");
    });
    document.addEventListener("drop", (event) => {
      document.body.classList.remove("is-file-over");
      if (event.defaultPrevented || !event.dataTransfer?.files?.length) return;
      event.preventDefault();
      T.routeFiles(event.dataTransfer.files);
    });

    routeFromHash();
  }

  CL.tools = { register: T.register, show: T.show, current: T.current, routeFiles: T.routeFiles };
  CL.toolkit = T;
  document.addEventListener("DOMContentLoaded", init);
})(window.CL = window.CL || {});
