(async () => {
// admin.js — beautiful popup UI, fully working modifiers + recipe
const staff = requireLogin();
let selectedBranchId = null;

if (staff) {
  renderNav("menuadmin", staff);
  if (!isManagerRole(staff)) {
    document.body.innerHTML = "<div style='padding:60px;text-align:center;color:var(--muted);font-size:15px;'>Manager access required.</div>";
    return;
  }
}

// ── Global data ────────────────────────────────────────────────
let ITEMS = [], INGREDIENTS = [], STATIONS = [], CATEGORIES = [];

// ── Helpers ────────────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

function cur() {
  return (window.posSettings && window.posSettings.currencySymbol) || "Rs.";
}
function fmt(n) { return cur() + " " + Number(n).toFixed(2); }

function stationById(id) { return STATIONS.find(s => s.id === Number(id)); }
function catOpts(sel) {
  return `<option value="">-- Category --</option>` +
    CATEGORIES.map(c => `<option value="${c.name}" ${sel===c.name?"selected":""}>${c.name}</option>`).join("");
}
function stOpts(sel) {
  return `<option value="">No station</option>` +
    STATIONS.map(s => `<option value="${s.id}" ${Number(sel)===s.id?"selected":""}>${s.name}</option>`).join("");
}
function ingOpts() {
  return INGREDIENTS.map(i => `<option value="${i.id}">${i.name} (${i.unit||""})</option>`).join("");
}
function esc(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Popup engine ───────────────────────────────────────────────
function popup(html) {
  // Always attach to document.body so position:fixed works correctly
  // and the overlay is never clipped by page-body's stacking context
  let wrap = document.getElementById("_admPopupRoot");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "_admPopupRoot";
    document.body.appendChild(wrap);
  }
  wrap.innerHTML = `<div class="adm-backdrop" id="_bd">${html}</div>`;
  const close = () => { wrap.innerHTML = ""; };
  wrap.querySelector("#_bd").onclick = e => { if (e.target.id === "_bd") close(); };
  wrap.querySelectorAll("[data-close]").forEach(b => b.onclick = close);
  return { close, el: wrap };
}

// ── Tab switching ──────────────────────────────────────────────
document.querySelectorAll("#adminTabs .tab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#adminTabs .tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tabItems").style.display      = btn.dataset.tab === "items"      ? "" : "none";
    document.getElementById("tabCategories").style.display = btn.dataset.tab === "categories" ? "" : "none";
    document.getElementById("tabStations").style.display   = btn.dataset.tab === "stations"   ? "" : "none";
  };
});

// ── Branch picker ──────────────────────────────────────────────
async function setupBranchPicker() {
  const row = document.getElementById("branchPickerRow");
  const sel = document.getElementById("menuBranchSelect");
  row.style.display = "flex";
  const branches = await (await api("/api/branches")).json();
  sel.innerHTML = branches.map(b => `<option value="${b.id}">${b.name}</option>`).join("");
  const stored = localStorage.getItem("posActiveBranchId");
  selectedBranchId = stored && branches.some(b => String(b.id) === stored)
    ? Number(stored) : (branches[0] ? branches[0].id : null);
  sel.value = selectedBranchId;
  if (selectedBranchId) localStorage.setItem("posActiveBranchId", String(selectedBranchId));
  sel.onchange = () => {
    selectedBranchId = Number(sel.value);
    localStorage.setItem("posActiveBranchId", String(selectedBranchId));
    loadAll();
  };
}

// ── Load all ───────────────────────────────────────────────────
async function loadAll() {
  const [mR, iR, sR, cR] = await Promise.all([
    api("/api/menu"), api("/api/ingredients"), api("/api/stations"), api("/api/categories")
  ]);
  const _items = await mR.json();
  const _ings  = await iR.json();
  const _sts   = await sR.json();
  const _cats  = await cR.json();
  ITEMS       = Array.isArray(_items) ? _items : [];
  INGREDIENTS = Array.isArray(_ings)  ? _ings  : [];
  STATIONS    = Array.isArray(_sts)   ? _sts   : [];
  CATEGORIES  = Array.isArray(_cats)  ? _cats  : [];
  renderItems();
  renderCategories();
  renderStations();
}

