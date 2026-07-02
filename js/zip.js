// Minimal ZIP writer (store method, no compression) so a batch of outputs can
// be downloaded as one archive without any library. Store is the right call
// here: the entries are already-compressed image files, so deflate would only
// burn CPU for ~0% gain.
(function (CL) {
  "use strict";

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const time =
      (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day =
      ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function u16(view, offset, value) {
    view.setUint16(offset, value & 0xffff, true);
  }

  function u32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  // entries: [{ name, blob }] → Blob of a valid .zip archive.
  async function create(entries) {
    const encoder = new TextEncoder();
    const { time, day } = dosDateTime(new Date());
    const parts = [];
    const records = [];
    let offset = 0;

    for (const entry of entries) {
      const data = new Uint8Array(await entry.blob.arrayBuffer());
      const nameBytes = encoder.encode(entry.name);
      const crc = crc32(data);

      const header = new DataView(new ArrayBuffer(30));
      u32(header, 0, 0x04034b50); // local file header signature
      u16(header, 4, 20); // version needed
      u16(header, 6, 0x0800); // flags: UTF-8 filename
      u16(header, 8, 0); // method: store
      u16(header, 10, time);
      u16(header, 12, day);
      u32(header, 14, crc);
      u32(header, 18, data.length); // compressed size (= raw, store)
      u32(header, 22, data.length); // uncompressed size
      u16(header, 26, nameBytes.length);
      u16(header, 28, 0); // extra length

      parts.push(header.buffer, nameBytes, data);
      records.push({ nameBytes, crc, size: data.length, offset });
      offset += 30 + nameBytes.length + data.length;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const record of records) {
      const central = new DataView(new ArrayBuffer(46));
      u32(central, 0, 0x02014b50); // central directory signature
      u16(central, 4, 20); // version made by
      u16(central, 6, 20); // version needed
      u16(central, 8, 0x0800); // flags: UTF-8 filename
      u16(central, 10, 0); // method: store
      u16(central, 12, time);
      u16(central, 14, day);
      u32(central, 16, record.crc);
      u32(central, 20, record.size);
      u32(central, 24, record.size);
      u16(central, 28, record.nameBytes.length);
      u16(central, 30, 0); // extra length
      u16(central, 32, 0); // comment length
      u16(central, 34, 0); // disk number
      u16(central, 36, 0); // internal attributes
      u32(central, 38, 0); // external attributes
      u32(central, 42, record.offset);
      parts.push(central.buffer, record.nameBytes);
      centralSize += 46 + record.nameBytes.length;
    }

    const end = new DataView(new ArrayBuffer(22));
    u32(end, 0, 0x06054b50); // end of central directory signature
    u16(end, 4, 0); // disk number
    u16(end, 6, 0); // central directory disk
    u16(end, 8, records.length);
    u16(end, 10, records.length);
    u32(end, 12, centralSize);
    u32(end, 16, centralStart);
    u16(end, 20, 0); // comment length
    parts.push(end.buffer);

    return new Blob(parts, { type: "application/zip" });
  }

  CL.zip = { create, crc32 };
})(window.CL = window.CL || {});
