// QR code maker: text/URL, Wi-Fi or a contact card, encoded by our own
// encoder (js/qr.js). Download as PNG or SVG.
(function (CL) {
  "use strict";

  const T = CL.toolkit;

  const escWifi = (v) => String(v || "").replace(/([\\;,:"])/g, "\\$1");
  function wifiPayload(s) {
    const parts = [`WIFI:T:${s.security}`, `S:${escWifi(s.ssid)}`];
    if (s.security !== "nopass") parts.push(`P:${escWifi(s.password)}`);
    if (s.hidden) parts.push("H:true");
    return `${parts.join(";")};;`;
  }
  function contactPayload(s) {
    const lines = ["BEGIN:VCARD", "VERSION:3.0"];
    if (s.name) lines.push(`N:${s.name};;;;`, `FN:${s.name}`);
    if (s.phone) lines.push(`TEL:${s.phone}`);
    if (s.email) lines.push(`EMAIL:${s.email}`);
    if (s.org) lines.push(`ORG:${s.org}`);
    lines.push("END:VCARD");
    return lines.join("\n");
  }

  function create(view) {
    view.innerHTML = `
      <div class="tool-layout">
        <section class="panel tool-stage" aria-labelledby="qrTitle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Make</p>
              <h2 id="qrTitle">QR code</h2>
            </div>
          </div>
          <div class="tool-slot qr-stage" data-slot="stage"></div>
          <p class="tool-summary" aria-live="polite" data-slot="summary"></p>
        </section>
        <section class="panel tool-controls" aria-labelledby="qrSettingsTitle">
          <div class="panel-head"><div><p class="eyebrow">Content</p><h2 id="qrSettingsTitle">What should it open?</h2></div></div>
          <div class="field-stack" data-slot="controls"></div>
        </section>
      </div>`;

    const slot = view.querySelector('[data-slot="stage"]');
    const summary = view.querySelector('[data-slot="summary"]');
    const controls = view.querySelector('[data-slot="controls"]');

    const type = T.segmented("qr-type", [
      { value: "text", label: "Text / URL" },
      { value: "wifi", label: "Wi-Fi" },
      { value: "contact", label: "Contact" },
    ], "text", "Content type");
    const typeField = T.el('<div class="field"><div class="field-label"><strong>Content type</strong></div></div>');
    typeField.appendChild(type);

    // Text / URL
    const textField = T.el(`
      <label class="field">
        <span class="field-label"><strong>Text or link</strong><small data-slot="count"></small></span>
        <textarea rows="3" placeholder="https://example.com or any text" aria-label="Text or link"></textarea>
      </label>`);
    const textInput = textField.querySelector("textarea");
    const textCount = textField.querySelector('[data-slot="count"]');

    // Wi-Fi
    const wifiField = T.el(`
      <div class="field-stack" data-slot="wifi">
        <label class="field"><span class="field-label"><strong>Network name (SSID)</strong></span><input type="text" data-w="ssid" aria-label="Network name" /></label>
        <label class="field"><span class="field-label"><strong>Password</strong></span><input type="text" data-w="password" aria-label="Wi-Fi password" /></label>
        <div class="field"><div class="field-label"><strong>Security</strong></div></div>
        <label class="check-line"><input type="checkbox" data-w="hidden" /><span><strong>Hidden network</strong></span></label>
      </div>`);
    const wifiSecurity = T.segmented("qr-wifi-sec", [
      { value: "WPA", label: "WPA/WPA2" },
      { value: "WEP", label: "WEP" },
      { value: "nopass", label: "None" },
    ], "WPA", "Wi-Fi security");
    wifiField.querySelector(".field-label strong").parentElement.after(wifiSecurity);
    const wifiPassword = wifiField.querySelector('[data-w="password"]').closest(".field");

    // Contact
    const contactField = T.el(`
      <div class="field-stack" data-slot="contact">
        <label class="field"><span class="field-label"><strong>Name</strong></span><input type="text" data-c="name" aria-label="Contact name" /></label>
        <label class="field"><span class="field-label"><strong>Phone</strong></span><input type="tel" data-c="phone" aria-label="Contact phone" /></label>
        <label class="field"><span class="field-label"><strong>Email</strong></span><input type="email" data-c="email" aria-label="Contact email" /></label>
        <label class="field"><span class="field-label"><strong>Organisation</strong><small>Optional</small></span><input type="text" data-c="org" aria-label="Contact organisation" /></label>
      </div>`);

    const level = T.segmented("qr-level", [
      { value: "L", label: "L", title: "Low — smallest code, least resilient to damage" },
      { value: "M", label: "M", title: "Medium — good default" },
      { value: "Q", label: "Q", title: "Quartile — more resilient, bigger code" },
      { value: "H", label: "H", title: "High — most resilient, biggest code" },
    ], "M", "Error correction level");
    level.classList.add("seg-wrap");
    const levelField = T.el('<div class="field"><div class="field-label"><strong>Error correction</strong><small>Higher survives more damage or a logo overlay, but makes a denser code</small></div></div>');
    levelField.appendChild(level);

    const sizeField = T.el(`
      <label class="field range-field">
        <span class="field-label"><strong>Size</strong><output>600 px</output></span>
        <input type="range" min="150" max="1600" step="10" value="600" aria-label="Image size in pixels" />
      </label>`);
    const sizeInput = sizeField.querySelector("input");
    const marginField = T.el(`
      <label class="field range-field">
        <span class="field-label"><strong>Margin</strong><output>4 modules</output></span>
        <input type="range" min="0" max="12" step="1" value="4" aria-label="Quiet-zone margin" />
      </label>`);
    const marginInput = marginField.querySelector("input");
    const colorsField = T.el(`
      <div class="field">
        <div class="field-label"><strong>Colours</strong><small>Keep strong contrast so it still scans</small></div>
        <div class="button-row">
          <label class="color-line"><span>Code</span><input type="color" value="#000000" data-c="fg" aria-label="Foreground colour" /></label>
          <label class="color-line"><span>Background</span><input type="color" value="#ffffff" data-c="bg" aria-label="Background colour" /></label>
        </div>
      </div>`);
    const fgInput = colorsField.querySelector('[data-c="fg"]');
    const bgInput = colorsField.querySelector('[data-c="bg"]');

    const actions = T.el(`
      <div class="tool-actions">
        <button type="button" class="primary-button" data-act="png" disabled>${T.icon(T.icons.download)}<span>Download PNG</span></button>
        <div class="tool-actions-row">
          <button type="button" class="ghost-button" data-act="svg" disabled>${T.icon(T.icons.download, 16)}<span>Download SVG</span></button>
        </div>
      </div>`);

    controls.append(typeField, textField, wifiField, contactField, levelField, sizeField, marginField, colorsField, actions);

    function payloadSettings() {
      return {
        security: wifiSecurity.value(),
        ssid: wifiField.querySelector('[data-w="ssid"]').value,
        password: wifiField.querySelector('[data-w="password"]').value,
        hidden: wifiField.querySelector('[data-w="hidden"]').checked,
      };
    }
    function contactSettings() {
      const s = {};
      contactField.querySelectorAll("[data-c]").forEach((i) => (s[i.dataset.c] = i.value.trim()));
      return s;
    }

    function payload() {
      const t = type.value();
      if (t === "wifi") return wifiPayload(payloadSettings());
      if (t === "contact") return contactPayload(contactSettings());
      return textInput.value;
    }

    let lastQR = null;

    function refresh() {
      const t = type.value();
      textField.hidden = t !== "text";
      wifiField.hidden = t !== "wifi";
      wifiSecurity.hidden = t !== "wifi";
      contactField.hidden = t !== "contact";
      wifiPassword.hidden = wifiSecurity.value() === "nopass";
      sizeField.querySelector("output").textContent = `${sizeInput.value} px`;
      marginField.querySelector("output").textContent = `${marginInput.value} modules`;
      const lvl = level.value();
      const text = payload();
      const hasContent = t === "wifi" ? Boolean(payloadSettings().ssid) : t === "contact" ? Boolean(contactSettings().name) : Boolean(text.trim());
      textCount.textContent = t === "text" ? `${new TextEncoder().encode(text).length} / ${CL.qr.maxBytes(lvl)} bytes` : "";

      slot.innerHTML = "";
      if (!hasContent) {
        slot.appendChild(T.el('<p class="tool-hint">Fill in the content on the right to see the code.</p>'));
        summary.textContent = "";
        actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
        lastQR = null;
        return;
      }
      const qr = CL.qr.encode(text, lvl);
      if (!qr) {
        slot.appendChild(T.el('<p class="tool-hint">That\'s too much text for a QR code at this error-correction level. Shorten it or lower the level.</p>'));
        summary.textContent = "Too much data to encode.";
        actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
        lastQR = null;
        return;
      }
      lastQR = qr;
      const scale = Math.max(2, Math.round(Number(sizeInput.value) / (qr.size + Number(marginInput.value) * 2)));
      const canvas = CL.qr.toCanvas(qr, { scale, margin: Number(marginInput.value), fg: fgInput.value, bg: bgInput.value });
      canvas.className = "qr-preview";
      canvas.style.width = "min(100%, 320px)";
      canvas.style.height = "auto";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Generated QR code");
      slot.appendChild(canvas);
      summary.textContent = `Version ${qr.version} (${qr.size}×${qr.size} modules), level ${lvl}, ${canvas.width}×${canvas.width} px.`;
      actions.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }

    function download(kind) {
      if (!lastQR) return;
      const opts = { scale: Math.max(2, Math.round(Number(sizeInput.value) / (lastQR.size + Number(marginInput.value) * 2))), margin: Number(marginInput.value), fg: fgInput.value, bg: bgInput.value };
      if (kind === "png") {
        CL.qr.toCanvas(lastQR, opts).toBlob((blob) => T.download(blob, "qr-code.png"), "image/png");
      } else {
        const svg = CL.qr.toSVG(lastQR, opts);
        T.download(new Blob([svg], { type: "image/svg+xml" }), "qr-code.svg");
      }
    }

    controls.addEventListener("input", refresh);
    controls.addEventListener("change", refresh);
    actions.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-act]");
      if (btn) download(btn.dataset.act);
    });

    refresh();
    return { onShow: refresh };
  }

  T.register({
    id: "qr",
    name: "QR code maker",
    short: "QR code",
    blurb: "Make a scannable QR code for a link, text, Wi-Fi login or contact card. Download as PNG or SVG.",
    tags: ["Wi-Fi", "Contact"],
    group: "make",
    icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M18 14h3v3h-3z"/><path d="M14 18h3v3h-3z"/><path d="M18 18h3v3h-3z"/>',
    create,
  });
})(window.CL = window.CL || {});