// ══════════════════════════════════════════════════════════════
// ITEMS
// ══════════════════════════════════════════════════════════════
function renderItems() {
  const el = document.getElementById("menuList");
  const count = document.getElementById("itemsCount");
  count.textContent = `${ITEMS.length} Item${ITEMS.length !== 1 ? "s" : ""}`;

  if (!ITEMS.length) {
    el.innerHTML = `<div class="adm-empty" style="grid-column:1/-1;">
      <div class="adm-empty-icon">🍽️</div>
      <p>No menu items yet. Click <strong>＋ Create Item</strong> above to add your first item.</p>
    </div>`;
    return;
  }

  el.innerHTML = ITEMS.map(item => {
    const st = stationById(item.stationId);
    const modCount = (item.modifierGroups || item.modifiers || []).length;
    const recCount = (item.recipe || []).length;
    const imgStyle = item.imageUrl
      ? `background-image:url('${esc(item.imageUrl)}');`
      : "";
    const emoji = item.category === "Drinks" ? "🥤"
      : item.category === "Desserts" ? "🍰"
      : item.category === "Starters" ? "🥗"
      : "🍽️";

    return `<div class="item-card${item.soldOut ? " item-sold-out" : ""}">
      <div class="item-card-img" style="${imgStyle}">
        ${item.imageUrl ? "" : `<span>${emoji}</span>`}
        ${item.soldOut ? `<div class="item-soldout-flag">SOLD OUT</div>` : ""}
      </div>
      <div class="item-card-body">
        <div class="item-card-name">${esc(item.name)}</div>
        <div class="item-card-price">${fmt(item.price)}</div>
        <div class="item-card-tags">
          ${item.category ? `<span class="badge badge-pending">${esc(item.category)}</span>` : ""}
          ${st ? `<span class="badge" style="background:${st.color}22;color:${st.color};">● ${esc(st.name)}</span>` : ""}
          ${item.plu ? `<span class="badge badge-open mono">PLU ${esc(item.plu)}</span>` : ""}
          ${modCount ? `<span class="badge badge-ordered">${modCount} mod${modCount>1?"s":""}</span>` : ""}
          ${recCount ? `<span class="badge badge-open">${recCount} recipe ing.</span>` : ""}
        </div>
      </div>
      <div class="item-card-foot">
        <button class="btn" data-edit="${item.id}">✏️ Edit</button>
        <button class="btn ${item.soldOut ? "btn-primary" : ""}" data-sold="${item.id}"
                title="${item.soldOut ? "Put back on sale" : "Mark sold out (86)"}">
          ${item.soldOut ? "↩︎ Available" : "🚫 Sold out"}
        </button>
        <button class="btn btn-danger" data-del="${item.id}">Delete</button>
      </div>
    </div>`;
  }).join("");

  el.querySelectorAll("[data-sold]").forEach(b => {
    b.onclick = async () => {
      const item = ITEMS.find(i => i.id === Number(b.dataset.sold));
      if (!item) return;
      b.disabled = true;
      const res = await api(`/api/menu/${item.id}/sold-out`, {
        method: "PATCH", json: { soldOut: !item.soldOut },
      });
      if (!res.ok) { toast("Could not update"); b.disabled = false; return; }
      item.soldOut = !item.soldOut;
      toast(item.soldOut ? `${item.name} marked sold out` : `${item.name} back on sale`);
      renderItems();
    };
  });

  el.querySelectorAll("[data-edit]").forEach(b => {
    b.onclick = () => openEditPopup(ITEMS.find(i => i.id === Number(b.dataset.edit)));
  });
  el.querySelectorAll("[data-del]").forEach(b => {
    b.onclick = async () => {
      const item = ITEMS.find(i => i.id === Number(b.dataset.del));
      if (!confirm(`Delete "${item.name}"?`)) return;
      await api(`/api/menu/${item.id}`, { method: "DELETE" });
      toast("Deleted " + item.name);
      loadAll();
    };
  });
}

