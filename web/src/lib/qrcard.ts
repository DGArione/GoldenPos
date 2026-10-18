// Table QR card for an 80 mm / 58 mm thermal printer.
// Drawn on a canvas in the browser, turned into a 1-bit bitmap and sent to the
// print agent as a "qr" job, so it prints straight to the chosen Windows
// printer (no print dialog) and needs no QR support in the printer firmware.
import qrcode from "qrcode-generator";

export interface QrCardInput {
  biz: string;
  tableName: string;
  url: string;
  /** optional "join our Wi-Fi" QR + text (local-address setups) */
  wifiText?: string;
  wifiLabel?: string;
  /** one line printed under the QR */
  footer?: string;
}

export interface Raster { width: number; height: number; dataBase64: string }

function drawQr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const px = Math.floor(size / (n + quiet * 2));
  const real = px * (n + quiet * 2);
  const ox = x + Math.floor((size - real) / 2) + quiet * px;
  const oy = y + Math.floor((size - real) / 2) + quiet * px;
  ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(ox + c * px, oy + r * px, px, px);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out: string[] = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= max || !cur) cur = t; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Build the card bitmap. `dots` = printable width: 576 for 80 mm, 384 for 58 mm. */
export function qrCardRaster(card: QrCardInput, dots = 576): Raster {
  const W = Math.floor(dots / 8) * 8;
  const pad = 16;
  const qrSize = Math.min(W - 40, dots >= 576 ? 440 : 330);
  const wifiQr = Math.round(qrSize * 0.42);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = 2000;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = "#000"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  const font = (px: number, weight = 700) => { ctx.font = `${weight} ${px}px Arial, Helvetica, sans-serif`; };
  const big = dots >= 576 ? 1 : 0.7;
  let y = pad;
  const lines = (text: string, px: number, weight = 700, gap = 6) => {
    font(Math.round(px * big), weight);
    for (const l of wrap(ctx, text, W - pad * 2)) { ctx.fillText(l, W / 2, y); y += Math.round(px * big) + gap; }
  };
  if (card.biz) lines(card.biz, 30, 800);
  lines(card.tableName, 56, 900, 10);
  y += 6;
  if (card.wifiText) {
    lines("1. Join our Wi-Fi", 26, 700);
    drawQr(ctx, card.wifiText, Math.floor((W - wifiQr) / 2), y, wifiQr); y += wifiQr + 6;
    if (card.wifiLabel) lines(card.wifiLabel, 22, 600, 4);
    y += 8;
    lines("2. Scan to see the menu & order", 26, 700);
  } else {
    lines("Scan to see the menu & order", 26, 700);
  }
  drawQr(ctx, card.url, Math.floor((W - qrSize) / 2), y, qrSize); y += qrSize + 8;
  if (card.footer) lines(card.footer, 20, 400, 4);
  y += pad;
  const H = Math.min(y, 2000);
  // 1-bit pack (1 = black)
  const img = ctx.getImageData(0, 0, W, H).data;
  const bpr = W / 8;
  const buf = new Uint8Array(bpr * H);
  for (let yy = 0; yy < H; yy++) for (let x = 0; x < W; x++) {
    const i = (yy * W + x) * 4;
    const lum = img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114;
    if (lum < 140) buf[yy * bpr + (x >> 3)] |= 0x80 >> (x & 7);
  }
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
  return { width: W, height: H, dataBase64: btoa(bin) };
}
