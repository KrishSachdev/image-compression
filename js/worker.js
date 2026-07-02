// Heavy per-pixel work (palette quantization, dithering, quality metrics)
// runs in a Web Worker so large images never freeze the page. The worker is
// built from a Blob URL so the app keeps working when opened via file://,
// where real worker files are blocked. The same kernel code doubles as a
// synchronous main-thread fallback when workers are unavailable.
(function (CL) {
  "use strict";

  // Factory shared verbatim between the worker source and the fallback:
  // its stringified body is injected into the worker, so it must be fully
  // self-contained (no references to CL or the DOM).
  function makeKernels() {
    function quantizeValue(value, levels) {
      if (levels <= 1) return 0;
      const step = 255 / (levels - 1);
      return Math.max(0, Math.min(255, Math.round(Math.round(value / step) * step)));
    }

    function distributeError(buffer, index, error, factor) {
      buffer[index] += error[0] * factor;
      buffer[index + 1] += error[1] * factor;
      buffer[index + 2] += error[2] * factor;
    }

    // payload: { buffer: ArrayBuffer (RGBA), width, height, levels, dither }
    // Returns the quantized Uint8ClampedArray (same dimensions).
    function quantize(payload) {
      const { width, height, levels, dither } = payload;
      const data = new Uint8ClampedArray(payload.buffer);

      if (!dither) {
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 16) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 0;
            continue;
          }
          data[i] = quantizeValue(data[i], levels);
          data[i + 1] = quantizeValue(data[i + 1], levels);
          data[i + 2] = quantizeValue(data[i + 2], levels);
        }
        return data;
      }

      const buffer = Float32Array.from(data);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          if (buffer[i + 3] < 16) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 0;
            continue;
          }

          const old = [buffer[i], buffer[i + 1], buffer[i + 2]];
          const next = [
            quantizeValue(old[0], levels),
            quantizeValue(old[1], levels),
            quantizeValue(old[2], levels),
          ];
          data[i] = next[0];
          data[i + 1] = next[1];
          data[i + 2] = next[2];

          const err = [old[0] - next[0], old[1] - next[1], old[2] - next[2]];
          if (x + 1 < width) distributeError(buffer, i + 4, err, 7 / 16);
          if (x > 0 && y + 1 < height) {
            distributeError(buffer, i + (width - 1) * 4, err, 3 / 16);
          }
          if (y + 1 < height) distributeError(buffer, i + width * 4, err, 5 / 16);
          if (x + 1 < width && y + 1 < height) {
            distributeError(buffer, i + (width + 1) * 4, err, 1 / 16);
          }
        }
      }
      return data;
    }

    // payload: { ref: ArrayBuffer, out: ArrayBuffer, width, height }
    // Both buffers are RGBA at identical dimensions. Returns
    // { delta: mean abs difference in %, ssim: 0..1 structural similarity }.
    function metrics(payload) {
      const { width, height } = payload;
      const a = new Uint8ClampedArray(payload.ref);
      const b = new Uint8ClampedArray(payload.out);

      let total = 0;
      for (let i = 0; i < a.length; i += 4) {
        total += Math.abs(a[i] - b[i]);
        total += Math.abs(a[i + 1] - b[i + 1]);
        total += Math.abs(a[i + 2] - b[i + 2]);
      }
      const delta = (total / ((a.length / 4) * 3) / 255) * 100;

      // Grayscale SSIM over non-overlapping 8×8 windows.
      const count = width * height;
      const ga = new Float32Array(count);
      const gb = new Float32Array(count);
      for (let p = 0, i = 0; p < count; p += 1, i += 4) {
        ga[p] = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
        gb[p] = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      }

      const C1 = 6.5025; // (0.01 * 255)²
      const C2 = 58.5225; // (0.03 * 255)²
      const win = 8;
      const samples = win * win;
      let sum = 0;
      let windows = 0;
      for (let wy = 0; wy + win <= height; wy += win) {
        for (let wx = 0; wx + win <= width; wx += win) {
          let meanA = 0;
          let meanB = 0;
          for (let y = 0; y < win; y += 1) {
            const row = (wy + y) * width + wx;
            for (let x = 0; x < win; x += 1) {
              meanA += ga[row + x];
              meanB += gb[row + x];
            }
          }
          meanA /= samples;
          meanB /= samples;

          let varA = 0;
          let varB = 0;
          let cov = 0;
          for (let y = 0; y < win; y += 1) {
            const row = (wy + y) * width + wx;
            for (let x = 0; x < win; x += 1) {
              const da = ga[row + x] - meanA;
              const db = gb[row + x] - meanB;
              varA += da * da;
              varB += db * db;
              cov += da * db;
            }
          }
          varA /= samples - 1;
          varB /= samples - 1;
          cov /= samples - 1;

          sum +=
            ((2 * meanA * meanB + C1) * (2 * cov + C2)) /
            ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2));
          windows += 1;
        }
      }

      return { delta, ssim: windows ? sum / windows : 1 };
    }

    return { quantize, metrics };
  }

  CL.kernels = makeKernels();

  let worker = null;
  const jobs = new Map();
  let seq = 0;

  function failAllJobs(error) {
    jobs.forEach((job) => job.reject(error));
    jobs.clear();
  }

  try {
    const source =
      '"use strict";\n' +
      `const kernels = (${makeKernels.toString()})();\n` +
      "onmessage = (event) => {\n" +
      "  const { id, job, payload } = event.data;\n" +
      "  try {\n" +
      "    const result = kernels[job](payload);\n" +
      "    const transfers = result && result.buffer instanceof ArrayBuffer ? [result.buffer] : [];\n" +
      "    postMessage({ id, ok: true, result }, transfers);\n" +
      "  } catch (error) {\n" +
      "    postMessage({ id, ok: false, error: String((error && error.message) || error) });\n" +
      "  }\n" +
      "};";
    worker = new Worker(
      URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
    );
    worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data;
      const job = jobs.get(id);
      if (!job) return;
      jobs.delete(id);
      if (ok) job.resolve(result);
      else job.reject(new Error(error));
    };
    worker.onerror = () => {
      // Worker died: reject in-flight jobs and fall back to the main thread
      // for everything after.
      failAllJobs(new Error("Image worker failed."));
      worker = null;
    };
  } catch {
    worker = null;
  }

  // Run a kernel job, off the main thread when possible. `transfers` lists
  // ArrayBuffers inside payload to hand over instead of copying — after the
  // call, always use the returned data, never the transferred input.
  CL.runJob = function (job, payload, transfers = []) {
    if (!worker) {
      return Promise.resolve().then(() => CL.kernels[job](payload));
    }
    return new Promise((resolve, reject) => {
      const id = (seq += 1);
      jobs.set(id, { resolve, reject });
      worker.postMessage({ id, job, payload }, transfers);
    });
  };
})(window.CL = window.CL || {});