// ── Shared modifier+recipe builder ────────────────────────────
function buildModRecSection(wrap, initMods, initRecipe) {
  // Working copies so Cancel really cancels
  let mods   = JSON.parse(JSON.stringify(initMods   || []));
  let recipe = JSON.parse(JSON.stringify(initRecipe || []));
  let openGroup = null;   // index of the group currently expanded for editing

  const ingName = (id) => {
    const i = INGREDIENTS.find(x => x.id === id);
    return i ? i.name : "?";
  };
  const ingUnit = (id) => {
    const i = INGREDIENTS.find(x => x.id === id);
    return i ? (i.unit || "") : "";
  };

  // ── Base recipe ──────────────────────────────────────────────
  function renderRecipe() {
    const el = wrap.querySelector("#bld_recRows");
    if (!el) return;
    el.innerHTML = recipe.length ? recipe.map((r, ri) => `
      <div class="rec-row" style="display:flex;align-items:center;gap:8px;">
        <span style="flex:1;">${esc(ingName(r.ingredientId))}</span>
        <input type="number" step="0.001" min="0" value="${r.qty}" data-rq="${ri}"
               style="width:88px;padding:6px 9px;border-radius:8px;border:1px solid var(--border);
                      background:var(--panel);color:var(--text);font-family:inherit;font-size:12.5px;text-align:right;"/>
        <span style="font-size:11.5px;color:var(--muted);width:34px;">${esc(ingUnit(r.ingredientId))}</span>
        <button class="btn btn-danger" data-rr="${ri}" style="font-size:11px;padding:3px 9px;">×</button>
      </div>`).join("")
    : `<div style="font-size:12px;color:var(--muted);padding:4px 0;">No ingredients yet — this item won't deduct stock.</div>`;

    el.querySelectorAll("[data-rq]").forEach(i => {
      i.oninput = () => { recipe[Number(i.dataset.rq)].qty = parseFloat(i.value) || 0; };
    });
    el.querySelectorAll("[data-rr]").forEach(b => {
      b.onclick = () => { recipe.splice(Number(b.dataset.rr), 1); renderRecipe(); };
    });
  }

  // ── Modifier groups ──────────────────────────────────────────
  function optSummary(o) {
    const bits = [];
    if (o.priceDelta)    bits.push(`${o.priceDelta > 0 ? "+" : ""}${cur()}${Number(o.priceDelta).toFixed(2)}`);
    const m = Number(o.qtyMultiplier ?? 1);
    if (m !== 1)         bits.push(`×${m} recipe`);
    if ((o.recipe || []).length) bits.push(`+${o.recipe.length} extra`);
    return bits.length ? ` <span style="color:var(--muted);">(${bits.join(", ")})</span>` : "";
  }

  function renderMods() {
    const el = wrap.querySelector("#bld_modSaved");
    if (!el) return;

    el.innerHTML = mods.length ? mods.map((g, gi) => {
      if (gi !== openGroup) {
        // Collapsed summary row
        return `
          <div class="mod-saved-item">
            <div style="flex:1;min-width:0;">
              <div class="mod-saved-name">${esc(g.name)}${(g.max > 1 || g.required) ? ` <span style="font-size:10px;font-weight:600;color:var(--accent);">(${g.required ? "required" : "optional"}${g.max > 1 ? `, pick ${g.min || 0}–${g.max}` : ""})</span>` : ""}</div>
              <div class="mod-saved-opts">${(g.options || []).map(o => esc(o.name) + optSummary(o)).join(" · ")}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn" data-edit="${gi}" style="font-size:11px;padding:3px 9px;">Edit</button>
              <button class="btn btn-danger" data-rmod="${gi}" style="font-size:11px;padding:3px 9px;">×</button>
            </div>
          </div>`;
      }

      // Expanded editor for this group
      return `
        <div class="mod-saved-item" style="display:block;border-color:var(--accent);">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
            <input value="${esc(g.name)}" data-gname="${gi}" placeholder="Group name (Size, Spice, Add-ons…)"
                   style="flex:1;padding:8px 11px;border-radius:9px;border:1px solid var(--border);
                          background:var(--panel);color:var(--text);font-family:inherit;font-size:13px;font-weight:600;"/>
            <button class="btn btn-primary" data-done="${gi}" style="font-size:11.5px;padding:6px 12px;">✔ Done</button>
          </div>

          <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding:8px 10px;background:var(--neutral-bg);border-radius:9px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;cursor:pointer;">
              <input type="checkbox" data-greq="${gi}" ${g.required ? "checked" : ""}/> Required
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);">Min
              <input type="number" min="0" value="${g.min ?? 0}" data-gmin="${gi}" style="width:52px;padding:5px 7px;border-radius:7px;border:1px solid var(--border);background:var(--panel);color:var(--text);font-size:12px;text-align:center;"/>
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);">Max
              <input type="number" min="1" value="${g.max ?? 1}" data-gmax="${gi}" style="width:52px;padding:5px 7px;border-radius:7px;border:1px solid var(--border);background:var(--panel);color:var(--text);font-size:12px;text-align:center;"/>
            </label>
            <span style="font-size:11px;color:var(--muted);">Max&nbsp;&gt;&nbsp;1 = guests can pick several</span>
          </div>

          <div style="display:grid;grid-template-columns:1fr 82px 74px auto;gap:6px;
                      font-size:10.5px;color:var(--muted);font-weight:700;
                      text-transform:uppercase;letter-spacing:.4px;padding:0 2px 4px;">
            <span>Option</span><span>Price +/−</span><span>× Recipe</span><span></span>
          </div>

          ${(g.options || []).map((o, oi) => `
            <div style="margin-bottom:7px;">
              <div style="display:grid;grid-template-columns:1fr 82px 74px auto;gap:6px;align-items:center;">
                <input value="${esc(o.name)}" data-on="${gi}.${oi}" placeholder="Option name"
                       style="padding:7px 10px;border-radius:8px;border:1px solid var(--border);
                              background:var(--panel);color:var(--text);font-family:inherit;font-size:12.5px;"/>
                <input type="number" step="0.01" value="${o.priceDelta || ""}" data-op="${gi}.${oi}" placeholder="0"
                       style="padding:7px 8px;border-radius:8px;border:1px solid var(--border);
                              background:var(--panel);color:var(--text);font-family:inherit;font-size:12.5px;text-align:right;"/>
                <input type="number" step="0.05" min="0" value="${o.qtyMultiplier ?? 1}" data-om="${gi}.${oi}"
                       title="Scales the whole base recipe. 1 = normal, 1.5 = Large, 0.75 = Small"
                       style="padding:7px 8px;border-radius:8px;border:1px solid var(--border);
                              background:var(--panel);color:var(--text);font-family:inherit;font-size:12.5px;text-align:right;"/>
                <button class="btn btn-danger" data-rod="${gi}.${oi}" style="font-size:11px;padding:5px 8px;">×</button>
              </div>

              <div style="padding:5px 0 0 4px;">
                ${(o.recipe || []).map((r, ri) => `
                  <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;padding:2px 0;">
                    <span style="color:var(--muted);">↳ extra</span>
                    <span style="flex:1;">${esc(ingName(r.ingredientId))}</span>
                    <input type="number" step="0.001" min="0" value="${r.qty}" data-oq="${gi}.${oi}.${ri}"
                           style="width:74px;padding:4px 7px;border-radius:7px;border:1px solid var(--border);
                                  background:var(--panel);color:var(--text);font-family:inherit;font-size:11.5px;text-align:right;"/>
                    <span style="color:var(--muted);width:30px;">${esc(ingUnit(r.ingredientId))}</span>
                    <button class="btn btn-danger" data-ror="${gi}.${oi}.${ri}" style="font-size:10px;padding:2px 7px;">×</button>
                  </div>`).join("")}
                ${INGREDIENTS.length ? `
                  <div style="display:flex;gap:5px;align-items:center;margin-top:4px;">
                    <select data-oi-sel="${gi}.${oi}"
                            style="flex:1;max-width:180px;padding:5px 8px;border-radius:7px;border:1px solid var(--border);
                                   background:var(--neutral-bg);color:var(--text);font-family:inherit;font-size:11.5px;">${ingOpts()}</select>
                    <input type="number" step="0.001" min="0" placeholder="Qty" data-oi-qty="${gi}.${oi}"
                           style="width:70px;padding:5px 8px;border-radius:7px;border:1px solid var(--border);
                                  background:var(--neutral-bg);color:var(--text);font-family:inherit;font-size:11.5px;text-align:right;"/>
                    <button class="btn" data-oi-add="${gi}.${oi}" style="font-size:10.5px;padding:4px 9px;">＋ extra</button>
                  </div>` : ""}
              </div>
            </div>`).join("")}

          <button class="btn" data-addopt="${gi}" style="font-size:11.5px;padding:6px 12px;margin-top:4px;">＋ Add Option</button>
          <div style="font-size:10.5px;color:var(--muted);margin-top:9px;line-height:1.55;">
            <strong>× Recipe</strong> scales the base recipe — use it for sizes (Large 1.5, Small 0.75).<br>
            <strong>+ extra</strong> adds a fixed amount on top — use it for add-ons (Extra Chicken 0.05 kg).
          </div>
        </div>`;
    }).join("")
    : `<div style="font-size:12px;color:var(--muted);padding:4px 0;">No modifier groups yet.</div>`;

    // ── wiring ──
    const idx = (v) => v.split(".").map(Number);

    el.querySelectorAll("[data-edit]").forEach(b => {
      b.onclick = () => { openGroup = Number(b.dataset.edit); renderMods(); };
    });
    el.querySelectorAll("[data-done]").forEach(b => {
      b.onclick = () => {
        const g = mods[Number(b.dataset.done)];
        g.options = (g.options || []).filter(o => (o.name || "").trim());
        openGroup = null;
        renderMods();
      };
    });
    el.querySelectorAll("[data-rmod]").forEach(b => {
      b.onclick = () => {
        mods.splice(Number(b.dataset.rmod), 1);
        openGroup = null;
        renderMods();
      };
    });
    el.querySelectorAll("[data-gname]").forEach(i => {
      i.oninput = () => { mods[Number(i.dataset.gname)].name = i.value; };
    });
    el.querySelectorAll("[data-greq]").forEach(i => {
      i.onchange = () => { mods[Number(i.dataset.greq)].required = i.checked; };
    });
    el.querySelectorAll("[data-gmin]").forEach(i => {
      i.oninput = () => { mods[Number(i.dataset.gmin)].min = Math.max(0, parseInt(i.value, 10) || 0); };
    });
    el.querySelectorAll("[data-gmax]").forEach(i => {
      i.oninput = () => { mods[Number(i.dataset.gmax)].max = Math.max(1, parseInt(i.value, 10) || 1); };
    });
    el.querySelectorAll("[data-on]").forEach(i => {
      i.oninput = () => { const [g, o] = idx(i.dataset.on); mods[g].options[o].name = i.value; };
    });
    el.querySelectorAll("[data-op]").forEach(i => {
      i.oninput = () => { const [g, o] = idx(i.dataset.op); mods[g].options[o].priceDelta = parseFloat(i.value) || 0; };
    });
    el.querySelectorAll("[data-om]").forEach(i => {
      i.oninput = () => {
        const [g, o] = idx(i.dataset.om);
        const v = parseFloat(i.value);
        mods[g].options[o].qtyMultiplier = (isNaN(v) || v < 0) ? 1 : v;
      };
    });
    el.querySelectorAll("[data-oq]").forEach(i => {
      i.oninput = () => { const [g, o, r] = idx(i.dataset.oq); mods[g].options[o].recipe[r].qty = parseFloat(i.value) || 0; };
    });
    el.querySelectorAll("[data-rod]").forEach(b => {
      b.onclick = () => { const [g, o] = idx(b.dataset.rod); mods[g].options.splice(o, 1); renderMods(); };
    });
    el.querySelectorAll("[data-ror]").forEach(b => {
      b.onclick = () => { const [g, o, r] = idx(b.dataset.ror); mods[g].options[o].recipe.splice(r, 1); renderMods(); };
    });
    el.querySelectorAll("[data-addopt]").forEach(b => {
      b.onclick = () => {
        const g = Number(b.dataset.addopt);
        mods[g].options = mods[g].options || [];
        mods[g].options.push({ name: "", priceDelta: 0, qtyMultiplier: 1, recipe: [] });
        renderMods();
      };
    });
    el.querySelectorAll("[data-oi-add]").forEach(b => {
      b.onclick = () => {
        const [g, o] = idx(b.dataset.oiAdd);
        const sel = el.querySelector(`[data-oi-sel="${g}.${o}"]`);
        const qi  = el.querySelector(`[data-oi-qty="${g}.${o}"]`);
        const id  = sel ? Number(sel.value) : 0;
        const q   = qi ? parseFloat(qi.value) : 0;
        if (!id || !q) return toast("Pick an ingredient and enter a quantity");
        const opt = mods[g].options[o];
        opt.recipe = opt.recipe || [];
        if (opt.recipe.find(r => r.ingredientId === id)) return toast("Already added to this option");
        opt.recipe.push({ ingredientId: id, qty: q });
        renderMods();
      };
    });
  }

  // ── New group ────────────────────────────────────────────────
  const newGroupBtn = wrap.querySelector("#bld_newGroup");
  if (newGroupBtn) newGroupBtn.onclick = () => {
    mods.push({
      id: "g" + Math.random().toString(36).slice(2, 8),
      name: "", required: false, min: 0, max: 1,
      options: [{ name: "", priceDelta: 0, qtyMultiplier: 1, recipe: [] }],
    });
    openGroup = mods.length - 1;
    renderMods();
    const f = wrap.querySelector(`[data-gname="${openGroup}"]`);
    if (f) f.focus();
  };

  // ── Base recipe add ──────────────────────────────────────────
  const addRecBtn = wrap.querySelector("#bld_addRec");
  if (addRecBtn) addRecBtn.onclick = () => {
    const ingEl = wrap.querySelector("#bld_recIng");
    const qtyEl = wrap.querySelector("#bld_recQty");
    const ingId = ingEl ? Number(ingEl.value) : 0;
    const qty   = qtyEl ? parseFloat(qtyEl.value) : 0;
    if (!ingId || !qty) return toast("Select an ingredient and enter a quantity");
    if (recipe.find(r => r.ingredientId === ingId)) return toast("Already in the recipe");
    recipe.push({ ingredientId: ingId, qty });
    if (qtyEl) qtyEl.value = "";
    renderRecipe();
  };

  renderMods();
  renderRecipe();

  return {
    // Strip empty rows on the way out so nothing half-typed gets saved
    getMods: () => mods
      .filter(g => (g.name || "").trim() && (g.options || []).some(o => (o.name || "").trim()))
      .map(g => ({
        id: g.id || ("g" + Math.random().toString(36).slice(2, 8)),
        name: g.name.trim(),
        required: !!g.required,
        min: Math.max(0, parseInt(g.min, 10) || 0),
        max: Math.max(1, parseInt(g.max, 10) || 1),
        options: g.options
          .filter(o => (o.name || "").trim())
          .map(o => ({
            name: o.name.trim(),
            priceDelta: Number(o.priceDelta) || 0,
            qtyMultiplier: Number(o.qtyMultiplier ?? 1),
            recipe: (o.recipe || []).filter(r => r.ingredientId && r.qty > 0),
          })),
      })),
    getRecipe: () => recipe.filter(r => r.ingredientId && r.qty > 0),
  };
}

