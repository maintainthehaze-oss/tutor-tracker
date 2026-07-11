/* ============================================================
   Tutoring Tracker Pro — Receipt OCR (100% on-device)
   Tesseract.js (self-hosted in vendor/tesseract/) extracts
   vendor / date / total from receipt images. No network calls:
   the engine, worker, WASM core, and language data are all
   served from this app's own origin and run locally.
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;

  // Absolute same-origin URL — paths are resolved inside the OCR web
  // worker, where relative URLs would resolve against the wrong base.
  const VENDOR_DIR = new URL('vendor/tesseract/', window.location.href).href;
  let workerPromise = null; // lazy singleton

  /** Inject the self-hosted tesseract.min.js on first use. */
  function loadTesseractScript() {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) { resolve(); return; }
      const s = document.createElement('script');
      s.src = VENDOR_DIR + 'tesseract.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load OCR engine'));
      document.head.appendChild(s);
    });
  }

  /** Create (once) the OCR worker, entirely from same-origin assets. */
  function getWorker() {
    if (!workerPromise) {
      workerPromise = loadTesseractScript().then(() =>
        window.Tesseract.createWorker('eng', 1, {
          workerPath: VENDOR_DIR + 'worker.min.js',
          corePath: VENDOR_DIR,
          langPath: VENDOR_DIR,
          gzip: true,
          // Spawn the worker directly from our same-origin file. The default
          // (a blob: URL wrapper) is blocked by this app's CSP.
          workerBlobURL: false,
        })
      ).catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  /* ----------------------- field parsing ----------------------- */

  const MONEY_RE = /\$?\s?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\b/g;

  function toAmount(str) {
    // "1,234.56" or "1.234,56" -> 1234.56
    const cleaned = str.replace(/\s/g, '');
    const lastSep = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
    const intPart = cleaned.slice(0, lastSep).replace(/[.,]/g, '');
    const decPart = cleaned.slice(lastSep + 1);
    const n = parseFloat(intPart + '.' + decPart);
    return isNaN(n) ? null : n;
  }

  function parseTotal(lines) {
    const isTotalLine = (l) => /\b(grand\s*total|amount\s*due|balance\s*due|total)\b/i.test(l) &&
      !/sub\s*-?\s*total/i.test(l);
    const amountsOn = (l) => {
      const out = [];
      let m;
      MONEY_RE.lastIndex = 0;
      while ((m = MONEY_RE.exec(l)) !== null) {
        const n = toAmount(m[1]);
        if (n != null && n > 0 && n < 100000) out.push(n);
      }
      return out;
    };
    // Prefer amounts on "total"-ish lines (last such line wins — receipts
    // print subtotal/tax/total top-down)
    let best = null;
    lines.forEach((l) => {
      if (!isTotalLine(l)) return;
      const amts = amountsOn(l);
      if (amts.length) best = Math.max.apply(null, amts);
    });
    if (best != null) return best;
    // Fallback: the largest amount anywhere
    let max = null;
    lines.forEach((l) => {
      amountsOn(l).forEach((n) => { if (max == null || n > max) max = n; });
    });
    return max;
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function isoIfValid(y, mo, d) {
    if (y < 100) y += 2000;
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1) return null;
    const now = new Date();
    if (dt.getTime() > now.getTime() + 86400000) return null; // not future
    if (y < now.getFullYear() - 10) return null;              // not ancient
    const pad = (n) => (n < 10 ? '0' : '') + n;
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  function parseDate(text) {
    const found = [];
    let m;
    // MM/DD/YYYY, MM-DD-YY, etc.
    const numeric = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
    while ((m = numeric.exec(text)) !== null) {
      const iso = isoIfValid(parseInt(m[3], 10), parseInt(m[1], 10), parseInt(m[2], 10));
      if (iso) found.push(iso);
    }
    // YYYY-MM-DD
    const isoRe = /\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g;
    while ((m = isoRe.exec(text)) !== null) {
      const iso = isoIfValid(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
      if (iso) found.push(iso);
    }
    // "Jul 2, 2026" / "2 Jul 2026"
    const monRe = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})\b/gi;
    while ((m = monRe.exec(text)) !== null) {
      const iso = isoIfValid(parseInt(m[3], 10), MONTHS[m[1].slice(0, 3).toLowerCase()], parseInt(m[2], 10));
      if (iso) found.push(iso);
    }
    if (!found.length) return null;
    found.sort();
    return found[found.length - 1]; // most recent plausible date
  }

  function parseVendor(lines) {
    const noise = /receipt|invoice|thank|welcome|tel[:.]|phone|www\.|http|order\s*#|cashier|register|customer|copy/i;
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const l = lines[i].trim();
      const letters = (l.match(/[a-zA-Z]/g) || []).length;
      if (letters >= 3 && !noise.test(l) && !MONEY_RE.test(l) && !/\d{3,}/.test(l)) {
        MONEY_RE.lastIndex = 0;
        return l.replace(/\s{2,}/g, ' ').slice(0, 60);
      }
      MONEY_RE.lastIndex = 0;
    }
    return null;
  }

  function parseFields(text) {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    return {
      vendor: parseVendor(lines),
      date: parseDate(text),
      total: parseTotal(lines),
    };
  }

  /* --------------------- PDF → image (pdf.js) --------------------- */

  const PDFJS_DIR = new URL('vendor/pdfjs/', window.location.href).href;

  /** Inject self-hosted pdf.js on first use (same-origin, on-device). */
  function loadPdfJs() {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) { resolve(); return; }
      const s = document.createElement('script');
      s.src = PDFJS_DIR + 'pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_DIR + 'pdf.worker.min.js';
        resolve();
      };
      s.onerror = () => reject(new Error('Could not load PDF renderer'));
      document.head.appendChild(s);
    });
  }

  /**
   * Render page 1 of a PDF (dataURL) to a JPEG dataURL, entirely on-device
   * (isEvalSupported:false keeps pdf.js CSP-safe). Returns null on failure.
   */
  async function pdfToImage(dataUrl) {
    try {
      await loadPdfJs();
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
      const doc = await window.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, 1600 / base.width); // target ~1600px wide, cap 3x
      const viewport = page.getViewport({ scale: scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
      const out = canvas.toDataURL('image/jpeg', 0.85);
      doc.destroy();
      return out;
    } catch (e) {
      console.error('PDF render failed:', e);
      return null;
    }
  }

  /* ------------------------- public API ------------------------- */

  /**
   * OCR a receipt image (dataURL) and return {vendor, date, total} —
   * any field may be null. Never throws; returns null on total failure.
   * All processing happens in this browser; the image never leaves it.
   */
  async function extractReceiptFields(dataUrl) {
    try {
      const worker = await getWorker();
      const result = await worker.recognize(dataUrl);
      const text = (result && result.data && result.data.text) || '';
      if (!text.trim()) return null;
      return parseFields(text);
    } catch (e) {
      console.error('Receipt OCR failed:', e);
      return null;
    }
  }

  App.extractReceiptFields = extractReceiptFields;
  App.pdfToImage = pdfToImage;
  App.__parseReceiptText = parseFields; // exposed for testing only

})();
