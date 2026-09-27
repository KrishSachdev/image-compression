// GIF maker: turn several photos into one animated GIF. Reorder frames, set
// each one's delay (or apply one delay to all), choose loop on/off and an
// output width. Encoding is our own GIF89a writer in js/gif.js.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const WIDTH_PRESETS = [240, 320, 480, 640, 800];

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="gifTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">GIF maker</p>
              <h2 id="gifTitle">Frames</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="add">${T.icon(T.icons.plus, 16)}<span>Add photos</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
          <p class="tool-hint" data-slot="hint" hidden>Drag the grip to reorder. Each frame plays for its own delay, in order, then loops back to the first.</p>
        </section>
        <section class="panel tool-controls" aria-labelledby="gifSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="gifSettingsTitle">Playback</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const stage = view.querySelector('[data-slot="stage"]');
    const hint = view.querySelector('[data-slot="hint"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const widthField = T.el(`
      <label class="field">
        <span class="field-label"><strong>Output width</strong><small>Height follows the first photo's shape</small></span>
        <input type="number" class="num-input" min="60" max="2000" step="1" value="480" aria-label="Output width in pixels" />
      </label>`);
    const widthInput = widthField.querySelector("input");
    const quick = T.el(`
      <div class="field">
        <div class="field-label"><strong>Quick widths</strong></div>
        <div class="chip-row">${WIDTH_PRESETS.map((w) => `<button type="button" class="chip" data-quick="${w}">${w} px</button>`).join("")}</div>
      </div>`);

    const loopField = T.el(`
      <label class="field lock-label">
        <input type="checkbox" checked />
        <span>Loop forever</span>
      </label>`);
    const loopInput = loopField.querySelector("input");

    const delayAllField = T.el(`
      <label class="field range-field">
        <span class="field-label"><strong>Delay for new frames</strong><output>500 ms</output></span>
        <input type="range" min="20" max="3000" step="10" value="500" aria-label="Default delay for new frames" />
      </label>`);
    const delayAllInput = delayAllField.querySelector("input");
    const applyAllButton = T.el('<button type="button" class="ghost-button">Apply this delay to every frame</button>');

    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const actions = T.outputActions({
      downloadLabel: "Download GIF",
      onDownload: () => output().then((e) => e && T.download(e.blob, e.name)),
      onShare: () => output().then((e) => e && T.share([e], e.name)),
    });

    controls.append(widthField, quick, loopField, delayAllField, applyAllButton, summary, actions);

    const list = T.imageList({
      label: "GIF frames, in order",
      rotate: false,
      figure: (item) => `<img src="${item.thumb}" alt="" />`,
      extra: (item, index) => `
        <label class="gif-delay">
          <span>Delay</span>
          <input type="number" class="num-input gif-delay-input" min="20" max="10000" step="10" value="${item.delay}" data-index="${index}" aria-label="Delay for frame ${index + 1} in milliseconds" />
          <span>ms</span>
        </label>`,
      onChange: refresh,
    });

    list.el.addEventListener("input", (event) => {
      const input = event.target.closest(".gif-delay-input");
      if (!input) return;
      const item = list.items[Number(input.dataset.index)];
      if (item) item.delay = CL.clamp(Math.round(Number(input.value)) || 20, 20, 10000);
    });

    const drop = T.dropzone({
      multiple: true,
      title: "Add photos for your GIF",
      hint: "Drop several photos here, tap to choose, or paste. Each one becomes a frame, in the order you add them.",
      onFiles: addFiles,
    });

    function refresh() {
      const count = list.items.length;
      stage.textContent = "";
      stage.appendChild(count ? list.el : drop);
      hint.hidden = count < 2;
      clearButton.disabled = !count;
      actions.setEnabled(count >= 2, { shareable: T.canShare([{ blob: new Blob([], { type: "image/gif" }), name: "a.gif" }]) });
      summary.textContent =
        count >= 2
          ? `${count} frames · ${widthInput.value} px wide · ${loopInput.checked ? "loops forever" : "plays once"}.`
          : count === 1
            ? "Add at least one more photo to make a GIF."
            : "";
    }

    async function addFiles(files) {
      const items = await T.loadItems(files);
      if (!items.length) return;
      items.forEach((item) => {
        item.delay = Number(delayAllInput.value);
      });
      list.add(items);
      refresh();
    }

    quick.addEventListener("click", (event) => {
      const button = event.target.closest("[data-quick]");
      if (!button) return;
      widthInput.value = button.dataset.quick;
      refresh();
    });
    widthInput.addEventListener("change", refresh);
    loopInput.addEventListener("change", refresh);
    delayAllInput.addEventListener("input", () => {
      delayAllField.querySelector("output").textContent = `${delayAllInput.value} ms`;
    });
    applyAllButton.addEventListener("click", () => {
      const v = Number(delayAllInput.value);
      list.items.forEach((item) => {
        item.delay = v;
      });
      list.render();
    });
    view.querySelector('[data-act="add"]').addEventListener("click", () => T.pickFiles({ multiple: true }, addFiles));
    clearButton.addEventListener("click", () => {
      list.clear();
      refresh();
    });

    async function output() {
      const items = list.items;
      if (items.length < 2) {
        CL.toast("Add at least two photos first.");
        return null;
      }
      const outW = CL.clamp(Math.round(Number(widthInput.value)) || 480, 60, 2000);
      const aspect = items[0].width / items[0].height;
      const outH = Math.max(1, Math.round(outW / aspect));
      const frames = items.map((item) => {
        const canvas = T.canvas(outW, outH);
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, outW, outH);
        const scale = Math.max(outW / item.width, outH / item.height);
        const dw = item.width * scale;
        const dh = item.height * scale;
        ctx.drawImage(item.image, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
        const rgba = ctx.getImageData(0, 0, outW, outH).data;
        return { rgba, delayCs: Math.max(2, Math.round((item.delay || 500) / 10)) };
      });
      try {
        const blob = CL.gif.encode({ width: outW, height: outH, frames, loop: loopInput.checked });
        return { blob, name: "animation.gif" };
      } catch (error) {
        CL.toast(error.message);
        return null;
      }
    }

    refresh();
    return { addFiles, onShow: refresh, output };
  }

  T.register({
    id: "gif",
    name: "GIF maker",
    short: "GIF",
    blurb: "Turn several photos into an animated GIF. Reorder frames, set each one's delay, loop it or not.",
    tags: ["Multiple images", "Animation"],
    group: "combine",
    icon: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M7 6V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1"/><path d="M7 12h1.5M12 12h1.5M17 12h.01"/>',
    create,
  });
})(window.CL = window.CL || {});