// ── Item popup HTML template ───────────────────────────────────
function itemPopupBody(item) {
  const v = item || {};
  return `
  <div class="f-row">
    <div class="f" style="flex:2;">
      <label>Item Name *</label>
      <input id="f_name" value="${esc(v.name||"")}" placeholder="e.g. Grilled Chicken"/>
    </div>
    <div class="f" style="flex:0 0 110px;">
      <label>Price *</label>
      <input id="f_price" type="number" step="0.01" min="0" value="${v.price||""}" placeholder="0.00"/>
    </div>
  </div>
  <div class="f-row">
    <div class="f">
      <label>Category *</label>
      <select id="f_cat">${catOpts(v.category||"")}</select>
    </div>
    <div class="f">
      <label>Station</label>
      <select id="f_station">${stOpts(v.stationId)}</select>
    </div>
  </div>
  <div class="f-row">
    <div class="f">
      <label>PLU Code</label>
      <input id="f_plu" value="${esc(v.plu||"")}" placeholder="e.g. 101"/>
    </div>
    <div class="f">
      <label>Image URL</label>
      <input id="f_image" value="${esc(v.imageUrl||"")}" placeholder="https://..."/>
    </div>
  </div>

  <div style="border-top:1px solid var(--border-soft);margin:18px 0 16px;"></div>
  <div style="font-size:14px;font-weight:700;margin-bottom:4px;">📦 Base Recipe</div>
  <div style="font-size:11.5px;color:var(--muted);margin-bottom:11px;">
    What ONE standard portion uses. Stock is deducted when the kitchen marks the item ready.
  </div>
  <div id="bld_recRows" style="margin-bottom:10px;"></div>
  ${INGREDIENTS.length ? `
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
    <select id="bld_recIng" style="flex:1;min-width:150px;padding:8px 11px;border-radius:9px;border:1px solid var(--border);background:var(--neutral-bg);color:var(--text);font-family:inherit;font-size:13px;">${ingOpts()}</select>
    <input id="bld_recQty" type="number" step="0.001" min="0" placeholder="Qty" style="width:88px;padding:8px 11px;border-radius:9px;border:1px solid var(--border);background:var(--neutral-bg);color:var(--text);font-family:inherit;font-size:13px;"/>
    <button class="btn" id="bld_addRec" style="font-size:12px;padding:8px 14px;">＋ Add</button>
  </div>` : `<div style="font-size:12px;color:var(--muted);">No ingredients in inventory yet — add them on the Inventory page first.</div>`}

  <div style="border-top:1px solid var(--border-soft);margin:20px 0 16px;"></div>
  <div style="font-size:14px;font-weight:700;margin-bottom:4px;">🎛 Modifier Groups</div>
  <div style="font-size:11.5px;color:var(--muted);margin-bottom:11px;">
    Each option can change the price, scale the whole recipe (for sizes), and add extra ingredients.
  </div>
  <div class="mod-zone">
    <div class="mod-saved" id="bld_modSaved"></div>
    <button class="btn" id="bld_newGroup" style="font-size:12px;padding:7px 13px;margin-top:8px;">＋ Add Modifier Group</button>
  </div>
  `;
}

