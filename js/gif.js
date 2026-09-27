// Our own GIF89a writer: median-cut colour quantisation down to a shared
// palette, then a standard GIF/LZW encoder. No library. Public, documented
// format (GIF89a spec + the well-known LZW algorithm it specifies) — this is
// a fresh implementation from that spec, not copied from any codebase.
(function (CL) {
  "use strict";

  // ── Colour quantisation (median cut) ───────────────────────────────
  // Sample pixels from every frame into a 5-bit-per-channel histogram (so
  // near-identical colours share a bucket), then repeatedly split the most
  // populous bucket along its widest channel until we have enough colours
  // or nothing is left worth splitting. Same style of histogram as the
  // colour-picker tool (js/tools/palette.js), sized for up to 256 colours.
  function histogram(framesRGBA) {
    const bins = new Map();
    for (const rgba of framesRGBA) {
      const total = rgba.length / 4;
      const stride = Math.max(1, Math.floor(total / 20000));
      for (let p = 0; p < total; p += stride) {
        const o = p * 4;
        const r = rgba[o];
        const g = rgba[o + 1];
        const b = rgba[o + 2];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let bin = bins.get(key);
        if (!bin) bins.set(key, (bin = [0, 0, 0, 0]));
        bin[0] += r;
        bin[1] += g;
        bin[2] += b;
        bin[3] += 1;
      }
    }
    return [...bins.values()].map((b) => ({ r: b[0] / b[3], g: b[1] / b[3], b: b[2] / b[3], n: b[3] }));
  }

  function widestChannel(points) {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const p of points) {
      if (p.r < rMin) rMin = p.r;
      if (p.r > rMax) rMax = p.r;
      if (p.g < gMin) gMin = p.g;
      if (p.g > gMax) gMax = p.g;
      if (p.b < bMin) bMin = p.b;
      if (p.b > bMax) bMax = p.b;
    }
    const ranges = { r: rMax - rMin, g: gMax - gMin, b: bMax - bMin };
    return ranges.r >= ranges.g && ranges.r >= ranges.b ? "r" : ranges.g >= ranges.b ? "g" : "b";
  }

  function weight(points) {
    let n = 0;
    for (const p of points) n += p.n;
    return n;
  }

  function medianCut(points, maxColors) {
    if (!points.length) return [[0, 0, 0]];
    let boxes = [points];
    while (boxes.length < maxColors) {
      let best = -1;
      let bestWeight = -1;
      boxes.forEach((box, i) => {
        if (box.length > 1) {
          const w = weight(box);
          if (w > bestWeight) {
            bestWeight = w;
            best = i;
          }
        }
      });
      if (best === -1) break; // nothing left worth splitting
      const box = boxes[best];
      const ch = widestChannel(box);
      const sorted = [...box].sort((a, b) => a[ch] - b[ch]);
      const total = weight(sorted);
      let acc = 0;
      let cut = 0;
      for (; cut < sorted.length - 1; cut += 1) {
        acc += sorted[cut].n;
        if (acc >= total / 2) break;
      }
      const left = sorted.slice(0, cut + 1);
      const right = sorted.slice(cut + 1);
      if (!right.length) {
        const mid = Math.max(1, Math.floor(sorted.length / 2));
        boxes.splice(best, 1, sorted.slice(0, mid), sorted.slice(mid));
      } else {
        boxes.splice(best, 1, left, right);
      }
    }
    return boxes.map((box) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (const p of box) {
        r += p.r * p.n;
        g += p.g * p.n;
        b += p.b * p.n;
        n += p.n;
      }
      return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
    });
  }

  // A 32×32×32 cube (5 bits/channel) mapping any colour to its nearest
  // palette entry, computed once so every pixel is an O(1) lookup instead
  // of a distance check against every palette colour.
  function buildCube(palette) {
    const cube = new Uint8Array(32 * 32 * 32);
    for (let ri = 0; ri < 32; ri += 1) {
      for (let gi = 0; gi < 32; gi += 1) {
        for (let bi = 0; bi < 32; bi += 1) {
          const r = ri * 8 + 4;
          const g = gi * 8 + 4;
          const b = bi * 8 + 4;
          let best = 0;
          let bestD = Infinity;
          for (let p = 0; p < palette.length; p += 1) {
            const [pr, pg, pb] = palette[p];
            const d = (r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb);
            if (d < bestD) {
              bestD = d;
              best = p;
            }
          }
          cube[(ri << 10) | (gi << 5) | bi] = best;
        }
      }
    }
    return cube;
  }

  function indexFrame(rgba, cube) {
    const total = rgba.length / 4;
    const out = new Uint8Array(total);
    for (let p = 0; p < total; p += 1) {
      const o = p * 4;
      const r = rgba[o];
      const g = rgba[o + 1];
      const b = rgba[o + 2];
      out[p] = cube[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
    }
    return out;
  }

  function nextPow2(n) {
    let p = 4; // GIF's minimum LZW code size is 2 bits, i.e. a 4-entry table
    while (p < n) p *= 2;
    return Math.min(256, p);
  }

  // ── LZW encoder (GIF89a variant: variable code width, clear/end codes,
  // table capped at 12-bit codes) ────────────────────────────────────
  function lzwEncode(indices, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize;
    let nextCode;
    let dict;
    function reset() {
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
      dict = new Map();
    }

    const bytes = [];
    let bitAccum = 0;
    let bitCount = 0;
    function writeCode(code) {
      bitAccum |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        bytes.push(bitAccum & 0xff);
        bitAccum >>= 8;
        bitCount -= 8;
      }
    }

    reset();
    writeCode(clearCode);
    let prefix = -1;
    for (let i = 0; i < indices.length; i += 1) {
      const k = indices[i];
      if (prefix === -1) {
        prefix = k;
        continue;
      }
      const key = prefix * 4096 + k;
      const found = dict.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      writeCode(prefix);
      if (nextCode <= 4095) {
        // Growing the code width takes effect for codes assigned from here
        // on, not the one just written above — matches how a decoder only
        // learns of a new table entry (and widens to match) one code later.
        if (nextCode >= 1 << codeSize && codeSize < 12) codeSize += 1;
        dict.set(key, nextCode);
        nextCode += 1;
      } else {
        writeCode(clearCode);
        reset();
      }
      prefix = k;
    }
    if (prefix !== -1) writeCode(prefix);
    writeCode(eoiCode);
    if (bitCount > 0) bytes.push(bitAccum & 0xff);
    return new Uint8Array(bytes);
  }

  // GIF image data is chopped into "sub-blocks" of at most 255 bytes, each
  // preceded by its length, ending with a zero-length block.
  function subBlocks(bytes) {
    const nBlocks = Math.ceil(bytes.length / 255);
    const out = new Uint8Array(bytes.length + nBlocks + 1);
    let oi = 0;
    let i = 0;
    while (i < bytes.length) {
      const n = Math.min(255, bytes.length - i);
      out[oi] = n;
      oi += 1;
      out.set(bytes.subarray(i, i + n), oi);
      oi += n;
      i += n;
    }
    out[oi] = 0;
    return out;
  }

  const ASCII = (s) => [...s].map((c) => c.charCodeAt(0));

  // frames: [{ rgba: Uint8ClampedArray (w*h*4, opaque), delayCs: number }]
  function encode({ width, height, frames, loop = true, maxColors = 256 }) {
    if (!frames || !frames.length) throw new Error("No frames to encode.");
    const targetColors = Math.max(2, Math.min(256, maxColors));
    const points = histogram(frames.map((f) => f.rgba));
    const palette = medianCut(points, targetColors);
    const tableSize = nextPow2(palette.length);
    const cube = buildCube(palette);
    const minCodeSize = Math.log2(tableSize);

    const parts = [];
    const push = (arr) => parts.push(arr instanceof Uint8Array ? arr : new Uint8Array(arr));

    push(ASCII("GIF89a"));

    const lsd = new Uint8Array(7);
    lsd[0] = width & 0xff;
    lsd[1] = (width >> 8) & 0xff;
    lsd[2] = height & 0xff;
    lsd[3] = (height >> 8) & 0xff;
    const sizeField = Math.log2(tableSize) - 1;
    lsd[4] = (1 << 7) | (0x7 << 4) | (0 << 3) | sizeField; // global colour table, 8-bit colour res
    lsd[5] = 0; // background colour index
    lsd[6] = 0; // no fixed pixel aspect ratio
    push(lsd);

    const gct = new Uint8Array(tableSize * 3);
    palette.forEach(([r, g, b], i) => {
      gct[i * 3] = r;
      gct[i * 3 + 1] = g;
      gct[i * 3 + 2] = b;
    });
    push(gct);

    if (loop) {
      push([0x21, 0xff, 0x0b, ...ASCII("NETSCAPE2.0"), 0x03, 0x01, 0x00, 0x00, 0x00]);
    }

    for (const frame of frames) {
      const gce = new Uint8Array(8);
      gce[0] = 0x21;
      gce[1] = 0xf9;
      gce[2] = 0x04;
      gce[3] = 1 << 2; // disposal method 1 ("do not dispose"); no transparency
      const delay = Math.max(2, Math.round(frame.delayCs));
      gce[4] = delay & 0xff;
      gce[5] = (delay >> 8) & 0xff;
      gce[6] = 0; // transparent colour index, unused
      gce[7] = 0; // block terminator
      push(gce);

      const idt = new Uint8Array(10);
      idt[0] = 0x2c;
      idt[5] = width & 0xff;
      idt[6] = (width >> 8) & 0xff;
      idt[7] = height & 0xff;
      idt[8] = (height >> 8) & 0xff;
      idt[9] = 0; // no local colour table, no interlace
      push(idt);

      const indices = indexFrame(frame.rgba, cube);
      const compressed = lzwEncode(indices, minCodeSize);
      push([minCodeSize]);
      push(subBlocks(compressed));
    }

    push([0x3b]); // trailer

    const totalLen = parts.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return new Blob([out], { type: "image/gif" });
  }

  CL.gif = { encode };
})(window.CL = window.CL || {});
