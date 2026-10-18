// Shrink an uploaded picture in the browser before it is saved, so any photo
// (even a 12 MB phone picture) can be used and the POS stays fast.
// Returns a data: URL that is stored in the settings.

export interface ResizeOptions {
  maxWidth: number;
  maxHeight: number;
  /** keep transparency (logos): PNG output instead of JPEG */
  keepTransparency?: boolean;
  /** target upper bound for the stored image, bytes (approx.) */
  maxBytes?: number;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This file is not a picture the browser can open. Use JPG or PNG."));
    img.src = src;
  });
}

export async function resizeImageFile(file: File, opts: ResizeOptions): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a picture (JPG, PNG or WebP).");
  if (file.size > 40 * 1024 * 1024) throw new Error("That picture is too big (over 40 MB).");
  const maxBytes = opts.maxBytes ?? 900 * 1024;

  // SVG logos stay sharp at any size — keep them as they are when small.
  if (file.type === "image/svg+xml") {
    if (file.size > 300 * 1024) throw new Error("SVG file is too large (max 300 KB).");
    return readAsDataUrl(file);
  }

  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, opts.maxWidth / img.naturalWidth, opts.maxHeight / img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  // Already small enough and no resize needed → keep the original bytes.
  if (scale === 1 && file.size <= maxBytes && /image\/(png|jpeg|webp|gif)/.test(file.type)) return original;

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the picture");
  ctx.imageSmoothingQuality = "high";
  if (!opts.keepTransparency) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, w, h);

  if (opts.keepTransparency) {
    const png = canvas.toDataURL("image/png");
    if (png.length * 0.75 <= maxBytes) return png;
    const webp = canvas.toDataURL("image/webp", 0.9);   // keeps transparency, much smaller
    if (webp.startsWith("data:image/webp")) return webp;
    return png;
  }
  // Photos: step the JPEG quality down until it fits.
  for (const q of [0.88, 0.8, 0.72, 0.62, 0.5]) {
    const jpg = canvas.toDataURL("image/jpeg", q);
    if (jpg.length * 0.75 <= maxBytes || q === 0.5) return jpg;
  }
  return canvas.toDataURL("image/jpeg", 0.5);
}

/** Two letters from the business name, used when no logo is uploaded. */
export function initials(name?: string): string {
  const words = String(name || "").replace(/[^A-Za-z0-9\u00C0-\uFFFF ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "POS";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
