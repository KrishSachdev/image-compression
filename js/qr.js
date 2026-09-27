// QR code encoder, written from scratch (no library, no CDN). Supports
// byte-mode data (covers plain text, URLs, Wi-Fi strings and vCards) at
// versions 1–10 (up to a few hundred characters, more than enough for a
// link or a Wi-Fi password) and all four error-correction levels.
// Implements the standard algorithm: Reed–Solomon error correction over
// GF(256), the 8 mask patterns with penalty scoring, and BCH-encoded
// format/version info — the same approach every QR library uses.
(function (CL) {
  "use strict";

  // ── GF(256), primitive polynomial 0x11D ──────────────────────────
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
  })();
  const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

  function polyMul(a, b) {
    const res = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < b.length; j += 1) res[i + j] ^= gfMul(a[i], b[j]);
    }
    return res;
  }

  function rsGenerator(degree) {
    let g = [1];
    for (let i = 0; i < degree; i += 1) g = polyMul(g, [1, GF_EXP[i]]);
    return g;
  }

  // Systematic Reed–Solomon encode: returns the `ecCount` EC codewords.
  function rsEncode(dataBytes, ecCount) {
    const gen = rsGenerator(ecCount);
    const buf = dataBytes.concat(new Array(ecCount).fill(0));
    for (let i = 0; i < dataBytes.length; i += 1) {
      const coef = buf[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j += 1) buf[i + j] ^= gfMul(gen[j], coef);
      }
    }
    return buf.slice(dataBytes.length);
  }

  // ── Block table (versions 1–10), [numBlocks, totalCodewords, dataCodewords] per group ──
  const RS_BLOCKS = {
    1: { L: [[1, 26, 19]], M: [[1, 26, 16]], Q: [[1, 26, 13]], H: [[1, 26, 9]] },
    2: { L: [[1, 44, 34]], M: [[1, 44, 28]], Q: [[1, 44, 22]], H: [[1, 44, 16]] },
    3: { L: [[1, 70, 55]], M: [[1, 70, 44]], Q: [[2, 35, 17]], H: [[2, 35, 13]] },
    4: { L: [[1, 100, 80]], M: [[2, 50, 32]], Q: [[2, 50, 24]], H: [[4, 25, 9]] },
    5: { L: [[1, 134, 108]], M: [[2, 67, 43]], Q: [[2, 33, 15], [2, 34, 16]], H: [[2, 33, 11], [2, 34, 12]] },
    6: { L: [[2, 86, 68]], M: [[4, 43, 27]], Q: [[4, 43, 19]], H: [[4, 43, 15]] },
    7: { L: [[2, 98, 78]], M: [[4, 49, 31]], Q: [[2, 32, 14], [4, 33, 15]], H: [[4, 39, 13], [1, 40, 14]] },
    8: { L: [[2, 121, 97]], M: [[2, 60, 38], [2, 61, 39]], Q: [[4, 40, 18], [2, 41, 19]], H: [[4, 40, 14], [2, 41, 15]] },
    9: { L: [[2, 146, 116]], M: [[3, 58, 36], [2, 59, 37]], Q: [[4, 36, 16], [4, 37, 17]], H: [[4, 36, 12], [4, 37, 13]] },
    10: { L: [[2, 86, 68], [2, 87, 69]], M: [[4, 69, 43], [1, 70, 44]], Q: [[6, 43, 19], [2, 44, 20]], H: [[6, 43, 15], [2, 44, 16]] },
  };
  const ALIGNMENT = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  const MAX_VERSION = 10;

  // ── Byte-mode data encoding ───────────────────────────────────────
  function charCountBits(version) {
    return version < 10 ? 8 : 16;
  }

  function bytesToBits(bytes, version) {
    const bits = [];
    const push = (value, len) => {
      for (let i = len - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
    };
    push(0b0100, 4); // byte-mode indicator
    push(bytes.length, charCountBits(version));
    for (const b of bytes) push(b, 8);
    return bits;
  }

  function dataCapacityBits(version, level) {
    return RS_BLOCKS[version][level].reduce((sum, g) => sum + g[0] * g[2], 0) * 8;
  }

  function pickVersion(bytes, level) {
    for (let v = 1; v <= MAX_VERSION; v += 1) {
      if (bytesToBits(bytes, v).length <= dataCapacityBits(v, level)) return v;
    }
    return null;
  }

  function buildDataCodewords(bytes, version, level) {
    const capacityBits = dataCapacityBits(version, level);
    const bits = bytesToBits(bytes, version);
    const termLen = Math.min(4, capacityBits - bits.length);
    for (let i = 0; i < termLen; i += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }
    const pad = [0xec, 0x11];
    let p = 0;
    while (codewords.length < capacityBits / 8) {
      codewords.push(pad[p % 2]);
      p += 1;
    }
    return codewords;
  }

  // Split into RS blocks, error-correct each, then interleave (data columns
  // first, then EC columns) as the standard requires.
  function interleave(dataCodewords, version, level) {
    const groups = RS_BLOCKS[version][level];
    const blocks = [];
    let idx = 0;
    let ecCount = 0;
    for (const [numBlocks, total, dataLen] of groups) {
      ecCount = total - dataLen;
      for (let b = 0; b < numBlocks; b += 1) {
        const data = dataCodewords.slice(idx, idx + dataLen);
        idx += dataLen;
        blocks.push({ data, ec: rsEncode(data, ecCount) });
      }
    }
    const maxData = Math.max(...blocks.map((b) => b.data.length));
    const out = [];
    for (let i = 0; i < maxData; i += 1) {
      for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
    }
    for (let i = 0; i < ecCount; i += 1) {
      for (const b of blocks) out.push(b.ec[i]);
    }
    return out;
  }

  // ── BCH encoding for format (0x537/15,5) and version (0x1F25/18,6) info ──
  const bitLength = (x) => {
    let n = 0;
    while (x) {
      n += 1;
      x >>>= 1;
    }
    return n;
  };
  function bchEncode(data, generator) {
    const gLen = bitLength(generator);
    let d = data << (gLen - 1);
    while (bitLength(d) >= gLen) d ^= generator << (bitLength(d) - gLen);
    return (data << (gLen - 1)) | d;
  }
  const FORMAT_MASK = 0x5412;
  const EC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

  // ── Matrix construction ───────────────────────────────────────────
  function buildBaseMatrix(version) {
    const size = 17 + version * 4;
    const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const setFinder = (r0, c0) => {
      for (let r = -1; r <= 7; r += 1) {
        for (let c = -1; c <= 7; c += 1) {
          const rr = r0 + r;
          const cc = c0 + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const dark = inRing && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          m[rr][cc] = dark;
        }
      }
    };
    setFinder(0, 0);
    setFinder(0, size - 7);
    setFinder(size - 7, 0);
    for (let i = 8; i < size - 8; i += 1) {
      if (m[6][i] === null) m[6][i] = i % 2 === 0;
      if (m[i][6] === null) m[i][6] = i % 2 === 0;
    }
    const pos = ALIGNMENT[version] || [];
    for (const pr of pos) {
      for (const pc of pos) {
        if ((pr <= 8 && pc <= 8) || (pr <= 8 && pc >= size - 9) || (pr >= size - 9 && pc <= 8)) continue;
        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            m[pr + r][pc + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          }
        }
      }
    }
    m[size - 8][8] = true; // dark module
    setupFormatInfo(m, size, 0); // reserve format-info cells (real bits filled in later)
    return m;
  }

  function setupFormatInfo(m, size, bits) {
    for (let i = 0; i < 15; i += 1) {
      const dark = ((bits >> i) & 1) === 1;
      if (i < 6) m[i][8] = dark;
      else if (i < 8) m[i + 1][8] = dark;
      else m[size - 15 + i][8] = dark;
    }
    for (let i = 0; i < 15; i += 1) {
      const dark = ((bits >> i) & 1) === 1;
      if (i < 8) m[8][size - i - 1] = dark;
      else if (i < 9) m[8][15 - i - 1 + 1] = dark;
      else m[8][15 - i - 1] = dark;
    }
    m[size - 8][8] = true;
  }

  function setupVersionInfo(m, size, bits) {
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >> i) & 1) === 1;
      const row = Math.floor(i / 3);
      const col = (i % 3) + size - 11;
      m[row][col] = dark;
      m[col][row] = dark;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function placeData(base, size, bits, maskIndex) {
    const m = base.map((row) => row.slice());
    const maskFn = MASKS[maskIndex];
    let bitIdx = 0;
    let dir = -1;
    let row = size - 1;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      for (;;) {
        for (let c = 0; c < 2; c += 1) {
          const cc = col - c;
          if (m[row][cc] === null) {
            let dark = bitIdx < bits.length ? bits[bitIdx] === 1 : false;
            if (maskFn(row, cc)) dark = !dark;
            m[row][cc] = dark;
            bitIdx += 1;
          }
        }
        row += dir;
        if (row < 0 || row >= size) {
          row -= dir;
          dir = -dir;
          break;
        }
      }
    }
    return m;
  }

  function penalty(m, size) {
    let score = 0;
    for (let r = 0; r < size; r += 1) {
      let color = m[r][0];
      let run = 1;
      for (let c = 1; c < size; c += 1) {
        if (m[r][c] === color) run += 1;
        else {
          if (run >= 5) score += 3 + (run - 5);
          color = m[r][c];
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (let c = 0; c < size; c += 1) {
      let color = m[0][c];
      let run = 1;
      for (let r = 1; r < size; r += 1) {
        if (m[r][c] === color) run += 1;
        else {
          if (run >= 5) score += 3 + (run - 5);
          color = m[r][c];
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (let r = 0; r < size - 1; r += 1) {
      for (let c = 0; c < size - 1; c += 1) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    const patA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const patB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matches = (seq, pat) => seq.every((v, i) => (v ? 1 : 0) === pat[i]);
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c <= size - 11; c += 1) {
        const seq = [];
        for (let k = 0; k < 11; k += 1) seq.push(m[r][c + k]);
        if (matches(seq, patA) || matches(seq, patB)) score += 40;
      }
    }
    for (let c = 0; c < size; c += 1) {
      for (let r = 0; r <= size - 11; r += 1) {
        const seq = [];
        for (let k = 0; k < 11; k += 1) seq.push(m[r + k][c]);
        if (matches(seq, patA) || matches(seq, patB)) score += 40;
      }
    }
    let dark = 0;
    for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) if (m[r][c]) dark += 1;
    const ratio = (dark * 100) / (size * size);
    score += Math.min(Math.abs(Math.floor(ratio / 5) * 5 - 50), Math.abs(Math.ceil(ratio / 5) * 5 - 50)) * 2;
    return score;
  }

  // Encode `text` at the requested error-correction level. Returns
  // { version, size, modules } or null if the text is too long even at
  // the lowest (L) protection this encoder supports (version 10).
  function encode(text, level = "M") {
    const bytes = Array.from(new TextEncoder().encode(text));
    const version = pickVersion(bytes, level);
    if (!version) return null;
    const dataCodewords = buildDataCodewords(bytes, version, level);
    const finalCodewords = interleave(dataCodewords, version, level);
    const bits = [];
    for (const byte of finalCodewords) for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);

    const size = 17 + version * 4;
    const base = buildBaseMatrix(version);
    if (version >= 7) setupVersionInfo(base, size, bchEncode(version, 0x1f25));

    let best = null;
    let bestScore = Infinity;
    let bestMask = 0;
    for (let mask = 0; mask < 8; mask += 1) {
      const m = placeData(base, size, bits, mask);
      const s = penalty(m, size);
      if (s < bestScore) {
        bestScore = s;
        best = m;
        bestMask = mask;
      }
    }
    const formatData = (EC_BITS[level] << 3) | bestMask;
    const formatBits = bchEncode(formatData, 0x537) ^ FORMAT_MASK;
    setupFormatInfo(best, size, formatBits);
    return { version, size, modules: best, level, mask: bestMask };
  }

  // Maximum bytes this encoder can fit at a given level (for a live counter).
  function maxBytes(level) {
    return Math.floor((dataCapacityBits(MAX_VERSION, level) - 4 - 16) / 8);
  }

  function toCanvas(qr, { scale = 8, margin = 4, fg = "#000000", bg = "#ffffff" } = {}) {
    const total = qr.size + margin * 2;
    const canvas = document.createElement("canvas");
    canvas.width = total * scale;
    canvas.height = total * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = fg;
    for (let r = 0; r < qr.size; r += 1) {
      for (let c = 0; c < qr.size; c += 1) {
        if (qr.modules[r][c]) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
      }
    }
    return canvas;
  }

  function toSVG(qr, { scale = 8, margin = 4, fg = "#000000", bg = "#ffffff" } = {}) {
    const total = (qr.size + margin * 2) * scale;
    let path = "";
    for (let r = 0; r < qr.size; r += 1) {
      for (let c = 0; c < qr.size; c += 1) {
        if (qr.modules[r][c]) path += `M${(c + margin) * scale},${(r + margin) * scale}h${scale}v${scale}h${-scale}z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}"><rect width="${total}" height="${total}" fill="${bg}"/><path d="${path}" fill="${fg}"/></svg>`;
  }

  CL.qr = { encode, toCanvas, toSVG, maxBytes, MAX_VERSION };
})(window.CL = window.CL || {});
