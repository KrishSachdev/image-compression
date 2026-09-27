// Metadata: shows what a photo quietly carries (location, camera, date,
// serial numbers, hidden thumbnails, attached video) and removes it without
// re-compressing the picture. JPEG, PNG and WebP are cleaned byte-for-byte;
// other formats can be re-saved as PNG, which drops everything.
(function (CL) {
  "use strict";

  const T = CL.toolkit;
  const EXT = { jpeg: "jpg", png: "png", webp: "webp" };

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="metaTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Metadata</p>
              <h2 id="metaTitle">What's inside</h2>
            </div>
            <div class="tool-head-actions">
              <button type="button" class="ghost-button" data-act="add">${T.icon(T.icons.plus, 16)}<span>Add images</span></button>
              <button type="button" class="ghost-button" data-act="clear" disabled>Clear</button>
            </div>
          </div>
          <div class="tool-slot" data-slot="stage"></div>
        </section>
        <section class="panel tool-controls" aria-labelledby="metaSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Settings</p><h2 id="metaSettingsTitle">Clean up</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const controls = view.querySelector('[data-slot="controls"]');
    const clearButton = view.querySelector('[data-act="clear"]');

    const options = T.el(`
      <div class="field">
        <div class="field-label"><strong>Keep</strong><small>Neither of these is private</small></div>
        <label class="check-line"><input type="checkbox" data-opt="icc" checked /><span><strong>Colour profile</strong><small>Keeps colours looking the same</small></span></label>
        <label class="check-line"><input type="checkbox" data-opt="orientation" checked /><span><strong>Rotation flag</strong><small>Keeps phone photos upright</small></span></label>
      </div>`);
    const keepIcc = options.querySelector('[data-opt="icc"]');
    const keepOrientation = options.querySelector('[data-opt="orientation"]');
    const note = T.el(`<p class="field-note">JPEG, PNG and WebP are cleaned without touching the picture itself, so there is no quality loss. Other formats are re-saved as PNG, which also removes everything.</p>`);
    const summary = T.el('<p class="tool-summary" aria-live="polite"></p>');
    const cleanButton = T.el('<button type="button" class="primary-button" disabled>Remove metadata</button>');
    const actions = T.outputActions({
      downloadLabel: "Download",
      onDownload: download,
      onShare: () => T.share(cleaned(), "Clean images"),
      onCompress: () => T.sendToCompress(cleaned()),
    });
    actions.hidden = true;
    controls.append(options, note, summary, cleanButton, actions);

    const list = T.el('<ul class="meta-list" aria-label="Images and their metadata"></ul>');
    const drop = T.dropzone({
      multiple: true,
      title: "Check photos for hidden details",
      hint: "Drop photos here, tap to choose, or paste. You'll see location, camera and dates before anything is changed.",
      onFiles: addFiles,
    });

    let entries = []; // { id, file, bytes, info, thumb, clean: { blob, name, info } }
    let seq = 0;

    function cleaned() {
      return entries.filter((e) => e.clean).map((e) => ({ blob: e.clean.blob, name: e.clean.name }));
    }

    function findingRows(info) {
      if (!info.findings.length) return '<li class="meta-row is-clean"><span class="meta-dot"></span><strong>Nothing found</strong><small>No hidden details in this file.</small></li>';
      return info.findings
        .map(
          (f) => `
          <li class="meta-row is-${f.level}">
            <span class="meta-dot" aria-hidden="true"></span>
            <strong>${T.escape(f.label)}</strong>
            <small>${T.escape(f.detail)}</small>
          </li>`,
        )
        .join("");
    }

    function render() {
      slot.textContent = "";
      slot.appendChild(entries.length ? list : drop);
      clearButton.disabled = !entries.length;
      cleanButton.disabled = !entries.length;
      list.textContent = "";
      for (const e of entries) {
        const privateCount = e.info.findings.filter((f) => f.level === "private").length;
        const hasGps = e.info.findings.some((f) => f.key === "gps" && f.level === "private");
        const card = T.el(`
          <li class="meta-card">
            <div class="meta-card-head">
              <img src="${e.thumb}" alt="" />
              <div>
                <strong title="${T.escape(e.file.name)}">${T.escape(e.file.name)}</strong>
                <small>${(e.info.format || e.file.type.replace("image/", "") || "image").toUpperCase()} · ${CL.formatBytes(e.file.size)}</small>
                <span class="meta-badges">
                  ${hasGps ? '<em class="is-alert">Location inside</em>' : ""}
                  ${privateCount ? `<em>${privateCount} private ${privateCount === 1 ? "detail" : "details"}</em>` : '<em class="is-ok">Nothing private</em>'}
                </span>
              </div>
              <button type="button" class="icon-btn" data-remove="${e.id}" aria-label="Remove ${T.escape(e.file.name)}" title="Remove">${T.icon(T.icons.close, 16)}</button>
            </div>
            <ul class="meta-rows">${findingRows(e.info)}</ul>
            ${e.clean ? `<p class="meta-result">${T.icon('<path d="M20 6 9 17l-5-5"/>', 16)}<span>${T.escape(e.clean.message)}</span><button type="button" class="ghost-button" data-save="${e.id}">${T.icon(T.icons.download, 14)}<span>Save</span></button></p>` : ""}
          </li>`);
        list.appendChild(card);
      }
      const withGps = entries.filter((e) => e.info.findings.some((f) => f.key === "gps" && f.level === "private")).length;
      const done = entries.filter((e) => e.clean).length;
      if (!entries.length) summary.textContent = "";
      else {
        summary.textContent = `${entries.length} ${entries.length === 1 ? "image" : "images"}${withGps ? ` · ${withGps} with a location` : ""}${done ? ` · ${done} cleaned` : ""}.`;
      }
      actions.hidden = !done;
      actions.setEnabled(done > 0, { shareable: done > 0 && T.canShare(cleaned()) });
      actions.setLabel(done > 1 ? `Download all (.zip)` : "Download clean image");
    }

    async function addFiles(files) {
      const images = T.imageFiles(files);
      if (!images.length) {
        CL.toast("Please choose an image file.");
        return;
      }
      for (const file of images) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const info = CL.meta.inspect(bytes);
        let thumb = "";
        try {
          const img = await CL.loadImage(URL.createObjectURL(file));
          thumb = T.thumb(img, img.naturalWidth, img.naturalHeight, 120);
          URL.revokeObjectURL(img.src);
        } catch {
          /* undecodable: the list still shows the findings */
        }
        entries.push({ id: `m${(seq += 1)}`, file, bytes, info, thumb, clean: null });
      }
      render();
    }

    async function resave(entry) {
      const img = await CL.loadImage(URL.createObjectURL(entry.file));
      const canvas = T.canvas(img.naturalWidth, img.naturalHeight);
      canvas.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      return T.encode(canvas, { mime: "image/png", ext: "png", lossy: false });
    }

    async function clean() {
      cleanButton.disabled = true;
      cleanButton.textContent = "Cleaning…";
      const opts = { keepIcc: keepIcc.checked, keepOrientation: keepOrientation.checked };
      for (const e of entries) {
        try {
          const base = T.baseName(e.file.name);
          const out = e.info.format ? CL.meta.strip(e.bytes, opts) : null;
          let blob;
          let name;
          let message;
          if (out) {
            blob = new Blob([out], { type: e.file.type || `image/${e.info.format}` });
            name = `${base}-clean.${EXT[e.info.format]}`;
            const after = CL.meta.inspect(out);
            const left = after.findings.filter((f) => f.level === "private");
            message = left.length
              ? `Some details could not be removed: ${left.map((f) => f.label).join(", ")}.`
              : `Clean. ${CL.formatBytes(e.file.size)} → ${CL.formatBytes(out.length)}, picture untouched.`;
          } else {
            blob = await resave(e);
            name = `${base}-clean.png`;
            message = `Re-saved as PNG with nothing hidden inside (${CL.formatBytes(blob.size)}).`;
          }
          e.clean = { blob, name, message };
        } catch (error) {
          console.error(error);
          CL.toast(`${e.file.name}: could not clean this file.`);
        }
      }
      cleanButton.textContent = "Remove metadata";
      render();
    }

    async function download() {
      const files = cleaned();
      if (!files.length) return;
      if (files.length === 1) T.download(files[0].blob, files[0].name);
      else {
        await T.zip(files, "clean-images.zip");
        CL.toast(`ZIP with ${files.length} clean images ready.`);
      }
    }

    list.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove]");
      const save = event.target.closest("[data-save]");
      if (remove) {
        entries = entries.filter((e) => e.id !== remove.dataset.remove);
        render();
      } else if (save) {
        const e = entries.find((x) => x.id === save.dataset.save);
        if (e?.clean) T.download(e.clean.blob, e.clean.name);
      }
    });
    [keepIcc, keepOrientation].forEach((box) =>
      box.addEventListener("change", () => {
        entries.forEach((e) => (e.clean = null));
        render();
      }),
    );
    cleanButton.addEventListener("click", clean);
    view.querySelector('[data-act="add"]').addEventListener("click", () => T.pickFiles({ multiple: true }, addFiles));
    clearButton.addEventListener("click", () => {
      entries = [];
      render();
    });

    render();
    return { addFiles, clean, entries: () => entries };
  }

  T.register({
    id: "metadata",
    name: "Remove metadata",
    short: "Metadata",
    blurb: "See what a photo gives away (location, phone, date, hidden thumbnail) and remove it with no quality loss.",
    tags: ["Privacy", "Multiple images"],
    group: "privacy",
    icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    create,
  });
})(window.CL = window.CL || {});
