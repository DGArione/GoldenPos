// Offline CODE128 (set B) barcode → SVG. No internet needed, scans with any
// USB/Bluetooth barcode scanner. Used for gift cards and bill numbers.

const PATTERNS = [
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
  "114131","311141","411131","211412","211214","211232","2331112",
];

/** Bar/space module widths for `text` (printable ASCII only). */
export function code128Modules(text: string): number[] {
  const clean = String(text).replace(/[^\x20-\x7e]/g, "");
  const codes = [104]; // Start B
  for (const ch of clean) codes.push(ch.charCodeAt(0) - 32);
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106); // checksum + Stop
  const widths: number[] = [];
  for (const c of codes) for (const d of PATTERNS[c]) widths.push(Number(d));
  return widths;
}

/** SVG markup of the barcode. `module` = width of the thinnest bar in px. */
export function code128Svg(text: string, opts: { module?: number; height?: number; quiet?: number; showText?: boolean; fontSize?: number } = {}): string {
  const m = opts.module ?? 2, h = opts.height ?? 80, q = opts.quiet ?? 10, fs = opts.fontSize ?? 16;
  const widths = code128Modules(text);
  const total = widths.reduce((a, b) => a + b, 0);
  const w = (total + q * 2) * m;
  const textH = opts.showText === false ? 0 : fs + 8;
  let x = q * m, rects = "";
  widths.forEach((wd, i) => {
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${wd * m}" height="${h}"/>`;
    x += wd * m;
  });
  const label = opts.showText === false ? "" :
    `<text x="${w / 2}" y="${h + fs + 2}" font-family="monospace" font-size="${fs}" font-weight="700" letter-spacing="3" text-anchor="middle">${String(text).replace(/[<&>]/g, "")}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + textH}" viewBox="0 0 ${w} ${h + textH}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>${label}</svg>`;
}

export function code128DataUrl(text: string, opts?: Parameters<typeof code128Svg>[1]): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(code128Svg(text, opts));
}
