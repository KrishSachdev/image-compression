// Shared image stage + rectangle editor for Crop and Redact.
// The stage fits a canvas to the available space; the editor draws
// rectangles over it that can be drawn, moved and resized with mouse, touch
// or keyboard. Rectangles are stored in source-image pixels.
(function (CL) {
  "use strict";

  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  // A checkerboard box holding a canvas sized to fit (keeps the aspect ratio).
  CL.editorStage = function ({ label }) {
    const stage = CL.toolkit.el(`
      <div class="editor-stage">
        <div class="editor-frame">
          <canvas class="editor-layer" role="img" aria-label="${CL.toolkit.escape(label)}"></canvas>
        </div>
      </div>`);
    const frame = stage.querySelector(".editor-frame");
    const canvas = stage.querySelector("canvas");
    const api = { el: stage, frame, canvas, width: 0, height: 0, onFit: null };

    api.fit = function (width = api.width, height = api.height) {
      api.width = width;
      api.height = height;
      if (!width || !height || !stage.isConnected) return;
      const availW = Math.max(160, stage.clientWidth - 20);
      const availH = Math.max(220, Math.min(640, window.innerHeight * 0.62));
      const k = Math.min(availW / width, availH / height);
      const cssW = Math.max(1, Math.round(width * k));
      const cssH = Math.max(1, Math.round(height * k));
      frame.style.width = `${cssW}px`;
      frame.style.height = `${cssH}px`;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      api.scale = (cssW * dpr) / width; // source px → canvas px
      api.onFit?.();
    };

    new ResizeObserver(() => api.fit()).observe(stage);
    return api;
  };

  // host: the .editor-frame. opts: { multi, aspect(): number, onChange(rects),
  // onSelect(rect), label(rect) }
  CL.rectEditor = function (host, opts = {}) {
    const overlay = CL.toolkit.el('<div class="editor-overlay"></div>');
    host.appendChild(overlay);
    if (!opts.multi) overlay.classList.add("is-shaded");

    let W = 1;
    let H = 1;
    let rects = [];
    let selected = null;
    let drag = null;
    let seq = 0;
    const aspect = () => (opts.aspect ? opts.aspect() : 0);
    const clamp = CL.clamp;

    function toImage(event) {
      const box = overlay.getBoundingClientRect();
      return {
        x: clamp(((event.clientX - box.left) / box.width) * W, 0, W),
        y: clamp(((event.clientY - box.top) / box.height) * H, 0, H),
      };
    }

    function round(r) {
      const x = clamp(Math.round(r.x), 0, W - 1);
      const y = clamp(Math.round(r.y), 0, H - 1);
      return {
        ...r,
        x,
        y,
        w: clamp(Math.round(r.w), 1, W - x),
        h: clamp(Math.round(r.h), 1, H - y),
      };
    }

    // New box from dragging `handle` of `start` to point p, keeping the
    // aspect ratio (if any) and staying inside the image.
    function resize(start, handle, p, min = 4) {
      let left = start.x;
      let right = start.x + start.w;
      let top = start.y;
      let bottom = start.y + start.h;
      if (handle.includes("w")) left = clamp(p.x, 0, right - min);
      if (handle.includes("e")) right = clamp(p.x, left + min, W);
      if (handle.includes("n")) top = clamp(p.y, 0, bottom - min);
      if (handle.includes("s")) bottom = clamp(p.y, top + min, H);
      let w = right - left;
      let h = bottom - top;
      const r = aspect();
      if (r) {
        const horiz = /[ew]/.test(handle);
        const vert = /[ns]/.test(handle);
        if (horiz && vert) {
          if (w / h > r) w = h * r;
          else h = w / r;
        } else if (horiz) h = w / r;
        else w = h * r;
        const ax = handle.includes("w") ? right : handle.includes("e") ? left : start.x + start.w / 2;
        const ay = handle.includes("n") ? bottom : handle.includes("s") ? top : start.y + start.h / 2;
        const maxW = handle.includes("w") ? ax : handle.includes("e") ? W - ax : 2 * Math.min(ax, W - ax);
        const maxH = handle.includes("n") ? ay : handle.includes("s") ? H - ay : 2 * Math.min(ay, H - ay);
        if (w > maxW) {
          w = maxW;
          h = w / r;
        }
        if (h > maxH) {
          h = maxH;
          w = h * r;
        }
        left = handle.includes("w") ? ax - w : handle.includes("e") ? ax : ax - w / 2;
        top = handle.includes("n") ? ay - h : handle.includes("s") ? ay : ay - h / 2;
      }
      return { ...start, x: left, y: top, w, h };
    }

    // Biggest box of ratio r centred on (cx, cy) that fits in the image.
    function fitRatio(r, cx = W / 2, cy = H / 2) {
      let w = W;
      let h = W / r;
      if (h > H) {
        h = H;
        w = H * r;
      }
      return round({ x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h });
    }

    function render() {
      overlay.textContent = "";
      for (const r of rects) {
        const box = document.createElement("div");
        box.className = "editor-rect";
        box.dataset.id = r.id;
        box.tabIndex = 0;
        box.setAttribute("role", "button");
        box.setAttribute("aria-label", opts.label ? opts.label(r) : `Selection ${r.w} by ${r.h} pixels`);
        box.style.left = `${(r.x / W) * 100}%`;
        box.style.top = `${(r.y / H) * 100}%`;
        box.style.width = `${(r.w / W) * 100}%`;
        box.style.height = `${(r.h / H) * 100}%`;
        if (r.id === selected) {
          box.classList.add("is-selected");
          for (const h of HANDLES) {
            const handle = document.createElement("span");
            handle.className = "editor-handle";
            handle.dataset.h = h;
            box.appendChild(handle);
          }
        }
        overlay.appendChild(box);
      }
    }

    function emit() {
      render();
      opts.onChange?.(rects);
    }

    function select(id) {
      selected = id;
      render();
      opts.onSelect?.(rects.find((r) => r.id === id) || null);
    }

    overlay.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const p = toImage(event);
      const handle = event.target.closest(".editor-handle");
      const box = event.target.closest(".editor-rect");
      if (handle) {
        const r = rects.find((x) => x.id === box.dataset.id);
        drag = { mode: "resize", handle: handle.dataset.h, start: { ...r }, id: r.id };
      } else if (box) {
        const r = rects.find((x) => x.id === box.dataset.id);
        if (selected !== r.id) select(r.id);
        drag = { mode: "move", start: { ...r }, p0: p, id: r.id };
      } else {
        // Empty area: start drawing a new box (Crop replaces its only box).
        const r = { id: opts.multi ? `r${(seq += 1)}` : rects[0]?.id || "crop", x: p.x, y: p.y, w: 0, h: 0, ...(opts.defaults?.() || {}) };
        drag = { mode: "create", anchor: p, id: r.id, previous: rects.map((x) => ({ ...x })) };
        if (opts.multi) rects.push(r);
        else rects = [r];
        selected = r.id;
      }
      try {
        overlay.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic or already-released pointer: dragging still works */
      }
      drag.pointerId = event.pointerId;
      event.preventDefault();
    });

    overlay.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const p = toImage(event);
      const index = rects.findIndex((x) => x.id === drag.id);
      if (index < 0) return;
      let next;
      if (drag.mode === "move") {
        const s = drag.start;
        next = { ...s, x: clamp(s.x + p.x - drag.p0.x, 0, W - s.w), y: clamp(s.y + p.y - drag.p0.y, 0, H - s.h) };
      } else if (drag.mode === "resize") {
        next = resize(drag.start, drag.handle, p);
      } else {
        const a = drag.anchor;
        const handle = (p.y < a.y ? "n" : "s") + (p.x < a.x ? "w" : "e");
        next = resize({ ...rects[index], x: a.x, y: a.y, w: 0, h: 0 }, handle, p, 1);
      }
      rects[index] = round(next);
      render();
      opts.onChange?.(rects, { live: true });
    });

    const end = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const r = rects.find((x) => x.id === drag.id);
      if (drag.mode === "create" && (!r || r.w < 6 || r.h < 6)) {
        // A tap, not a drag: undo the new box (and just deselect).
        rects = drag.previous;
        selected = opts.multi ? null : rects[0]?.id || null;
        drag = null;
        emit();
        opts.onSelect?.(rects.find((x) => x.id === selected) || null);
        return;
      }
      // Redact leaves a freshly drawn box unselected, so picking an effect
      // next sets the style of the *next* box instead of changing this one.
      if (drag.mode === "create" && opts.multi && opts.selectNew === false) selected = null;
      drag = null;
      emit();
      opts.onSelect?.(rects.find((x) => x.id === selected) || null);
    };
    overlay.addEventListener("pointerup", end);
    overlay.addEventListener("pointercancel", end);

    // Keyboard: arrows move the focused box (Shift = 10 px); Alt+arrows
    // resize it; Delete removes it (Redact).
    overlay.addEventListener("keydown", (event) => {
      const box = event.target.closest(".editor-rect");
      if (!box) return;
      const index = rects.findIndex((x) => x.id === box.dataset.id);
      const r = rects[index];
      const step = event.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (d) {
        event.preventDefault();
        if (event.altKey) rects[index] = round(resize(r, "se", { x: r.x + r.w + d[0], y: r.y + r.h + d[1] }));
        else rects[index] = round({ ...r, x: clamp(r.x + d[0], 0, W - r.w), y: clamp(r.y + d[1], 0, H - r.h) });
        selected = r.id;
        emit();
        overlay.querySelector(`[data-id="${r.id}"]`)?.focus();
      } else if ((event.key === "Delete" || event.key === "Backspace") && opts.multi) {
        event.preventDefault();
        api.remove(r.id);
      }
    });
    overlay.addEventListener("focusin", (event) => {
      const box = event.target.closest(".editor-rect");
      if (box && box.dataset.id !== selected) {
        selected = box.dataset.id;
        opts.onSelect?.(rects.find((x) => x.id === selected) || null);
        // Re-rendering would drop focus; just mark the box.
        overlay.querySelectorAll(".editor-rect").forEach((el) => el.classList.toggle("is-selected", el === box));
      }
    });

    const api = {
      overlay,
      setSize(width, height) {
        W = width;
        H = height;
      },
      get rects() {
        return rects;
      },
      setRects(next, selectId) {
        rects = next.map(round);
        if (selectId !== undefined) selected = selectId;
        emit();
      },
      update(id, patch) {
        const index = rects.findIndex((x) => x.id === id);
        if (index < 0) return;
        rects[index] = round({ ...rects[index], ...patch });
        emit();
      },
      remove(id) {
        rects = rects.filter((x) => x.id !== id);
        if (selected === id) selected = null;
        emit();
        opts.onSelect?.(null);
      },
      clear() {
        rects = [];
        selected = null;
        emit();
      },
      select,
      get selected() {
        return rects.find((x) => x.id === selected) || null;
      },
      fitRatio,
      render,
    };
    return api;
  };
})(window.CL = window.CL || {});
