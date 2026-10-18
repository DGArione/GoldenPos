// online-order.js — public online ordering (no login). Clean, menu-first.
// Orders land in the staff "Online Orders" tab tagged "online", for a server
// or manager to accept. Mirrors the QR table page's simple flow.
(function () {
  const API = (() => {
    const me = document.currentScript && document.currentScript.src;
    if (me) return me.replace(/\/[^/]*$/, "") + "/api";
    return "/api";
  })();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let BIZ = "Restaurant", BRANCHES = [], branchId = null;
  let MENU = [], CATS = [], CUR = "Rs. ", RATE = { serviceCharge: 0, vat: 0 };
  let cat = "__all__", type = "takeaway", cart = [];

  const money = (n) => CUR + Number(n || 0).toFixed(2);
  function toast(msg) { const t = $("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2400); }

  async function boot() {
    try {
      const sRes = await fetch(`${API}/public/settings`);
      if (sRes.ok) { const s = await sRes.json(); BIZ = s.businessName || "Restaurant"; document.title = BIZ + " — Order Online"; }
      const bRes = await fetch(`${API}/public/branches`);
      BRANCHES = bRes.ok ? await bRes.json() : [];
      if (!BRANCHES.length) return fail("No branches are taking online orders right now.");
      branchId = BRANCHES[0].id;
      await loadMenu();
    } catch (e) { fail("Could not load the menu. Please try again."); }
  }

  async function loadMenu() {
    const r = await fetch(`${API}/public/menu?branchId=${branchId}`);
    const m = await r.json();
    MENU = m.items || []; CATS = m.categories || []; CUR = m.currency || "Rs. "; RATE = m.rates || RATE;
    render();
  }

  function fail(msg) {
    $("root").innerHTML = `<div class="o-center"><div style="font-size:40px;margin-bottom:10px;">🍽️</div>
      <div style="font-weight:700;font-size:17px;">${esc(msg)}</div></div>`;
  }

  function render() {
    const cats = CATS.filter((c) => MENU.some((m) => m.category === c));
    const items = cat === "__all__" ? MENU : MENU.filter((m) => m.category === cat);
    $("root").innerHTML = `
      <div class="o-header">
        <div class="biz">${esc(BIZ)}</div>
        ${BRANCHES.length > 1 ? `<select id="branchSel">${BRANCHES.map((b) => `<option value="${b.id}" ${b.id == branchId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>` : `<span style="font-size:12px;color:var(--muted);">${esc((BRANCHES[0] || {}).name || "")}</span>`}
      </div>
      <div class="o-types">
        <button class="o-type ${type === "takeaway" ? "active" : ""}" data-t="takeaway">🥡 Pickup</button>
        <button class="o-type ${type === "delivery" ? "active" : ""}" data-t="delivery">🛵 Delivery</button>
      </div>
      <div class="o-chips">
        <button class="o-chip ${cat === "__all__" ? "active" : ""}" data-cat="__all__">All</button>
        ${cats.map((c) => `<button class="o-chip ${cat === c ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
      </div>
      <div id="items">${items.length ? items.map(itemRow).join("") : `<div class="o-center" style="color:var(--muted);">Nothing in this section.</div>`}</div>`;
    const bs = $("branchSel"); if (bs) bs.onchange = async () => { branchId = Number(bs.value); cart = []; syncBar(); await loadMenu(); };
    document.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { type = b.dataset.t; render(); });
    document.querySelectorAll("[data-cat]").forEach((b) => b.onclick = () => { cat = b.dataset.cat; render(); });
    document.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
      const item = MENU.find((m) => m.id == b.dataset.add);
      if (item.soldOut) return toast(`${item.name} is sold out`);
      if ((item.modifiers || []).length) openItemSheet(item); else addToCart(item, 1, []);
    });
    syncBar();
  }

  function itemRow(m) {
    return `<div class="o-item ${m.soldOut ? "o-soldout" : ""}">
      <div class="thumb" style="${m.imageUrl ? `background-image:url('${esc(m.imageUrl)}')` : ""}"></div>
      <div style="flex:1;min-width:0;"><div class="nm">${esc(m.name)}</div><div class="pr">${money(m.price)}${m.soldOut ? ' · <span style="color:var(--danger)">sold out</span>' : ""}</div></div>
      ${m.soldOut ? "" : `<button class="o-add" data-add="${m.id}">＋</button>`}</div>`;
  }

  function openItemSheet(item) {
    const groups = (item.modifiers || []).map((g) => {
      const max = Math.max(1, parseInt(g.max, 10) || 1);
      const min = g.required ? Math.max(1, parseInt(g.min, 10) || 1) : Math.max(0, parseInt(g.min, 10) || 0);
      return { name: g.name, max, min, multi: max > 1, required: min >= 1, options: (g.options || []).map((o) => ({ name: o.name || o.option, priceDelta: Number(o.priceDelta) || 0 })) };
    });
    let qty = 1;
    const sheet = sheetEl(`
      <h3 style="margin:0 0 4px;">${esc(item.name)}</h3>
      <div style="color:var(--accent);font-weight:700;margin-bottom:14px;">${money(item.price)}</div>
      ${groups.map((g, gi) => `
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><strong style="font-size:14px;">${esc(g.name)}</strong>
            <span style="font-size:11px;color:${g.required ? "var(--danger)" : "var(--muted)"};">${g.multi ? `pick ${g.min}–${g.max}` : (g.required ? "required" : "optional")}</span></div>
          ${g.options.map((o, oi) => `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;font-size:15px;">
            <input type="${g.multi ? "checkbox" : "radio"}" name="g${gi}" value="${oi}" ${!g.multi && g.required && oi === 0 ? "checked" : ""}/>
            <span style="flex:1;">${esc(o.name)}</span>${o.priceDelta ? `<span style="color:var(--accent);font-size:13px;">+${money(o.priceDelta)}</span>` : ""}</label>`).join("")}
        </div>`).join("")}
      <div style="display:flex;align-items:center;gap:14px;margin:6px 0 16px;"><span style="font-weight:600;">Quantity</span>
        <span class="o-step"><button id="qd">−</button><span id="qv" style="min-width:24px;text-align:center;font-weight:700;">1</span><button id="qi">＋</button></span></div>
      <div id="sheetErr" style="color:var(--danger);font-size:12px;min-height:16px;margin-bottom:6px;"></div>
      <button class="o-big" id="addBtn">Add to order</button>`);
    sheet.querySelector("#qd").onclick = () => { qty = Math.max(1, qty - 1); sheet.querySelector("#qv").textContent = qty; };
    sheet.querySelector("#qi").onclick = () => { qty++; sheet.querySelector("#qv").textContent = qty; };
    groups.forEach((g, gi) => { if (!g.multi) return; sheet.querySelectorAll(`input[name="g${gi}"]`).forEach((cb) => cb.addEventListener("change", () => {
      if (sheet.querySelectorAll(`input[name="g${gi}"]:checked`).length > g.max) { cb.checked = false; sheet.querySelector("#sheetErr").textContent = `Choose at most ${g.max} from ${g.name}`; } else sheet.querySelector("#sheetErr").textContent = "";
    })); });
    sheet.querySelector("#addBtn").onclick = () => {
      const mods = [];
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const picked = Array.from(sheet.querySelectorAll(`input[name="g${gi}"]:checked`));
        if (picked.length < g.min) { sheet.querySelector("#sheetErr").textContent = `Choose at least ${g.min} from ${g.name}`; return; }
        picked.forEach((p) => { const o = g.options[+p.value]; mods.push({ group: g.name, option: o.name, priceDelta: o.priceDelta }); });
      }
      addToCart(item, qty, mods); closeSheet();
    };
  }

  function addToCart(item, qty, modifiers) {
    const md = modifiers.reduce((s, m) => s + m.priceDelta, 0);
    cart.push({ menuItemId: item.id, name: item.name, basePrice: item.price, qty, modifiers, lineTotal: +((item.price + md) * qty).toFixed(2) });
    toast(`${item.name} added`); syncBar();
  }
  function syncBar() {
    const n = cart.reduce((s, c) => s + c.qty, 0), bar = $("cartBar");
    if (!n) { bar.style.display = "none"; return; }
    bar.style.display = "flex"; $("cartCount").textContent = n; $("cartTotal").textContent = money(cart.reduce((s, c) => s + c.lineTotal, 0));
  }
  $("cartBar").onclick = openCart;

  function openCart() {
    const sub = cart.reduce((s, c) => s + c.lineTotal, 0), sc = sub * RATE.serviceCharge, vat = (sub + sc) * RATE.vat, total = sub + sc + vat;
    const sheet = sheetEl(`
      <h3 style="margin:0 0 12px;">Your order (${type === "delivery" ? "Delivery" : "Pickup"})</h3>
      <div>${cart.map(cartLine).join("")}</div>
      <div style="margin:12px 0;font-size:13px;color:var(--muted);">
        <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>${money(sub)}</span></div>
        ${sc > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Service</span><span>${money(sc)}</span></div>` : ""}
        ${vat > 0 ? `<div style="display:flex;justify-content:space-between;"><span>VAT</span><span>${money(vat)}</span></div>` : ""}
        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:16px;color:var(--text);margin-top:6px;"><span>Total</span><span>${money(total)}</span></div></div>
      <div class="o-f"><label>Your name</label><input id="cName" placeholder="Name"/></div>
      <div class="o-f"><label>Phone *</label><input id="cPhone" inputmode="tel" placeholder="Phone number"/></div>
      ${type === "delivery" ? `<div class="o-f"><label>Delivery address *</label><textarea id="cAddr" rows="2" placeholder="Street, area, landmarks"></textarea></div>` : ""}
      <div class="o-f"><label>Note (optional)</label><textarea id="cNote" rows="2" placeholder="Allergies, instructions…"></textarea></div>
      <button class="o-big" id="placeBtn">Place ${type === "delivery" ? "delivery" : "pickup"} order</button>
      <button class="o-big" id="moreBtn" style="background:var(--neutral-bg);color:var(--text);margin-top:8px;">Add more items</button>`);
    sheet.querySelectorAll("[data-inc]").forEach((b) => b.onclick = () => { cart[+b.dataset.inc].qty++; recalc(+b.dataset.inc); refresh(); });
    sheet.querySelectorAll("[data-dec]").forEach((b) => b.onclick = () => { const i = +b.dataset.dec; cart[i].qty--; if (cart[i].qty <= 0) cart.splice(i, 1); else recalc(i); refresh(); });
    sheet.querySelector("#moreBtn").onclick = closeSheet;
    sheet.querySelector("#placeBtn").onclick = () => placeOrder(sheet);
  }
  function cartLine(c, i) {
    const mods = c.modifiers.map((m) => m.option).join(", ");
    return `<div class="o-line"><div><div style="font-weight:600;">${esc(c.name)}</div>${mods ? `<div style="font-size:12px;color:var(--muted);">${esc(mods)}</div>` : ""}
      <span class="o-step" style="margin-top:6px;"><button data-dec="${i}">−</button><span style="min-width:22px;text-align:center;">${c.qty}</span><button data-inc="${i}">＋</button></span></div>
      <div style="font-weight:700;white-space:nowrap;">${money(c.lineTotal)}</div></div>`;
  }
  function recalc(i) { const c = cart[i]; const md = c.modifiers.reduce((s, m) => s + (m.priceDelta || 0), 0); c.lineTotal = +((c.basePrice + md) * c.qty).toFixed(2); }
  function refresh() { syncBar(); if (!cart.length) return closeSheet(); closeSheet(); openCart(); }

  let _sending = false;
  async function placeOrder(sheet) {
    if (_sending || !cart.length) return;
    const name = sheet.querySelector("#cName").value.trim();
    const phone = sheet.querySelector("#cPhone").value.trim();
    const addr = type === "delivery" ? (sheet.querySelector("#cAddr").value.trim()) : "";
    const note = sheet.querySelector("#cNote").value.trim();
    if (!phone) return toast("Please enter your phone number");
    if (type === "delivery" && !addr) return toast("Please enter your delivery address");
    _sending = true;
    const btn = sheet.querySelector("#placeBtn"); btn.disabled = true; btn.textContent = "Placing…";
    try {
      const res = await fetch(`${API}/orders/online`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, orderType: type, customerName: name, customerPhone: phone, customerAddress: addr, note, items: cart.map((c) => ({ menuItemId: c.menuItemId, qty: c.qty, modifiers: c.modifiers })) }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) { toast(r.error || "Could not place the order"); btn.disabled = false; btn.textContent = "Place order"; _sending = false; return; }
      cart = []; syncBar(); closeSheet(); showConfirm(r);
    } finally { _sending = false; }
  }

  function showConfirm(r) {
    $("root").innerHTML = `<div class="o-center"><div style="font-size:52px;margin-bottom:10px;">✅</div>
      <div style="font-weight:800;font-size:20px;margin-bottom:6px;">Order placed!</div>
      <div style="color:var(--muted);font-size:14px;margin-bottom:4px;">${esc(r.displayNum || "")} · ${type === "delivery" ? "Delivery" : "Pickup"}</div>
      <div style="color:var(--muted);font-size:14px;margin-bottom:22px;">We'll confirm your order shortly.</div>
      <button class="o-big" id="againBtn" style="max-width:280px;">Order again</button></div>`;
    $("againBtn").onclick = () => render();
  }

  function sheetEl(inner) {
    let s = document.querySelector(".o-sheet");
    if (!s) { s = document.createElement("div"); s.className = "o-sheet"; document.body.appendChild(s); s.onclick = (e) => { if (e.target === s) closeSheet(); }; }
    s.innerHTML = `<div class="panel">${inner}</div>`; s.style.display = "flex"; return s;
  }
  function closeSheet() { const s = document.querySelector(".o-sheet"); if (s) s.style.display = "none"; }

  boot();
})();
