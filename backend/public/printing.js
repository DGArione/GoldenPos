// printing.js — route tickets to a local thermal print agent when one is
// configured, so KOTs and receipts print straight to the printer without the
// browser print dialog (which drops the till out of full-screen). Falls back
// to the caller's own iframe printing when no agent is set up or it's offline.
(function () {
  function agent() {
    const s = window.posSettings || {};
    return { url: (s.printAgentUrl || "").trim(), enabled: !!s.printAgentEnabled, width: parseInt(s.printPaperWidth, 10) || 48, kitchenPrinterName: s.kitchenPrinterName || "", paymentPrinterName: s.paymentPrinterName || "", qrPrinterName: s.qrPrinterName || "" };
  }
  window.posPrintAgentReady = function () { const a = agent(); return a.enabled && /^https?:\/\//.test(a.url); };

  // POST a job to the agent. Returns true on success, false on any failure so
  // the caller can fall back. Job: { type, title, text, copies }.
  window.posSendToAgent = async function (job) {
    const a = agent();
    if (!a.enabled || !/^https?:\/\//.test(a.url)) return false;
    try {
      const payload = Object.assign({ copies: 1 }, job);
      const role = payload.printerRole || ((payload.type === "kot" || payload.type === "kitchen") ? "kitchen" : "payment");
      const configuredName = role === "kitchen" ? a.kitchenPrinterName : role === "qr" ? a.qrPrinterName : a.paymentPrinterName;
      // Never silently fall back to the Windows default printer. A role must be explicitly configured.
      if (!configuredName || !String(configuredName).trim()) return false;
      payload.printerName = configuredName;
      const res = await fetch(a.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch (_) { return false; }
  };

  // ── Table QR card → the QR printer chosen in Settings > Printing ──
  window.posQrPrinterReady = function () {
    const a = agent();
    return a.enabled && /^https?:\/\//.test(a.url) && !!String(a.qrPrinterName).trim() && typeof window.posQrRaster === "function";
  };
  // Returns true when the card was sent; false → caller falls back to browser print.
  window.posPrintTableQr = async function (o) {
    if (!window.posQrPrinterReady()) return false;
    try {
      const dots = agent().width >= 42 ? 576 : 384;
      const raster = window.posQrRaster(o.url, { width: dots, maxDots: dots === 576 ? 448 : 320 });
      return await window.posSendToAgent({ type: "qr", printerRole: "qr", title: o.title || "", subtitle: o.subtitle || "", footer: o.footer || "", raster, copies: 1 });
    } catch (_) { return false; }
  };

  // ── Plain-text ticket builders (monospace, `width` chars wide) ──
  function line(ch, w) { return (ch || "-").repeat(w); }
  function pad2(left, right, w) {
    left = String(left); right = String(right);
    const space = Math.max(1, w - left.length - right.length);
    if (left.length + right.length + 1 > w) left = left.slice(0, w - right.length - 1);
    return left + " ".repeat(Math.max(1, w - left.length - right.length)) + right;
  }
  function center(s, w) { s = String(s); if (s.length >= w) return s.slice(0, w); const pad = Math.floor((w - s.length) / 2); return " ".repeat(pad) + s; }

  window.posKotText = function (order, stationName, lines, width) {
    const w = width || agent().width;
    const out = [];
    out.push(center("*** " + String(stationName).toUpperCase() + " ***", w));
    out.push(center(order.displayNum || ("#" + order.id), w));
    out.push(center((order.tableName || "") + "  " + ((order.orderType || "dine-in").toUpperCase()), w));
    if (order.customerName) out.push(center("Cust: " + order.customerName, w));
    out.push(center(new Date(order.createdAt || Date.now()).toLocaleString(), w));
    out.push(line("=", w));
    if (order.priority === "high") { out.push(center("*** PRIORITY ***", w)); out.push(line("-", w)); }
    (lines || []).forEach((it) => {
      out.push(pad2(it.qty + "x " + it.name, "", w));
      if (it.modifiers && it.modifiers.length) out.push("   + " + it.modifiers.map((m) => m.option || m.name).join(", "));
      if (it.notes) out.push("   ** " + it.notes + " **");
    });
    out.push(line("=", w));
    if (order.note) out.push("Note: " + order.note);
    return out.join("\n");
  };

  window.posReceiptText = function (order, settings, width) {
    const w = width || agent().width;
    const s = settings || window.posSettings || {};
    const cur = s.currencySymbol || "";
    const out = [];
    out.push(center((s.businessName || "Restaurant").toUpperCase(), w));
    if (s.businessAddress) out.push(center(s.businessAddress, w));
    if (s.businessPhone) out.push(center(s.businessPhone, w));
    if (s.taxRegNo) out.push(center("TRN: " + s.taxRegNo, w));
    out.push(line("=", w));
    out.push(pad2("Receipt", "#" + String(order.id).padStart(6, "0"), w));
    if (order.fiscalNumber) out.push(pad2("Fiscal", order.fiscalNumber, w));
    out.push(pad2(order.tableName || "", new Date(order.paidAt || order.createdAt || Date.now()).toLocaleString(), w));
    out.push(line("-", w));
    (order.items || []).forEach((it) => {
      out.push(pad2(it.qty + "x " + it.name, cur + Number(it.lineTotal || 0).toFixed(2), w));
      if (it.modifiers && it.modifiers.length) out.push("   " + it.modifiers.map((m) => m.option || m.name).join(", "));
    });
    out.push(line("-", w));
    out.push(pad2("Subtotal", cur + Number(order.subtotal || 0).toFixed(2), w));
    if (order.discount && order.discount.amount) out.push(pad2("Discount", "-" + cur + Number(order.discount.amount).toFixed(2), w));
    if (order.promo && order.promo.amount) out.push(pad2("Promo (" + order.promo.name + ")", "-" + cur + Number(order.promo.amount).toFixed(2), w));
    out.push(pad2("Service", cur + Number(order.serviceCharge || 0).toFixed(2), w));
    out.push(pad2("VAT", cur + Number(order.vat || 0).toFixed(2), w));
    out.push(pad2("TOTAL", cur + Number(order.grandTotal || order.total || 0).toFixed(2), w));
    out.push(line("=", w));
    (order.payments || []).forEach((p) => out.push(pad2((p.method || "").toUpperCase() + (p.type === "refund" ? " (refund)" : ""), cur + Number(p.amount || 0).toFixed(2), w)));
    out.push("");
    out.push(center(s.receiptFooterText || "Thank you!", w));
    return out.join("\n");
  };
})();
