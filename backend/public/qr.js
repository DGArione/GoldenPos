// qr.js — thin wrapper over the vendored qrcode-generator (window.qrcode).
// window.posQrSvg(text) → a crisp, printable SVG string for any text/URL.
(function () {
  window.posQrSvg = function (text, opts) {
    opts = opts || {};
    try {
      const qr = qrcode(0, opts.ec || "M");   // type 0 = auto-size for the data
      qr.addData(String(text || ""));
      qr.make();
      const svg = qr.createSvgTag({ cellSize: opts.cell || 5, margin: opts.margin == null ? 12 : opts.margin, scalable: true });
      // Force the SVG to fill its container — a viewBox-only SVG sizes
      // inconsistently across browsers, which can render blank.
      return svg.replace("<svg ", '<svg style="width:100%;height:100%;display:block" ');
    } catch (e) {
      return `<div style="color:var(--danger);font-size:12px;">Could not render QR: ${e.message}</div>`;
    }
  };

  // window.posQrRaster(text, {width, maxDots}) → { width, height, dataBase64 }
  // A centred 1-bit bitmap (1 = black) of the QR code, `width` dots wide
  // (576 = 80 mm, 384 = 58 mm), for ESC/POS "raster image" printing.
  window.posQrRaster = function (text, opts) {
    opts = opts || {};
    const W = Math.max(8, Math.floor((opts.width || 576) / 8) * 8);
    const qr = qrcode(0, opts.ec || "M");
    qr.addData(String(text || ""));
    qr.make();
    const n = qr.getModuleCount(), quiet = 2, T = n + quiet * 2;
    const px = Math.floor(Math.min(W, opts.maxDots || 448) / T);
    if (px < 2) throw new Error("QR address is too long to print clearly");
    const size = T * px, left = Math.floor((W - size) / 2), bpr = W / 8;
    const buf = new Uint8Array(bpr * size);
    for (let y = 0; y < size; y++) {
      const mr = Math.floor(y / px) - quiet;
      if (mr < 0 || mr >= n) continue;
      for (let x = 0; x < size; x++) {
        const mc = Math.floor(x / px) - quiet;
        if (mc < 0 || mc >= n || !qr.isDark(mr, mc)) continue;
        const col = left + x;
        buf[y * bpr + (col >> 3)] |= 0x80 >> (col & 7);
      }
    }
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { width: W, height: size, dataBase64: btoa(bin) };
  };
})();
