// Batch queue: ingest of one or many files, sequential compression through
// the worker, per-file rows, and the download-all ZIP.
(function (CL) {
  "use strict";

  let els = null;

  function outputName(item, codec) {
    const base = item.file.name.replace(/\.[^.]+$/, "") || "compressed";
    const suffix = codec.lossy ? "compressed" : "lossless";
    return `${base}-${suffix}.${codec.ext}`;
  }

  function nextDirty() {
    const active = CL.activeItem();
    if (active && active.dirty) return active;
    return CL.state.items.find((item) => item.dirty) || null;
  }

  async function compressItem(item) {
    const settings = CL.settings.read();
    const codecId = settings.codec;
    const codec = CL.codecs[codecId];
    item.dirty = false;

    if (!CL.state.supported[codecId]) {
      item.status = "error";
      item.error = `${codec.label} encoding is not available in this browser.`;
      CL.toast(item.error);
      updateQueueUI();
      CL.hooks.onItemChanged?.(item);
      return;
    }

    item.status = "working";
    item.error = "";
    updateQueueUI();
    CL.hooks.onItemChanged?.(item);

    try {
      const isPalette = codecId === "png-palette";
      const canvas = CL.imageio.buildCanvas(item, codec, settings);
      // Only palette mode needs a separate un-quantized reference; for every
      // other codec the working canvas already is the reference.
      const reference = isPalette ? CL.imageio.buildCanvas(item, codec, settings) : canvas;
      if (isPalette) {
        await CL.imageio.quantizeCanvas(
          canvas,
          CL.paletteLevels[settings.palette - 1],
          settings.dither,
        );
      }

      const { blob, note } = await CL.imageio.encode(canvas, codec, settings);
      if (item.output?.url) URL.revokeObjectURL(item.output.url);
      const url = URL.createObjectURL(blob);
      const metrics = await CL.imageio.metricsFor(reference, url);

      const targetKB = Number(settings.targetKB);
      const targetNote = codec.targetable && targetKB > 0 ? `, target ${targetKB} KB` : "";
      item.output = {
        blob,
        url,
        width: canvas.width,
        height: canvas.height,
        codecId,
        lossy: codec.lossy,
        fingerprint: CL.settings.fingerprint(),
        delta: metrics.delta,
        ssim: metrics.ssim,
        summary: `${codec.label}${note}${targetNote}. ${CL.formatBytes(
          item.file.size,
        )} became ${CL.formatBytes(blob.size)}.`,
      };
      item.status = "done";
      CL.hooks.addHistory?.(item);
    } catch (error) {
      console.error(error);
      item.status = "error";
      item.error = error.message || "Compression failed.";
      CL.toast(item.error);
    }

    updateQueueUI();
    CL.hooks.onItemChanged?.(item);
    CL.hooks.onTotals?.();
  }

  // Single processing loop: whatever marks items dirty just calls pump();
  // overlapping calls coalesce into the run already in flight.
  async function pump() {
    if (CL.state.processing) return;
    CL.state.processing = true;
    CL.hooks.onBusy?.(true);
    try {
      let item;
      while ((item = nextDirty())) {
        await compressItem(item);
      }
    } finally {
      CL.state.processing = false;
      CL.hooks.onBusy?.(false);
    }
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) {
      CL.toast("Please choose an image file.");
      return;
    }

    const added = [];
    let gifWarned = false;
    let sizeWarned = false;
    for (const file of files) {
      try {
        const item = await CL.imageio.createItem(file);
        CL.state.items.push(item);
        added.push(item);
        if (item.isGif && !gifWarned) {
          CL.toast("Animated GIFs keep only their first frame.");
          gifWarned = true;
        }
        if (item.downscaled && !sizeWarned) {
          CL.toast("A very large image was downscaled to a size this browser can encode.");
          sizeWarned = true;
        }
      } catch (error) {
        CL.toast(`${file.name}: ${error.message}`);
      }
    }
    if (!added.length) return;

    CL.hooks.onFilesAdded?.(added);
    setActive(added[0].id);
    updateQueueUI();
    CL.hooks.onTotals?.();
    pump();
  }

  function setActive(id) {
    CL.state.activeId = id;
    CL.hooks.onActiveChanged?.(CL.activeItem());
    updateQueueUI();
  }

  function removeItem(id) {
    const index = CL.state.items.findIndex((item) => item.id === id);
    if (index === -1) return;
    const [item] = CL.state.items.splice(index, 1);
    if (item.displayUrl && item.displayUrl !== item.sourceUrl) {
      URL.revokeObjectURL(item.displayUrl);
    }
    URL.revokeObjectURL(item.sourceUrl);
    if (item.output?.url) URL.revokeObjectURL(item.output.url);

    if (CL.state.activeId === id) {
      const next = CL.state.items[index] || CL.state.items[index - 1] || null;
      setActive(next ? next.id : null);
    } else {
      updateQueueUI();
    }
    CL.hooks.onTotals?.();
  }

  function markActiveDirty() {
    const item = CL.activeItem();
    if (item) item.dirty = true;
  }

  function markAllDirty() {
    CL.state.items.forEach((item) => {
      item.dirty = true;
    });
  }

  // ── Queue UI ─────────────────────────────────────────────────────
  function statusLabel(item) {
    if (item.status === "working") return "Compressing…";
    if (item.status === "error") return item.error;
    if (item.status === "done" && item.output) {
      const saved = 1 - item.output.blob.size / item.file.size;
      const savedLabel =
        saved >= 0
          ? `saved ${Math.round(saved * 100)}%`
          : `${Math.round(Math.abs(saved) * 100)}% larger`;
      return `${CL.formatBytes(item.file.size)} → ${CL.formatBytes(
        item.output.blob.size,
      )} · ${savedLabel}`;
    }
    return "Queued";
  }

  function isStale(item) {
    return (
      item.status === "done" &&
      item.output &&
      !item.dirty &&
      item.output.fingerprint !== CL.settings.fingerprint()
    );
  }

  function updateQueueUI() {
    if (!els) return;
    const items = CL.state.items;
    els.queuePanel.hidden = items.length < 2;
    if (els.queuePanel.hidden) return;

    const done = items.filter((item) => item.status === "done").length;
    els.queueSummary.textContent = `${items.length} images · ${done} done`;
    els.zipButton.disabled = done === 0;

    els.queueList.textContent = "";
    for (const item of items) {
      const row = document.createElement("li");
      row.className = "queue-row";
      row.dataset.id = item.id;
      row.classList.toggle("is-active", item.id === CL.state.activeId);
      row.classList.toggle("is-error", item.status === "error");

      const thumb = document.createElement("img");
      thumb.className = "queue-thumb";
      thumb.src = item.displayUrl;
      thumb.alt = "";

      const info = document.createElement("div");
      info.className = "queue-info";
      const name = document.createElement("strong");
      name.textContent = item.file.name;
      const status = document.createElement("small");
      status.textContent = statusLabel(item);
      info.append(name, status);

      const state = document.createElement("span");
      state.className = "queue-state";
      state.dataset.state = item.status;
      if (isStale(item)) {
        state.dataset.state = "stale";
        state.title = "Settings changed since this file was compressed.";
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "queue-remove";
      remove.setAttribute("aria-label", `Remove ${item.file.name}`);
      remove.textContent = "×";

      row.append(thumb, info, state, remove);
      els.queueList.appendChild(row);
    }
  }

  // ── ZIP download ─────────────────────────────────────────────────
  async function zipAll() {
    const done = CL.state.items.filter((item) => item.status === "done" && item.output);
    if (!done.length) {
      CL.toast("Nothing to download yet.");
      return;
    }

    els.zipButton.disabled = true;
    const originalText = els.zipButton.textContent;
    els.zipButton.textContent = "Zipping…";
    try {
      const used = new Set();
      const entries = done.map((item) => {
        let name = outputName(item, CL.codecs[item.output.codecId]);
        if (used.has(name)) {
          const dot = name.lastIndexOf(".");
          let n = 2;
          let candidate;
          do {
            candidate = `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
            n += 1;
          } while (used.has(candidate));
          name = candidate;
        }
        used.add(name);
        return { name, blob: item.output.blob };
      });

      const blob = await CL.zip.create(entries);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "compress-lab.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      CL.toast(`ZIP with ${entries.length} images ready.`);
    } catch (error) {
      console.error(error);
      CL.toast("Could not build the ZIP file.");
    } finally {
      els.zipButton.textContent = originalText;
      els.zipButton.disabled = false;
    }
  }

  function init() {
    els = {
      queuePanel: document.querySelector("#queuePanel"),
      queueList: document.querySelector("#queueList"),
      queueSummary: document.querySelector("#queueSummary"),
      applyAllButton: document.querySelector("#applyAllButton"),
      zipButton: document.querySelector("#zipButton"),
    };

    els.queueList.addEventListener("click", (event) => {
      const row = event.target.closest(".queue-row");
      if (!row) return;
      if (event.target.closest(".queue-remove")) {
        removeItem(row.dataset.id);
        return;
      }
      setActive(row.dataset.id);
    });

    els.applyAllButton.addEventListener("click", () => {
      markAllDirty();
      pump();
    });

    els.zipButton.addEventListener("click", zipAll);
  }

  CL.batch = {
    init,
    addFiles,
    setActive,
    removeItem,
    markActiveDirty,
    markAllDirty,
    pump,
    updateQueueUI,
    outputName,
  };
})(window.CL = window.CL || {});
