// table.js — guest ordering page reached by scanning a table's QR (/t/<token>).
// No login. Loads the table's branch + menu, lets the guest build an order, and
// posts it to the kitchen (or the staff accept-queue, per the shop's setting).
(function () {
  const token = (location.pathname.match(/\/t\/([A-Za-z0-9]+)/) || [])[1] || "";
  const API = "/api";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let TABLE = null, MENU = [], CATS = [], CUR = "Rs. ", RATE = { serviceCharge: 0, vat: 0 };
  let cat = "__all__", cart = [];

  const money = (n) => CUR + Number(n || 0).toFixed(2);
  function toast(msg) { const t = $("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2400); }

  async function boot() {
    if (!token) { fail("No table code in the link."); return; }
    try {
      const tRes = await fetch(`${API}/public/table?token=${encodeURIComponent(token)}`);
      if (!tRes.ok) { const e = await tRes.json().catch(() => ({})); return fail(e.error || "This QR code is not recognised."); }
      TABLE = await tRes.json();
      if (!TABLE.branchActive) return fail(`${esc(TABLE.businessName)} isn’t taking orders right now.`);
      document.title = `${TABLE.businessName} — ${TABLE.tableName}`;
      const mRes = await fetch(`${API}/public/menu?branchId=${TABLE.branchId}`);
      const m = await mRes.json();
      MENU = m.items || []; CATS = m.categories || []; CUR = m.currency || "Rs. "; RATE = m.rates || RATE;
      render();
    } catch (e) { fail("Could not load the menu. Please try again."); }
  }

  function fail(msg) {
    $("root").innerHTML = `<div class="t-center"><div style="font-size:40px;margin-bottom:10px;">🍽️</div>
      <div style="font-weight:700;font-size:17px;margin-bottom:6px;">${esc(msg)}</div>
      <div style="color:var(--muted);font-size:13px;">Please ask our staff for help.</div></div>`;
  }

  function render() {
    const cats = CATS.filter((c) => MENU.some((m) => m.category === c));
    const items = cat === "__all__" ? MENU : MENU.filter((m) => m.category === cat);
    $("root").innerHTML = `
      <div class="t-header">
        <div><div class="biz">${esc(TABLE.businessName)}</div><div class="tbl">Ordering for ${esc(TABLE.tableName)}</div></div>
      </div>
      <div class="t-chips">
        <button class="t-chip ${cat === "__all__" ? "active" : ""}" data-cat="__all__">All</button>
        ${cats.map((c) => `<button class="t-chip ${cat === c ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
      </div>
      <div id="items">
        ${items.length ? items.map(itemRow).join("") : `<div class="t-center" style="color:var(--muted);">Nothing in this section.</div>`}
      </div>`;
    document.querySelectorAll("[data-cat]").forEach((b) => b.onclick = () => { cat = b.dataset.cat; render(); });
    document.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
      const item = MENU.find((m) => m.id == b.dataset.add);
      if (item.soldOut) return toast(`${item.name} is sold out`);
      if ((item.modifiers || []).length) openItemSheet(item); else addToCart(item, 1, []);
    });
    syncCartBar();
  }

  function itemRow(m) {
    return `<div class="t-item ${m.soldOut ? "t-soldout" : ""}">
      <div class="thumb" style="${m.imageUrl ? `background-image:url('${esc(m.imageUrl)}')` : ""}"></div>
      <div class="info"><div class="nm">${esc(m.name)}</div><div class="pr">${money(m.price)}${m.soldOut ? ' · <span style="color:var(--danger)">sold out</span>' : ""}</div></div>
      ${m.soldOut ? "" : `<button class="t-add" data-add="${m.id}">＋</button>`}
    </div>`;
  }

  // ── Modifier sheet (required/min/max enforced; server re-validates) ──
  function openItemSheet(item) {
    const groups = (item.modifiers || []).map((g) => {
      const max = Math.max(1, parseInt(g.max, 10) || 1);
      const min = g.required ? Math.max(1, parseInt(g.min, 10) || 1) : Math.max(0, parseInt(g.min, 10) || 0);
      return { name: g.name, max, min, multi: max > 1, required: min >= 1,
        options: (g.options || []).map((o) => ({ name: o.name || o.option, priceDelta: Number(o.priceDelta) || 0 })) };
    });
    let qty = 1;
    const sheet = sheetEl(`
      <h3 style="margin:0 0 4px;">${esc(item.name)}</h3>
      <div style="color:var(--accent);font-weight:700;margin-bottom:14px;">${money(item.price)}</div>
      ${groups.map((g, gi) => `
        <div style="margin-bottom:14px;" data-g="${gi}">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
            <strong style="font-size:14px;">${esc(g.name)}</strong>
            <span style="font-size:11px;color:${g.required ? "var(--danger)" : "var(--muted)"};">${g.multi ? `pick ${g.min}–${g.max}` : (g.required ? "required" : "optional")}</span>
          </div>
          ${g.options.map((o, oi) => `
            <label style="display:flex;align-items:center;gap:10px;padding:8px 0;font-size:15px;">
              <input type="${g.multi ? "checkbox" : "radio"}" name="g${gi}" value="${oi}" ${!g.multi && g.required && oi === 0 ? "checked" : ""}/>
              <span style="flex:1;">${esc(o.name)}</span>${o.priceDelta ? `<span style="color:var(--accent);font-size:13px;">+${money(o.priceDelta)}</span>` : ""}
            </label>`).join("")}
        </div>`).join("")}
      <div style="display:flex;align-items:center;gap:14px;margin:6px 0 16px;">
        <span style="font-weight:600;">Quantity</span>
        <span class="t-step"><button id="qd">−</button><span id="qv" style="min-width:24px;text-align:center;font-weight:700;">1</span><button id="qi">＋</button></span>
      </div>
      <div id="sheetErr" style="color:var(--danger);font-size:12px;min-height:16px;margin-bottom:6px;"></div>
      <button class="t-big" id="addBtn">Add to order</button>
    `);
    sheet.querySelector("#qd").onclick = () => { qty = Math.max(1, qty - 1); sheet.querySelector("#qv").textContent = qty; };
    sheet.querySelector("#qi").onclick = () => { qty++; sheet.querySelector("#qv").textContent = qty; };
    groups.forEach((g, gi) => { if (!g.multi) return; sheet.querySelectorAll(`input[name="g${gi}"]`).forEach((cb) => cb.addEventListener("change", () => {
      if (sheet.querySelectorAll(`input[name="g${gi}"]:checked`).length > g.max) { cb.checked = false; sheet.querySelector("#sheetErr").textContent = `Choose at most ${g.max} from ${g.name}`; }
      else sheet.querySelector("#sheetErr").textContent = "";
    })); });
    sheet.querySelector("#addBtn").onclick = () => {
      const mods = [];
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const picked = Array.from(sheet.querySelectorAll(`input[name="g${gi}"]:checked`));
        if (picked.length < g.min) { sheet.querySelector("#sheetErr").textContent = `Choose at least ${g.min} from ${g.name}`; return; }
        picked.forEach((p) => { const o = g.options[+p.value]; mods.push({ group: g.name, option: o.name, priceDelta: o.priceDelta }); });
      }
      addToCart(item, qty, mods);
      closeSheet();
    };
  }

  function addToCart(item, qty, modifiers) {
    const modTotal = modifiers.reduce((s, m) => s + m.priceDelta, 0);
    cart.push({ menuItemId: item.id, name: item.name, basePrice: item.price, qty, modifiers, notes: "", lineTotal: +((item.price + modTotal) * qty).toFixed(2) });
    toast(`${item.name} added`);
    syncCartBar();
  }

  function syncCartBar() {
    const n = cart.reduce((s, c) => s + c.qty, 0);
    const bar = $("cartBar");
    if (!n) { bar.style.display = "none"; return; }
    bar.style.display = "flex";
    $("cartCount").textContent = n;
    const sub = cart.reduce((s, c) => s + c.lineTotal, 0);
    $("cartTotal").textContent = money(sub);
  }
  $("cartBar").onclick = openCart;

  function openCart() {
    const sub = cart.reduce((s, c) => s + c.lineTotal, 0);
    const sc = sub * RATE.serviceCharge, vat = (sub + sc) * RATE.vat, total = sub + sc + vat;
    const sheet = sheetEl(`
      <h3 style="margin:0 0 12px;">Your order · ${esc(TABLE.tableName)}</h3>
      <div id="cartLines">${cart.map(cartLine).join("")}</div>
      <div style="margin:12px 0;font-size:13px;color:var(--muted);">
        <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>${money(sub)}</span></div>
        ${sc > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Service</span><span>${money(sc)}</span></div>` : ""}
        ${vat > 0 ? `<div style="display:flex;justify-content:space-between;"><span>VAT</span><span>${money(vat)}</span></div>` : ""}
        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:16px;color:var(--text);margin-top:6px;"><span>Total</span><span>${money(total)}</span></div>
      </div>
      <textarea id="ordNote" placeholder="Note for the kitchen (allergies, no onion…)" rows="2" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;font-family:inherit;font-size:14px;margin-bottom:12px;"></textarea>
      <button class="t-big" id="placeBtn">Send order to the kitchen</button>
      <button class="t-big" id="moreBtn" style="background:var(--neutral-bg);color:var(--text);margin-top:8px;">Add more items</button>
    `);
    sheet.querySelectorAll("[data-inc]").forEach((b) => b.onclick = () => { cart[+b.dataset.inc].qty++; recalcLine(+b.dataset.inc); refreshCart(); });
    sheet.querySelectorAll("[data-dec]").forEach((b) => b.onclick = () => { const i = +b.dataset.dec; cart[i].qty--; if (cart[i].qty <= 0) cart.splice(i, 1); else recalcLine(i); refreshCart(); });
    sheet.querySelector("#moreBtn").onclick = closeSheet;
    sheet.querySelector("#placeBtn").onclick = () => placeOrder(sheet.querySelector("#ordNote").value.trim());
  }
  function cartLine(c, i) {
    const mods = c.modifiers.map((m) => m.option).join(", ");
    return `<div class="t-line"><div><div style="font-weight:600;">${esc(c.name)}</div>${mods ? `<div style="font-size:12px;color:var(--muted);">${esc(mods)}</div>` : ""}
      <span class="t-step" style="margin-top:6px;"><button data-dec="${i}">−</button><span style="min-width:22px;text-align:center;">${c.qty}</span><button data-inc="${i}">＋</button></span></div>
      <div style="font-weight:700;white-space:nowrap;">${money(c.lineTotal)}</div></div>`;
  }
  function recalcLine(i) { const c = cart[i]; const md = c.modifiers.reduce((s, m) => s + (m.priceDelta || 0), 0); c.lineTotal = +((c.basePrice + md) * c.qty).toFixed(2); }
  function refreshCart() { syncCartBar(); if (!cart.length) { closeSheet(); return; } closeSheet(); openCart(); }

  let _sending = false;
  async function placeOrder(note) {
    if (_sending || !cart.length) return;
    _sending = true;
    const btn = document.getElementById("placeBtn"); if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    try {
      const res = await fetch(`${API}/public/table-order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, note, items: cart.map((c) => ({ menuItemId: c.menuItemId, qty: c.qty, modifiers: c.modifiers })) }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) { toast(r.error || "Could not send the order"); if (btn) { btn.disabled = false; btn.textContent = "Send order to the kitchen"; } _sending = false; return; }
      cart = []; syncCartBar(); closeSheet();
      showConfirm(r);
    } finally { _sending = false; }
  }

  function showConfirm(r) {
    $("root").innerHTML = `<div class="t-center">
      <div style="font-size:52px;margin-bottom:10px;">✅</div>
      <div style="font-weight:800;font-size:20px;margin-bottom:6px;">Order sent!</div>
      <div style="color:var(--muted);font-size:14px;margin-bottom:4px;">${esc(TABLE.tableName)} · ${esc(r.displayNum || "")}</div>
      <div style="color:var(--muted);font-size:14px;margin-bottom:22px;">${r.autoKitchen ? "The kitchen is preparing your order." : "A team member will confirm your order shortly."}</div>
      <button class="t-big" id="againBtn" style="max-width:280px;">Order more</button>
    </div>`;
    document.getElementById("againBtn").onclick = () => render();
  }

  // ── Bottom sheet helper ──
  function sheetEl(inner) {
    let s = document.querySelector(".t-sheet");
    if (!s) { s = document.createElement("div"); s.className = "t-sheet"; document.body.appendChild(s); s.onclick = (e) => { if (e.target === s) closeSheet(); }; }
    s.innerHTML = `<div class="panel">${inner}</div>`;
    s.style.display = "flex";
    return s;
  }
  function closeSheet() { const s = document.querySelector(".t-sheet"); if (s) s.style.display = "none"; }

  boot();
})();