// ── Add Item popup ─────────────────────────────────────────────
document.getElementById("openAddItemBtn").onclick = () => {
  const { close, el } = popup(`
  <div class="adm-modal">
    <div class="adm-mhead">
      <h3>🍽️ Create Menu Item</h3>
      <button class="adm-x" data-close>×</button>
    </div>
    <div class="adm-mbody">${itemPopupBody(null)}</div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="f_save" style="padding:10px 24px;">＋ Add Item</button>
    </div>
  </div>`);

  const builder = buildModRecSection(el, [], []);
  el.querySelector("#f_name").focus();

  el.querySelector("#f_save").onclick = async () => {
    const name      = el.querySelector("#f_name").value.trim();
    const price     = parseFloat(el.querySelector("#f_price").value);
    const category  = el.querySelector("#f_cat").value;
    const stationId = el.querySelector("#f_station").value || null;
    const plu       = el.querySelector("#f_plu").value.trim();
    const imageUrl  = el.querySelector("#f_image").value.trim();

    if (!name)        return toast("⚠ Enter item name");
    if (isNaN(price)) return toast("⚠ Enter a valid price");
    if (!category)    return toast("⚠ Select a category");

    const btn = el.querySelector("#f_save");
    btn.disabled = true; btn.textContent = "Saving…";

    try {
      // 1. Create item
      const res  = await api("/api/menu", { method: "POST", json: { name, price, category, stationId, plu, imageUrl } });
      const created = await res.json();
      if (!created.id) throw new Error("No item ID returned");

      // 2. Save modifier groups
      for (const g of builder.getMods()) {
        await api(`/api/menu/${created.id}/modifiers`, { method: "POST", json: { name: g.name, options: g.options, required: g.required, min: g.min, max: g.max } });
      }

      // 3. Save recipe
      const recipe = builder.getRecipe();
      if (recipe.length) {
        await api(`/api/menu/${created.id}/recipe`, { method: "PUT", json: recipe });
      }

      toast(`✅ "${name}" added`);
      close();
      loadAll();
    } catch(e) {
      console.error(e);
      toast("❌ Error saving — check console");
      btn.disabled = false; btn.textContent = "＋ Add Item";
    }
  };
};

