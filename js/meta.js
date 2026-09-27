// Image file structure readers: JPEG segments, EXIF/TIFF tags, PNG chunks and
// WebP chunks. Used by Images to PDF (to embed JPEGs untouched and read their
// rotation) and by the Metadata tool (to show and remove private data).
// Everything here works on raw bytes (Uint8Array); nothing touches the DOM.
(function (CL) {
  "use strict";

  const u16be = (b, i) => (b[i] << 8) | b[i + 1];
  const u32be = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
  const u32le = (b, i) => ((b[i + 3] << 24) >>> 0) + ((b[i + 2] << 16) | (b[i + 1] << 8) | b[i]);
  const ascii = (b, start, len) => {
    let s = "";
    for (let i = start; i < start + len && i < b.length; i += 1) s += String.fromCharCode(b[i]);
    return s;
  };

  // ── JPEG ─────────────────────────────────────────────────────────
  // Walks every marker segment, including the ones between progressive scans,
  // and finds where the image really ends (anything after EOI is trailing
  // data, such as a Motion Photo video or extra MPF pictures).
  function scanJpeg(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const segments = [];
    let i = 2;
    let end = bytes.length;
    let sawScan = false;
    while (i < bytes.length - 1) {
      if (bytes[i] !== 0xff) {
        // Inside entropy-coded data: skip to the next real marker.
        if (!sawScan) return null;
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i += 1; // fill byte
        continue;
      }
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2; // stuffed byte or restart marker inside scan data
        continue;
      }
      if (marker === 0xd9) {
        end = i + 2;
        break;
      }
      if (i + 4 > bytes.length) break;
      const length = u16be(bytes, i + 2);
      if (length < 2) return null;
      const seg = {
        marker,
        start: i,
        end: Math.min(bytes.length, i + 2 + length),
        dataStart: i + 4,
      };
      segments.push(seg);
      i = seg.end;
      if (marker === 0xda) sawScan = true;
    }
    return { segments, end };
  }

  const isSof = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

  function segmentKind(bytes, seg) {
    const m = seg.marker;
    const head = ascii(bytes, seg.dataStart, 32);
    if (m === 0xe0 && head.startsWith("JFIF")) return "jfif";
    if (m === 0xe1 && head.startsWith("Exif\0")) return "exif";
    if (m === 0xe1 && head.startsWith("http://ns.adobe.com/xap/1.0/")) return "xmp";
    if (m === 0xe1 && head.startsWith("http://ns.adobe.com/xmp/extension/")) return "xmp";
    if (m === 0xe2 && head.startsWith("ICC_PROFILE")) return "icc";
    if (m === 0xe2 && head.startsWith("MPF")) return "mpf";
    if (m === 0xed) return "iptc";
    if (m === 0xee && head.startsWith("Adobe")) return "adobe";
    if (m === 0xfe) return "comment";
    if (m >= 0xe0 && m <= 0xef) return "app";
    return "image";
  }

  // Basic facts needed to embed a JPEG in a PDF as-is.
  function jpegInfo(bytes) {
    const scan = scanJpeg(bytes);
    if (!scan) return null;
    const info = { orientation: 1, sof: null, adobe: false };
    for (const seg of scan.segments) {
      if (seg.marker === 0xda) break;
      if (isSof(seg.marker) && !info.sof) {
        const d = seg.dataStart;
        info.sof = {
          marker: seg.marker,
          precision: bytes[d],
          height: u16be(bytes, d + 1),
          width: u16be(bytes, d + 3),
          components: bytes[d + 5],
        };
      }
      const kind = segmentKind(bytes, seg);
      if (kind === "exif") {
        const tiff = parseTiff(bytes, seg.dataStart + 6, seg.end - seg.dataStart - 6);
        const o = tiff?.ifd0.get(0x0112)?.value;
        if (o >= 1 && o <= 8) info.orientation = o;
      }
      if (kind === "adobe") info.adobe = true;
    }
    return info.sof ? info : null;
  }

  // ── EXIF / TIFF ──────────────────────────────────────────────────
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  function parseTiff(bytes, start, length) {
    if (length < 8 || start + 8 > bytes.length) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset + start, Math.min(length, bytes.length - start));
    const order = view.getUint16(0);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const little = order === 0x4949;
    if (view.getUint16(2, little) !== 42) return null;

    const out = { little, ifd0: new Map(), exif: new Map(), gps: new Map(), ifd1: new Map() };
    const seen = new Set();

    function readValue(type, count, valueOffset) {
      const size = (TYPE_SIZE[type] || 1) * count;
      const at = size <= 4 ? valueOffset : view.getUint32(valueOffset, little);
      if (at + size > view.byteLength) return null;
      if (type === 2) {
        let s = "";
        for (let k = 0; k < count; k += 1) {
          const c = view.getUint8(at + k);
          if (!c) break;
          s += String.fromCharCode(c);
        }
        return s.trim();
      }
      if (type === 7 || type === 1 || type === 6) {
        return new Uint8Array(view.buffer, view.byteOffset + at, Math.min(count, 4096));
      }
      const values = [];
      for (let k = 0; k < Math.min(count, 64); k += 1) {
        const p = at + k * TYPE_SIZE[type];
        if (type === 3) values.push(view.getUint16(p, little));
        else if (type === 8) values.push(view.getInt16(p, little));
        else if (type === 4) values.push(view.getUint32(p, little));
        else if (type === 9) values.push(view.getInt32(p, little));
        else if (type === 5 || type === 10) {
          const num = type === 5 ? view.getUint32(p, little) : view.getInt32(p, little);
          const den = type === 5 ? view.getUint32(p + 4, little) : view.getInt32(p + 4, little);
          values.push(den ? num / den : 0);
        } else return null;
      }
      return count === 1 ? values[0] : values;
    }

    function readIfd(offset, target) {
      if (!offset || seen.has(offset) || offset + 2 > view.byteLength) return 0;
      seen.add(offset);
      const count = view.getUint16(offset, little);
      if (count > 1000) return 0;
      for (let n = 0; n < count; n += 1) {
        const e = offset + 2 + n * 12;
        if (e + 12 > view.byteLength) break;
        const tag = view.getUint16(e, little);
        const type = view.getUint16(e + 2, little);
        const cnt = view.getUint32(e + 4, little);
        if (!TYPE_SIZE[type]) continue;
        let value = null;
        try {
          value = readValue(type, cnt, e + 8);
        } catch {
          value = null;
        }
        target.set(tag, { type, count: cnt, value });
      }
      const next = offset + 2 + count * 12;
      return next + 4 <= view.byteLength ? view.getUint32(next, little) : 0;
    }

    const ifd1Offset = readIfd(view.getUint32(4, little), out.ifd0);
    const exifPtr = out.ifd0.get(0x8769)?.value;
    const gpsPtr = out.ifd0.get(0x8825)?.value;
    if (typeof exifPtr === "number") readIfd(exifPtr, out.exif);
    if (typeof gpsPtr === "number") readIfd(gpsPtr, out.gps);
    if (ifd1Offset) readIfd(ifd1Offset, out.ifd1);
    return out;
  }

  // EXIF orientation → how to turn the stored pixels upright:
  // flip horizontally first (if flipH), then rotate clockwise by `rotate`.
  function orientationTransform(o) {
    return (
      {
        1: { rotate: 0, flipH: false },
        2: { rotate: 0, flipH: true },
        3: { rotate: 180, flipH: false },
        4: { rotate: 180, flipH: true },
        5: { rotate: 270, flipH: true },
        6: { rotate: 90, flipH: false },
        7: { rotate: 90, flipH: true },
        8: { rotate: 270, flipH: false },
      }[o] || { rotate: 0, flipH: false }
    );
  }

  // Smallest valid EXIF block that only says "Orientation = o". Used when
  // stripping metadata so a sideways-stored phone photo stays upright.
  function orientationTiff(o) {
    const b = new Uint8Array(26);
    b.set([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]); // big-endian TIFF, IFD0 at 8
    b.set([0, 1], 8); // one entry
    b.set([0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, o & 0xff, 0, 0], 10);
    // next-IFD offset (4 zero bytes) already zero
    return b;
  }

  // ── PNG ──────────────────────────────────────────────────────────
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function scanPng(bytes) {
    if (bytes.length < 8 || PNG_SIG.some((v, i) => bytes[i] !== v)) return null;
    const chunks = [];
    let i = 8;
    while (i + 12 <= bytes.length) {
      const length = u32be(bytes, i);
      const type = ascii(bytes, i + 4, 4);
      const end = i + 12 + length;
      if (end > bytes.length) return null;
      chunks.push({ type, start: i, end, dataStart: i + 8, length });
      i = end;
      if (type === "IEND") break;
    }
    return { chunks, end: i };
  }

  // Colour and display chunks that are safe (and useful) to keep.
  const PNG_KEEP = new Set([
    "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT",
    "bKGD", "hIST", "pHYs", "sPLT", "acTL", "fcTL", "fdAT", "cICP", "mDCV", "cLLI",
  ]);

  function pngChunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let k = 0; k < 4; k += 1) out[4 + k] = type.charCodeAt(k);
    out.set(data, 8);
    view.setUint32(8 + data.length, CL.zip.crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  // ── WebP ─────────────────────────────────────────────────────────
  function scanWebp(bytes) {
    if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
    const chunks = [];
    let i = 12;
    while (i + 8 <= bytes.length) {
      const fourcc = ascii(bytes, i, 4);
      const size = u32le(bytes, i + 4);
      const end = Math.min(bytes.length, i + 8 + size + (size & 1));
      chunks.push({ fourcc, start: i, end, dataStart: i + 8, size });
      i = end;
    }
    return { chunks };
  }

  function webpChunk(fourcc, data) {
    const pad = data.length & 1;
    const out = new Uint8Array(8 + data.length + pad);
    for (let k = 0; k < 4; k += 1) out[k] = fourcc.charCodeAt(k);
    new DataView(out.buffer).setUint32(4, data.length, true);
    out.set(data, 8);
    return out;
  }

  // ── What is inside a file (plain-language findings) ──────────────
  function formatOf(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
    if (PNG_SIG.every((v, i) => bytes[i] === v)) return "png";
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
    return null;
  }

  function gpsFrom(gps) {
    const toDeg = (v) => (Array.isArray(v) && v.length >= 3 ? v[0] + v[1] / 60 + v[2] / 3600 : null);
    const lat = toDeg(gps.get(0x0002)?.value);
    const lon = toDeg(gps.get(0x0004)?.value);
    if (lat === null || lon === null || (lat === 0 && lon === 0)) return null;
    const latRef = gps.get(0x0001)?.value;
    const lonRef = gps.get(0x0003)?.value;
    return {
      lat: latRef === "S" ? -lat : lat,
      lon: lonRef === "W" ? -lon : lon,
      alt: typeof gps.get(0x0006)?.value === "number" ? gps.get(0x0006).value : null,
    };
  }

  function text(v) {
    if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
    if (v instanceof Uint8Array) {
      // EXIF UserComment starts with an 8-byte charset code.
      const s = Array.from(v.subarray(v.length > 8 ? 8 : 0, 200))
        .map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : ""))
        .join("")
        .trim();
      return s;
    }
    return "";
  }

  // findings: [{ label, detail, level: "private" | "info" | "kept" }]
  function describeTiff(tiff, findings) {
    const { ifd0, exif, gps, ifd1 } = tiff;
    const get = (map, tag) => text(map.get(tag)?.value);
    const where = gpsFrom(gps);
    if (where) {
      findings.push({
        label: "Location (GPS)",
        detail: `${where.lat.toFixed(5)}, ${where.lon.toFixed(5)}${where.alt !== null ? ` · ${Math.round(where.alt)} m up` : ""}. Anyone with the file can see where it was taken.`,
        level: "private",
        key: "gps",
      });
    } else if (gps.size) {
      findings.push({ label: "GPS block", detail: "Present, but without a usable position.", level: "info", key: "gps" });
    }
    const camera = [get(ifd0, 0x010f), get(ifd0, 0x0110)].filter(Boolean).join(" ");
    if (camera) findings.push({ label: "Camera or phone", detail: camera, level: "private", key: "camera" });
    const lens = [get(exif, 0xa433), get(exif, 0xa434)].filter(Boolean).join(" ");
    if (lens) findings.push({ label: "Lens", detail: lens, level: "info", key: "lens" });
    const taken = get(exif, 0x9003) || get(ifd0, 0x0132);
    const zone = get(exif, 0x9011) || get(exif, 0x9010);
    if (taken) findings.push({ label: "Date taken", detail: `${taken}${zone ? ` (${zone})` : ""}`, level: "private", key: "date" });
    const serial = [get(exif, 0xa431), get(exif, 0xa435)].filter(Boolean).join(", ");
    if (serial) findings.push({ label: "Serial number", detail: serial, level: "private", key: "serial" });
    const owner = [get(ifd0, 0x013b), get(exif, 0xa430), get(ifd0, 0x8298)].filter(Boolean).join(", ");
    if (owner) findings.push({ label: "Owner or copyright", detail: owner, level: "private", key: "owner" });
    const words = [get(ifd0, 0x010e), get(exif, 0x9286)].filter(Boolean).join(" · ");
    if (words) findings.push({ label: "Description or comment", detail: words.slice(0, 160), level: "private", key: "text" });
    const software = get(ifd0, 0x0131);
    if (software) findings.push({ label: "Software", detail: software, level: "info", key: "software" });
    const settings = [];
    const exposure = exif.get(0x829a)?.value;
    if (typeof exposure === "number" && exposure > 0) settings.push(exposure < 1 ? `1/${Math.round(1 / exposure)} s` : `${exposure} s`);
    const fnum = exif.get(0x829d)?.value;
    if (typeof fnum === "number" && fnum) settings.push(`f/${fnum.toFixed(1)}`);
    const iso = exif.get(0x8827)?.value;
    if (iso) settings.push(`ISO ${Array.isArray(iso) ? iso[0] : iso}`);
    const focal = exif.get(0x920a)?.value;
    if (typeof focal === "number" && focal) settings.push(`${Math.round(focal)} mm`);
    if (settings.length) findings.push({ label: "Camera settings", detail: settings.join(" · "), level: "info", key: "settings" });
    if (ifd1.get(0x0201) && ifd1.get(0x0202)?.value) {
      findings.push({
        label: "Hidden thumbnail",
        detail: `A small preview copy (${Math.round(ifd1.get(0x0202).value / 1024)} KB). It can still show parts you cropped out.`,
        level: "private",
        key: "thumb",
      });
    }
  }

  function inspect(bytes) {
    const format = formatOf(bytes);
    const result = { format, findings: [], orientation: 1, hasIcc: false, extraBytes: 0 };
    const add = (f) => result.findings.push(f);
    const readTiff = (start, length) => {
      const tiff = parseTiff(bytes, start, length);
      if (!tiff) return;
      const o = tiff.ifd0.get(0x0112)?.value;
      if (o >= 2 && o <= 8) result.orientation = o;
      describeTiff(tiff, result.findings);
    };

    if (format === "jpeg") {
      const scan = scanJpeg(bytes);
      if (!scan) return { ...result, format: null };
      for (const seg of scan.segments) {
        if (seg.marker === 0xda) break;
        const kind = segmentKind(bytes, seg);
        const size = seg.end - seg.start;
        if (kind === "exif") readTiff(seg.dataStart + 6, seg.end - seg.dataStart - 6);
        else if (kind === "xmp") {
          const xmp = ascii(bytes, seg.dataStart, Math.min(size, 60000));
          add({
            label: "XMP data",
            detail: `${Math.round(size / 1024) || 1} KB of editing info${/GPS(Latitude|Longitude)/.test(xmp) ? ", including a location" : ""}.`,
            level: "private",
            key: "xmp",
          });
        } else if (kind === "iptc") add({ label: "IPTC / Photoshop info", detail: "Captions, names or keywords.", level: "private", key: "iptc" });
        else if (kind === "comment") add({ label: "Comment", detail: text(ascii(bytes, seg.dataStart, Math.min(160, size - 4))) || "(empty)", level: "private", key: "comment" });
        else if (kind === "icc") result.hasIcc = true;
        else if (kind === "mpf") add({ label: "Extra pictures (MPF)", detail: "The file carries more than one picture (for example a depth or HDR map).", level: "info", key: "mpf" });
        else if (kind === "app") add({ label: `Maker data (APP${seg.marker - 0xe0})`, detail: `${Math.round(size / 1024) || 1} KB of camera-specific data.`, level: "info", key: "app" });
      }
      result.extraBytes = bytes.length - scan.end;
      if (result.extraBytes > 16) {
        add({
          label: "Hidden data after the picture",
          detail: `${CL.formatBytes(result.extraBytes)} tucked on the end, such as a Motion Photo video or extra images.`,
          level: "private",
          key: "trailer",
        });
      }
    } else if (format === "png") {
      const scan = scanPng(bytes);
      if (!scan) return { ...result, format: null };
      for (const c of scan.chunks) {
        if (c.type === "eXIf") readTiff(c.dataStart, c.length);
        else if (c.type === "tEXt" || c.type === "iTXt" || c.type === "zTXt") {
          const raw = ascii(bytes, c.dataStart, Math.min(c.length, 400));
          const keyword = raw.split("\0")[0];
          const value = c.type === "tEXt" ? raw.slice(keyword.length + 1) : "";
          add({
            label: `Text: ${keyword || "(no name)"}`,
            detail: value ? text(value).slice(0, 140) : `${c.length} bytes${keyword === "XML:com.adobe.xmp" ? " of XMP editing info" : ""}.`,
            level: "private",
            key: "text",
          });
        } else if (c.type === "tIME") add({ label: "Last edited time", detail: "Saved inside the file.", level: "info", key: "time" });
        else if (c.type === "iCCP") result.hasIcc = true;
        else if (!PNG_KEEP.has(c.type) && c.type[0] === c.type[0].toLowerCase()) {
          add({ label: `Extra chunk "${c.type}"`, detail: `${c.length} bytes of app-specific data.`, level: "info", key: "chunk" });
        }
      }
      result.extraBytes = bytes.length - scan.end;
    } else if (format === "webp") {
      const scan = scanWebp(bytes);
      if (!scan) return { ...result, format: null };
      for (const c of scan.chunks) {
        if (c.fourcc === "EXIF") {
          const off = ascii(bytes, c.dataStart, 6) === "Exif\0\0" ? 6 : 0;
          readTiff(c.dataStart + off, c.size - off);
        } else if (c.fourcc === "XMP ") add({ label: "XMP data", detail: `${Math.round(c.size / 1024) || 1} KB of editing info.`, level: "private", key: "xmp" });
        else if (c.fourcc === "ICCP") result.hasIcc = true;
      }
    }
    if (result.hasIcc) add({ label: "Colour profile", detail: "Tells screens how to show the colours. Not private.", level: "kept", key: "icc" });
    if (result.orientation !== 1) add({ label: "Rotation flag", detail: "Tells apps to turn the picture upright. Not private.", level: "kept", key: "orientation" });
    return result;
  }

  // ── Remove metadata without re-encoding the picture ──────────────
  // Returns new bytes, or null if the format is not supported.
  function strip(bytes, { keepIcc = true, keepOrientation = true } = {}) {
    const format = formatOf(bytes);
    const before = inspect(bytes);
    const orientation = keepOrientation ? before.orientation : 1;

    if (format === "jpeg") {
      const scan = scanJpeg(bytes);
      if (!scan) return null;
      const parts = [bytes.subarray(0, 2)];
      const firstScan = scan.segments.find((s) => s.marker === 0xda);
      if (!firstScan) return null;
      let orientationDone = orientation === 1;
      const addOrientation = () => {
        if (orientationDone) return;
        const tiff = orientationTiff(orientation);
        const seg = new Uint8Array(4 + 6 + tiff.length);
        seg.set([0xff, 0xe1, 0, 2 + 6 + tiff.length]);
        seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
        seg.set(tiff, 10);
        parts.push(seg);
        orientationDone = true;
      };
      scan.segments.forEach((seg, index) => {
        if (seg.start >= firstScan.start) return;
        const kind = segmentKind(bytes, seg);
        const keep = kind === "jfif" || kind === "adobe" || kind === "image" || (kind === "icc" && keepIcc);
        if (index === 0 && kind !== "jfif") addOrientation();
        if (keep) parts.push(bytes.subarray(seg.start, seg.end));
        if (kind === "jfif") addOrientation();
      });
      addOrientation();
      parts.push(bytes.subarray(firstScan.start, scan.end));
      return concat(parts);
    }

    if (format === "png") {
      const scan = scanPng(bytes);
      if (!scan) return null;
      const parts = [bytes.subarray(0, 8)];
      for (const c of scan.chunks) {
        const critical = c.type[0] === c.type[0].toUpperCase();
        const keep = critical || PNG_KEEP.has(c.type) || (c.type === "iCCP" && keepIcc);
        if (keep) parts.push(bytes.subarray(c.start, c.end));
        if (c.type === "IHDR" && orientation !== 1) parts.push(pngChunk("eXIf", orientationTiff(orientation)));
      }
      return concat(parts);
    }

    if (format === "webp") {
      const scan = scanWebp(bytes);
      if (!scan) return null;
      const parts = [];
      let vp8xIndex = -1;
      for (const c of scan.chunks) {
        if (c.fourcc === "EXIF" || c.fourcc === "XMP ") continue;
        if (c.fourcc === "ICCP" && !keepIcc) continue;
        const chunk = bytes.slice(c.start, c.end);
        if (c.fourcc === "VP8X") vp8xIndex = parts.length;
        parts.push(chunk);
      }
      if (vp8xIndex >= 0) {
        const vp8x = parts[vp8xIndex];
        vp8x[8] &= ~(0x08 | 0x04); // clear EXIF + XMP flags
        if (!keepIcc) vp8x[8] &= ~0x20;
        if (orientation !== 1) {
          vp8x[8] |= 0x08;
          parts.push(webpChunk("EXIF", orientationTiff(orientation)));
        }
      }
      const body = concat(parts);
      const out = new Uint8Array(12 + body.length);
      out.set(bytes.subarray(0, 12));
      new DataView(out.buffer).setUint32(4, out.length - 8, true);
      out.set(body, 12);
      return out;
    }
    return null;
  }

  function concat(parts) {
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  CL.meta = {
    u16be,
    u32be,
    u32le,
    ascii,
    scanJpeg,
    scanPng,
    scanWebp,
    segmentKind,
    isSof,
    jpegInfo,
    parseTiff,
    orientationTransform,
    orientationTiff,
    formatOf,
    inspect,
    strip,
  };
})(window.CL = window.CL || {});
