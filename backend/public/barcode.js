// barcode.js — tiny, dependency-free CODE128-B barcode as inline SVG.
// window.renderBarcode(text) → SVG string that any POS barcode scanner reads.
(function () {
  // Bar/space width patterns for CODE128 values 0..106 (6 modules each; stop=7).
  const P = [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
    "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
    "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
    "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
    "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
    "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
    "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
    "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
    "114131","311141","411131","211412","211214","211232","2331112"
  ];
  const START_B = 104, STOP = 106;

  window.renderBarcode = function (text, opts) {
    opts = opts || {};
    const H = opts.height || 60;
    const unit = opts.unit || 2;      // px per module
    const str = String(text || "");
    // Build the symbol value sequence (Start B + data + checksum + Stop).
    const values = [START_B];
    let sum = START_B;
    for (let i = 0; i < str.length; i++) {
      const v = str.charCodeAt(i) - 32;   // Code B maps ASCII 32..126 → 0..94
      const val = (v < 0 || v > 94) ? 0 : v;
      values.push(val);
      sum += val * (i + 1);
    }
    values.push(sum % 103);               // checksum
    values.push(STOP);

    // Expand patterns to bar widths; even index = bar, odd = space.
    let x = 0; const rects = [];
    for (const v of values) {
      const pat = P[v]; if (!pat) continue;
      for (let i = 0; i < pat.length; i++) {
        const w = parseInt(pat[i], 10) * unit;
        if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${H}" fill="#000"/>`);
        x += w;
      }
    }
    const width = x;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" shape-rendering="crispEdges" style="max-width:100%;">${rects.join("")}</svg>`;
  };
})();