// ── Edit Item popup ────────────────────────────────────────────
function openEditPopup(item) {
  const existingMods = item.modifiers || item.modifierGroups || [];

  const { close, el } = popup(`
  <div class="adm-modal">
    <div class="adm-mhead">
      <h3>✏️ Edit: ${esc(item.name)}</h3>
      <button class="adm-x" data-close>×</button>
    </div>
    <div class="adm-mbody">${itemPopupBody(item)}</div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="f_save" style="padding:10px 24px;">Save Changes</button>
    </div>
  </div>`);

  const builder = buildModRecSection(el, existingMods, item.recipe || []);

  el.querySelector("#f_save").onclick = async () => {
    const name      = el.querySelector("#f_name").value.trim();
    const price     = parseFloat(el.querySelector("#f_price").value);
    const category  = el.querySelector("#f_cat").value;
    const stationId = el.querySelector("#f_station").value || null;
    const plu       = el.querySelector("#f_plu").value.trim();
    const imageUrl  = el.querySelector("#f_image").value.trim();

    if (!name)        return toast("⚠ Enter item name");
    if (isNaN(price)) return toast("⚠ Enter a valid price");

    const btn = el.querySelector("#f_save");
    btn.disabled = true; btn.textContent = "Saving…";

    try {
      // 1. Update base fields
      await api(`/api/menu/${item.id}`, { method: "PUT", json: { name, price, category, stationId, plu, imageUrl } });

      // 2. Replace all modifier groups: delete old, create new
      // Delete ALL existing modifiers, then re-add from builder
      await api(`/api/menu/${item.id}/modifiers/all`, { method: "DELETE" });
      for (const g of builder.getMods()) {
        await api(`/api/menu/${item.id}/modifiers`, { method: "POST", json: { name: g.name, options: g.options, required: g.required, min: g.min, max: g.max } });
      }

      // 3. Save recipe
      await api(`/api/menu/${item.id}/recipe`, { method: "PUT", json: builder.getRecipe() });

      toast(`✅ "${name}" saved`);
      close();
      loadAll();
    } catch(e) {
      console.error(e);
      toast("❌ Error saving — check console");
      btn.disabled = false; btn.textContent = "Save Changes";
    }
  };
}

