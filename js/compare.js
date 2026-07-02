// Result preview: compare split, view modes, zoom & pan, and the loupe.
// Layout contract with index.html: the compare box contains a viewport with
// two stacked panes (before / after). Each pane holds a .zoom-layer that gets
// an identical translate+scale transform, and the split clip is applied to
// the after pane at viewport level, so the divider keeps working at any zoom.
(function (CL) {
  "use strict";

  const MAX_SCALE = 8;
  const LOUPE_SIZE = 180;
  const LOUPE_MAGNIFY = 2.5;

  let els = null;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let drag = null; // { mode: "split" | "pan", pointerId, lastX, lastY }
  let loupeOn = false;

  function hasImage() {
    return Boolean(CL.activeItem());
  }

  function hasOutput() {
    return els.compareBox.classList.contains("has-output");
  }

  function viewportRect() {
    return els.viewport.getBoundingClientRect();
  }

  function applyTransform() {
    const transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    els.beforeLayer.style.transform = transform;
    els.afterLayer.style.transform = transform;
    els.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    els.viewport.classList.toggle("is-zoomed", scale > 1.001);
    syncCursor();
  }

  function clampPan() {
    const rect = viewportRect();
    tx = CL.clamp(tx, rect.width * (1 - scale), 0);
    ty = CL.clamp(ty, rect.height * (1 - scale), 0);
  }

  function zoomAt(cx, cy, factor) {
    const next = CL.clamp(scale * factor, 1, MAX_SCALE);
    if (next === scale) return;
    tx = cx - (cx - tx) * (next / scale);
    ty = cy - (cy - ty) * (next / scale);
    scale = next;
    if (scale === 1) {
      tx = 0;
      ty = 0;
    }
    clampPan();
    applyTransform();
  }

  function zoomBy(factor) {
    const rect = viewportRect();
    zoomAt(rect.width / 2, rect.height / 2, factor);
  }

  function resetZoom() {
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  }

  function setSplit(value, fromSlider = false) {
    CL.state.split = CL.clamp(value, 0, 100);
    if (!fromSlider) els.slider.value = CL.state.split;
    syncPanes();
  }

  function syncPanes() {
    const mode = CL.state.previewMode;
    const split = CL.state.split;
    const isCompare = mode === "compare";
    els.compareBox.classList.toggle("is-compare", isCompare);
    els.beforePane.style.visibility =
      mode === "compressed" && hasOutput() ? "hidden" : "visible";
    els.afterPane.style.visibility = mode === "original" ? "hidden" : "visible";
    els.afterPane.style.clipPath =
      isCompare && hasOutput() ? `inset(0 0 0 ${split}%)` : "none";
    els.divider.style.left = `${split}%`;
    syncCursor();
  }

  function syncCursor() {
    let cursor = "default";
    if (scale > 1.001) cursor = drag && drag.mode === "pan" ? "grabbing" : "grab";
    else if (CL.state.previewMode === "compare" && hasOutput()) cursor = "ew-resize";
    els.viewport.style.cursor = cursor;
  }

  function setMode(mode) {
    CL.state.previewMode = mode;
    syncPanes();
  }

  function setBefore(url) {
    if (url) els.beforeImage.src = url;
    else els.beforeImage.removeAttribute("src");
  }

  function setAfter(url) {
    if (url) els.afterImage.src = url;
    else els.afterImage.removeAttribute("src");
    syncPanes();
  }

  // ── Pointer interactions ─────────────────────────────────────────
  function splitHit(px, width) {
    return Math.abs(px - (CL.state.split / 100) * width) < 16;
  }

  function onPointerDown(event) {
    if (!hasImage() || event.button !== 0) return;
    const rect = viewportRect();
    const px = event.clientX - rect.left;
    const isCompare = CL.state.previewMode === "compare" && hasOutput();

    let mode = null;
    if (isCompare && (scale <= 1.001 || splitHit(px, rect.width))) mode = "split";
    else if (scale > 1.001) mode = "pan";
    if (!mode) return;

    drag = { mode, pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    els.viewport.setPointerCapture(event.pointerId);
    if (mode === "split") setSplit(((px / rect.width) * 100));
    syncCursor();
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (loupeOn) drawLoupe(event.clientX, event.clientY);
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.mode === "split") {
      const rect = viewportRect();
      setSplit(((event.clientX - rect.left) / rect.width) * 100);
    } else {
      tx += event.clientX - drag.lastX;
      ty += event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      clampPan();
      applyTransform();
    }
  }

  function onPointerEnd(event) {
    if (drag && event.pointerId === drag.pointerId) {
      drag = null;
      syncCursor();
    }
  }

  function onWheel(event) {
    if (!hasImage()) return;
    event.preventDefault();
    const rect = viewportRect();
    zoomAt(
      event.clientX - rect.left,
      event.clientY - rect.top,
      event.deltaY < 0 ? 1.15 : 1 / 1.15,
    );
  }

  // ── Loupe ────────────────────────────────────────────────────────
  function setLoupe(on) {
    loupeOn = on && hasImage();
    els.loupeToggle.setAttribute("aria-pressed", String(loupeOn));
    els.loupeToggle.classList.toggle("is-active", loupeOn);
    if (!loupeOn) els.loupe.hidden = true;
  }

  function loupeSource(px, width) {
    const mode = CL.state.previewMode;
    const canAfter = hasOutput() && els.afterImage.src;
    if (mode === "compressed" && canAfter) return els.afterImage;
    if (mode === "compare" && canAfter && px >= (CL.state.split / 100) * width) {
      return els.afterImage;
    }
    return els.beforeImage.src ? els.beforeImage : null;
  }

  function drawLoupe(clientX, clientY) {
    const rect = viewportRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) {
      els.loupe.hidden = true;
      return;
    }

    const img = loupeSource(px, rect.width);
    if (!img || !img.naturalWidth) {
      els.loupe.hidden = true;
      return;
    }

    // Map the viewport point back through zoom, then through object-fit:
    // contain, to a source pixel.
    const fit = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const offsetX = (rect.width - img.naturalWidth * fit) / 2;
    const offsetY = (rect.height - img.naturalHeight * fit) / 2;
    const qx = (px - tx) / scale;
    const qy = (py - ty) / scale;
    const sx = (qx - offsetX) / fit;
    const sy = (qy - offsetY) / fit;
    if (sx < 0 || sy < 0 || sx > img.naturalWidth || sy > img.naturalHeight) {
      els.loupe.hidden = true;
      return;
    }

    const totalScale = fit * scale * LOUPE_MAGNIFY;
    const srcRadius = LOUPE_SIZE / 2 / totalScale;
    const ctx = els.loupe.getContext("2d");
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false; // pixel-peeping is the point
    ctx.drawImage(
      img,
      sx - srcRadius,
      sy - srcRadius,
      srcRadius * 2,
      srcRadius * 2,
      0,
      0,
      LOUPE_SIZE,
      LOUPE_SIZE,
    );
    ctx.restore();

    els.loupe.style.left = `${px - LOUPE_SIZE / 2}px`;
    els.loupe.style.top = `${py - LOUPE_SIZE / 2}px`;
    els.loupe.hidden = false;
  }

  function init() {
    els = {
      compareBox: document.querySelector("#compareBox"),
      viewport: document.querySelector("#compareViewport"),
      beforePane: document.querySelector("#beforePane"),
      afterPane: document.querySelector("#afterPane"),
      beforeLayer: document.querySelector("#beforePane .zoom-layer"),
      afterLayer: document.querySelector("#afterPane .zoom-layer"),
      beforeImage: document.querySelector("#beforeImage"),
      afterImage: document.querySelector("#afterImage"),
      divider: document.querySelector("#compareDivider"),
      slider: document.querySelector("#compareSlider"),
      loupe: document.querySelector("#loupeCanvas"),
      loupeToggle: document.querySelector("#loupeToggle"),
      zoomLabel: document.querySelector("#zoomLabel"),
    };

    els.viewport.addEventListener("pointerdown", onPointerDown);
    els.viewport.addEventListener("pointermove", onPointerMove);
    els.viewport.addEventListener("pointerup", onPointerEnd);
    els.viewport.addEventListener("pointercancel", onPointerEnd);
    els.viewport.addEventListener("pointerleave", () => {
      if (loupeOn) els.loupe.hidden = true;
    });
    els.viewport.addEventListener("wheel", onWheel, { passive: false });
    els.viewport.addEventListener("dblclick", resetZoom);

    // The invisible range input stays keyboard-only (pointer events are
    // handled on the viewport), keeping the split accessible.
    els.slider.addEventListener("input", () => {
      if (CL.state.previewMode !== "compare") {
        CL.state.previewMode = "compare";
        CL.hooks.onPreviewModeChanged?.();
      }
      setSplit(Number(els.slider.value), true);
    });

    syncPanes();
    applyTransform();
  }

  CL.compare = {
    init,
    setBefore,
    setAfter,
    setMode,
    setSplit,
    zoomBy,
    resetZoom,
    setLoupe,
    isLoupeOn: () => loupeOn,
    syncPanes,
  };
})(window.CL = window.CL || {});
