// Minimal PDF writer: one image per page, no library. JPEG data is embedded
// as-is (DCTDecode); lossless pages are raw RGB squeezed with the browser's
// own zlib (FlateDecode via CompressionStream). Rotation and mirroring are
// done with the page's drawing matrix, so an embedded JPEG is never re-encoded
// just to turn it upright.
(function (CL) {
  "use strict";

  const latin1 = (text) => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);

  // PDF numbers must be plain decimals (no exponent notation).
  function num(value) {
    const fixed = Number(value).toFixed(3);
    const trimmed = fixed.replace(/\.?0+$/, "");
    return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
  }

  function pdfString(text) {
    const value = String(text || "");
    if (/^[\x20-\x7e]*$/.test(value)) {
      return `(${value.replace(/([\\()])/g, "\\$1")})`;
    }
    // Non-ASCII: UTF-16BE hex string with a byte-order mark.
    let hex = "FEFF";
    for (const ch of value) {
      const code = ch.codePointAt(0);
      const units = code > 0xffff
        ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)]
        : [code];
      for (const unit of units) hex += unit.toString(16).padStart(4, "0").toUpperCase();
    }
    return `<${hex}>`;
  }

  function pdfDate(date = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `D:${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(
      date.getHours(),
    )}${p(date.getMinutes())}${p(date.getSeconds())}`;
  }

  // Matrix that draws the stored pixels into box {x, y, w, h} (PDF points,
  // y up), after flipping horizontally (optional) and rotating clockwise.
  // `box` is the upright, displayed size.
  function placementMatrix(box, rotate, flipH) {
    const r = ((rotate % 360) + 360) % 360;
    // (u, v): position in the stored image, 0..1, v pointing down.
    const toDisplay = (u, v) => {
      if (flipH) u = 1 - u;
      if (r === 90) return [1 - v, u];
      if (r === 180) return [1 - u, 1 - v];
      if (r === 270) return [v, 1 - u];
      return [u, v];
    };
    const toPdf = ([dx, dy]) => [box.x + dx * box.w, box.y + (1 - dy) * box.h];
    // PDF image space: (0,0) = bottom-left of the stored image = (u 0, v 1).
    const bl = toPdf(toDisplay(0, 1));
    const br = toPdf(toDisplay(1, 1));
    const tl = toPdf(toDisplay(0, 0));
    return [br[0] - bl[0], br[1] - bl[1], tl[0] - bl[0], tl[1] - bl[1], bl[0], bl[1]];
  }

  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const canDeflate = () => typeof CompressionStream === "function";

  // pages: [{ width, height, image: { kind: "jpeg" | "flate", bytes, pixelWidth,
  //   pixelHeight, colorSpace, matrix } }]
  function build(pages, { title = "", author = "" } = {}) {
    const parts = [];
    const offsets = [];
    let offset = 0;
    const push = (data) => {
      const bytes = typeof data === "string" ? latin1(data) : data;
      parts.push(bytes);
      offset += bytes.length;
    };
    const object = (id, body) => {
      offsets[id] = offset;
      push(`${id} 0 obj\n${body}\nendobj\n`);
    };

    push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");

    const pageId = (i) => 4 + i * 3;
    const kids = pages.map((_, i) => `${pageId(i)} 0 R`).join(" ");
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
    const info = [`/Producer (Compress Lab)`, `/CreationDate (${pdfDate()})`];
    if (title) info.push(`/Title ${pdfString(title)}`);
    if (author) info.push(`/Author ${pdfString(author)}`);
    object(3, `<< ${info.join(" ")} >>`);

    pages.forEach((page, i) => {
      const id = pageId(i);
      const contentId = id + 1;
      const imageId = id + 2;
      const img = page.image;
      object(
        id,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}]` +
          ` /Resources << /XObject << /Im0 ${imageId} 0 R >> /ProcSet [/PDF /ImageB /ImageC] >>` +
          ` /Contents ${contentId} 0 R >>`,
      );
      const content = `q ${img.matrix.map(num).join(" ")} cm /Im0 Do Q`;
      object(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

      const filter = img.kind === "jpeg" ? "/DCTDecode" : "/FlateDecode";
      offsets[imageId] = offset;
      push(
        `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.pixelWidth}` +
          ` /Height ${img.pixelHeight} /ColorSpace /${img.colorSpace || "DeviceRGB"}` +
          ` /BitsPerComponent 8 /Filter ${filter} /Length ${img.bytes.length} >>\nstream\n`,
      );
      push(img.bytes);
      push("\nendstream\nendobj\n");
    });

    const size = 4 + pages.length * 3;
    const xrefStart = offset;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let id = 1; id < size; id += 1) {
      xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }
    push(xref);
    push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
    return new Blob(parts, { type: "application/pdf" });
  }

  CL.pdf = { build, placementMatrix, deflate, canDeflate, pdfString };
})(window.CL = window.CL || {});