// ══════════════════════════════════════════════════════════════
// CATEGORIES
// ══════════════════════════════════════════════════════════════
function renderCategories() {
  const el    = document.getElementById("categoryList");
  const count = document.getElementById("catsCount");
  count.textContent = `${CATEGORIES.length} Categor${CATEGORIES.length !== 1 ? "ies" : "y"}`;

  if (!CATEGORIES.length) {
    el.innerHTML = `<div class="adm-empty" style="grid-column:1/-1;">
      <div class="adm-empty-icon">📋</div>
      <p>No categories yet.</p>
    </div>`;
    return;
  }

  const catEmojis = { starters:"🥗", mains:"🍽️", desserts:"🍰", drinks:"🥤",
    sides:"🍟", breakfast:"🍳", lunch:"🥙", dinner:"🍜", snacks:"🍿" };

  el.innerHTML = CATEGORIES.map(c => {
    const emoji = catEmojis[c.name.toLowerCase()] || "🏷️";
    const itemCount = ITEMS.filter(i => i.category === c.name).length;
    return `<div class="cat-card">
      <div class="cat-icon">${emoji}</div>
      <div class="cat-info">
        <div class="cat-name">${esc(c.name)}</div>
        <div class="cat-count">${itemCount} item${itemCount!==1?"s":""}</div>
      </div>
      <div class="cat-actions">
        <button class="btn" data-recat="${c.id}" style="font-size:12px;padding:5px 9px;">✏️</button>
        <button class="btn btn-danger" data-delcat="${c.id}" style="font-size:12px;padding:5px 9px;">×</button>
      </div>
    </div>`;
  }).join("");

  el.querySelectorAll("[data-recat]").forEach(b => {
    b.onclick = () => openRenameCat(CATEGORIES.find(c => c.id === Number(b.dataset.recat)));
  });
  el.querySelectorAll("[data-delcat]").forEach(b => {
    b.onclick = async () => {
      const c = CATEGORIES.find(c => c.id === Number(b.dataset.delcat));
      if (!confirm(`Delete category "${c.name}"?`)) return;
      await api(`/api/categories/${c.id}`, { method: "DELETE" });
      toast(`Deleted "${c.name}"`);
      loadAll();
    };
  });
}

document.getElementById("openAddCatBtn").onclick = () => {
  const { close, el } = popup(`
  <div class="adm-modal sm">
    <div class="adm-mhead"><h3>📋 Add Category</h3><button class="adm-x" data-close>×</button></div>
    <div class="adm-mbody">
      <div class="f"><label>Category Name *</label>
        <input id="nc_name" placeholder="e.g. Starters, Mains, Drinks, Desserts"/>
      </div>
    </div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="nc_save">＋ Add Category</button>
    </div>
  </div>`);
  const inp = el.querySelector("#nc_name");
  inp.focus();
  inp.onkeydown = e => { if (e.key === "Enter") el.querySelector("#nc_save").click(); };
  el.querySelector("#nc_save").onclick = async () => {
    const name = inp.value.trim();
    if (!name) return toast("Enter a category name");
    await api("/api/categories", { method: "POST", json: { name } });
    toast(`"${name}" added`);
    close(); loadAll();
  };
};

function openRenameCat(cat) {
  const { close, el } = popup(`
  <div class="adm-modal sm">
    <div class="adm-mhead"><h3>✏️ Rename Category</h3><button class="adm-x" data-close>×</button></div>
    <div class="adm-mbody">
      <div class="f"><label>Category Name</label>
        <input id="rc_name" value="${esc(cat.name)}"/>
      </div>
    </div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="rc_save">Save</button>
    </div>
  </div>`);
  const inp = el.querySelector("#rc_name");
  inp.select();
  el.querySelector("#rc_save").onclick = async () => {
    const name = inp.value.trim();
    if (!name) return toast("Enter a name");
    await api(`/api/categories/${cat.id}`, { method: "PUT", json: { name } });
    toast(`Renamed to "${name}"`);
    close(); loadAll();
  };
}

