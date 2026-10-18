// Offline QR codes (no internet needed) for table ordering cards.
import qrcode from "qrcode-generator";

/** SVG markup for a QR code. `cell` = pixels per module. */
export function qrSvg(text: string, cell = 6, margin = 2): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin, scalable: true });
}

export function qrDataUrl(text: string, cell = 6, margin = 2): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrSvg(text, cell, margin));
}

/** Standard "join this Wi-Fi" QR payload (works with Android & iPhone cameras). */
export function wifiQrText(ssid: string, password: string): string {
  const esc = (v: string) => v.replace(/([\\;,:"])/g, "\\$1");
  return password ? `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};;` : `WIFI:T:nopass;S:${esc(ssid)};;`;
}
