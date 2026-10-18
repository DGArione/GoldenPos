// Tiny dependency-free PDF writer for reports (A4, Helvetica, tables).
// Produces a real .pdf file that downloads straight away — no print dialog.

export interface PdfSection {
  title: string;
  head: string[];
  rows: (string | number)[][];
  /** relative column widths (default: equal) */
  widths?: number[];
  /** columns to right-align (numbers / money) */
  right?: number[];
}
export interface PdfReport {
  title: string;
  subtitle?: string;
  kpis?: [string, string][];
  sections: PdfSection[];
}

const W = 595.28, H = 841.89, M = 40;          // A4 in points, margin
const ROW = 15, FS = 9;

/** PDF base fonts only know WinAnsi; map common symbols and drop the rest. */
function ascii(s: unknown): string {
  return String(s ?? "")
    .replace(/[–—−]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/→/g, "->").replace(/·/g, "-").replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "");
}
function esc(s: string) { return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
// Helvetica average glyph width ~0.5em (good enough for clipping/alignment)
function textW(s: string, size: number) { return s.length * size * 0.5; }
function fit(s: string, size: number, max: number) {
  if (textW(s, size) <= max) return s;
  let t = s; while (t.length > 1 && textW(t + "...", size) > max) t = t.slice(0, -1);
  return t + "...";
}

export function buildReportPdf(rep: PdfReport): Blob {
  const pages: string[] = [];
  let ops: string[] = [];
  let y = H - M;
  const newPage = () => { if (ops.length) pages.push(ops.join("\n")); ops = []; y = H - M; };
  const text = (s: string, x: number, yy: number, size = FS, bold = false, color = "0 0 0") => {
    ops.push(`BT ${color} rg /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${esc(s)}) Tj ET`);
  };
  const rect = (x: number, yy: number, w: number, h: number, gray: string) => ops.push(`${gray} rg ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  const line = (x1: number, yy: number, x2: number) => ops.push(`0.88 G 0.5 w ${x1.toFixed(2)} ${yy.toFixed(2)} m ${x2.toFixed(2)} ${yy.toFixed(2)} l S`);
  const need = (h: number) => { if (y - h < M + 20) newPage(); };

  // Header
  text(ascii(rep.title), M, y - 16, 16, true); y -= 24;
  if (rep.subtitle) { text(ascii(rep.subtitle), M, y - 10, 9, false, "0.45 0.45 0.45"); y -= 18; }
  // KPI boxes, 3 per row
  if (rep.kpis?.length) {
    const bw = (W - 2 * M - 20) / 3;
    rep.kpis.forEach(([l, v], i) => {
      if (i % 3 === 0) { need(46); if (i) y -= 46; }
      const x = M + (i % 3) * (bw + 10);
      rect(x, y - 40, bw, 38, "0.97 0.95 0.91");
      text(ascii(l).toUpperCase(), x + 8, y - 14, 7, false, "0.5 0.5 0.5");
      text(fit(ascii(v), 13, bw - 16), x + 8, y - 32, 13, true, "0.66 0.37 0");
    });
    y -= 54;
  }
  // Sections
  for (const sec of rep.sections) {
    need(ROW * 3 + 20);
    y -= 8;
    text(ascii(sec.title).toUpperCase(), M, y - 10, 10, true, "0.66 0.37 0"); y -= 18;
    const total = (sec.widths || sec.head.map(() => 1)).reduce((a, b) => a + b, 0);
    const cw = (sec.widths || sec.head.map(() => 1)).map((w) => (w / total) * (W - 2 * M));
    const drawHead = () => {
      rect(M, y - ROW + 3, W - 2 * M, ROW, "0.98 0.96 0.91");
      let x = M;
      sec.head.forEach((h, i) => {
        const s = fit(ascii(h), FS, cw[i] - 8);
        const right = sec.right?.includes(i);
        text(s, right ? x + cw[i] - 4 - textW(s, FS) : x + 4, y - 8, FS, true, "0.33 0.33 0.33");
        x += cw[i];
      });
      y -= ROW;
    };
    drawHead();
    if (!sec.rows.length) { text("No data", M + 4, y - 8, FS, false, "0.55 0.55 0.55"); y -= ROW; continue; }
    for (const r of sec.rows) {
      if (y - ROW < M + 20) { newPage(); drawHead(); }
      let x = M;
      r.forEach((c, i) => {
        const s = fit(ascii(c), FS, cw[i] - 8);
        const right = sec.right?.includes(i);
        text(s, right ? x + cw[i] - 4 - textW(s, FS) : x + 4, y - 8, FS);
        x += cw[i];
      });
      line(M, y - ROW + 2, W - M);
      y -= ROW;
    }
  }
  newPage();

  // Assemble objects: 1 catalog, 2 pages, 3 F1, 4 F2, then page+content pairs
  const objs: string[] = [];
  const kids: number[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, i) => {
    const total = pages.length;
    const footer = `BT 0.6 0.6 0.6 rg /F1 7 Tf ${M} 20 Td (Page ${i + 1} of ${total}) Tj ET`;
    const stream = content + "\n" + footer;
    const pageNo = 5 + i * 2, contNo = pageNo + 1;
    kids.push(pageNo);
    objs[pageNo] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contNo} 0 R >>`;
    objs[contNo] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objs.length; n++) { offsets[n] = out.length; out += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: "application/pdf" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** CSV with sections; a BOM so Excel opens UTF-8 correctly. */
export function buildCsv(title: string, sections: { title: string; rows: (string | number)[][] }[]): Blob {
  const cell = (c: unknown) => `"${String(c ?? "").replace(/"/g, '""')}"`;
  let csv = cell(title) + "\n";
  for (const s of sections) csv += `\n${cell(s.title)}\n` + s.rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
  return new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
}