// ══════════════════════════════════════════════════════════════
// STATIONS
// ══════════════════════════════════════════════════════════════
function renderStations() {
  const el    = document.getElementById("stationList");
  const count = document.getElementById("stationsCount");
  count.textContent = `${STATIONS.length} Station${STATIONS.length !== 1 ? "s" : ""}`;

  if (!STATIONS.length) {
    el.innerHTML = `<div class="adm-empty" style="grid-column:1/-1;">
      <div class="adm-empty-icon">🔥</div>
      <p>No stations yet.</p>
    </div>`;
    return;
  }

  el.innerHTML = STATIONS.map(s => {
    const count = ITEMS.filter(i => i.stationId === s.id).length;
    return `<div class="st-card">
      <div class="st-card-top">
        <div class="st-dot" style="background:${s.color};box-shadow:0 0 8px ${s.color}88;"></div>
        <div class="st-name">${esc(s.name)}</div>
      </div>
      <div class="st-count">${count} item${count!==1?"s":""} assigned</div>
      <div class="st-card-foot">
        <button class="btn" data-stdet="${s.id}" style="font-size:12px;">📋 Details</button>
        <button class="btn btn-danger" data-stdel="${s.id}" style="font-size:12px;">Delete</button>
      </div>
    </div>`;
  }).join("");

  el.querySelectorAll("[data-stdet]").forEach(b => {
    b.onclick = () => openStationDetail(STATIONS.find(s => s.id === Number(b.dataset.stdet)));
  });
  el.querySelectorAll("[data-stdel]").forEach(b => {
    b.onclick = async () => {
      const s = STATIONS.find(s => s.id === Number(b.dataset.stdel));
      if (!confirm(`Delete station "${s.name}"? Items will become unassigned.`)) return;
      await api(`/api/stations/${s.id}`, { method: "DELETE" });
      toast(`Deleted "${s.name}"`);
      loadAll();
    };
  });
}

document.getElementById("openAddStationBtn").onclick = () => {
  const { close, el } = popup(`
  <div class="adm-modal sm">
    <div class="adm-mhead"><h3>🔥 Add Station</h3><button class="adm-x" data-close>×</button></div>
    <div class="adm-mbody">
      <div class="f"><label>Station Name *</label>
        <input id="ns_name" placeholder="e.g. Grill, Bar, Cold Prep"/>
      </div>
      <div class="f">
        <label>Colour</label>
        <div style="display:flex;align-items:center;gap:10px;">
          <input id="ns_color" type="color" value="#e67e22" style="width:52px;height:42px;padding:3px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:none;"/>
          <span style="font-size:12px;color:var(--muted);">Shown on kitchen tickets and badges</span>
        </div>
      </div>
    </div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="ns_save">＋ Add Station</button>
    </div>
  </div>`);
  const inp = el.querySelector("#ns_name");
  inp.focus();
  inp.onkeydown = e => { if (e.key === "Enter") el.querySelector("#ns_save").click(); };
  el.querySelector("#ns_save").onclick = async () => {
    const name  = inp.value.trim();
    const color = el.querySelector("#ns_color").value;
    if (!name) return toast("Enter a station name");
    await api("/api/stations", { method: "POST", json: { name, color } });
    toast(`"${name}" added`);
    close(); loadAll();
  };
};

function openStationDetail(station) {
  const items = ITEMS.filter(i => i.stationId === station.id);
  popup(`
  <div class="adm-modal sm" style="width:500px;">
    <div class="adm-mhead">
      <h3>
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${station.color};margin-right:6px;box-shadow:0 0 6px ${station.color};"></span>
        ${esc(station.name)}
      </h3>
      <button class="adm-x" data-close>×</button>
    </div>
    <div class="adm-mbody">
      <div style="font-size:13px;color:var(--muted);margin-bottom:16px;">${items.length} item${items.length!==1?"s":""} assigned to this station</div>
      ${items.length ? items.map(i => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-soft);">
          <div style="flex:1;">
            <div style="font-weight:700;font-size:14px;">${esc(i.name)}</div>
            <div style="font-size:12px;color:var(--muted);">${esc(i.category||"—")}</div>
          </div>
          <div class="mono" style="font-size:14px;font-weight:700;color:var(--accent);">${fmt(i.price)}</div>
        </div>`).join("")
      : `<div class="adm-empty"><div class="adm-empty-icon">📭</div><p>No items assigned yet.</p></div>`}
    </div>
    <div class="adm-mfoot">
      <button class="btn btn-primary" data-close>Close</button>
    </div>
  </div>`);
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
async function init() {
  if (!staff || !isManagerRole(staff)) return;
  if (staff.role === "superManager") await setupBranchPicker();
  await loadAll();
}
init();

})();
