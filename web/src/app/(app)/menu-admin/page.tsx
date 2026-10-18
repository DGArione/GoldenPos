"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Pencil, Trash2, EyeOff, Eye, Tag, X, Search, Image as ImageIcon,
  UtensilsCrossed, FolderCog, Flame,
} from "lucide-react";
import { apiGet, apiPost, apiPut, apiDelete, apiPatch } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { resizeImageFile } from "@/lib/image";
import { MenuItem, Category, Station, ModifierGroup } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface Ingredient { id: number; name: string; unit: string }
interface RecipeLine { ingredientId: number; qty: number }

type Tab = "items" | "categories" | "stations";

export default function MenuAdminPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";

  const [tab, setTab] = useState<Tab>("items");
  const [items, setItems]       = useState<MenuItem[]>([]);
  const [cats, setCats]         = useState<Category[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string>("");
  const [q, setQ] = useState("");

  const [editItem, setEditItem] = useState<MenuItem | "new" | null>(null);
  const [editCat, setEditCat]   = useState<Category | "new" | null>(null);
  const [editStn, setEditStn]   = useState<Station | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, c, s, ing] = await Promise.all([
        apiGet<MenuItem[]>("/menu"),
        apiGet<Category[]>("/categories"),
        apiGet<Station[]>("/stations"),
        apiGet<Ingredient[]>("/inventory").catch(() => []),
      ]);
      setItems(Array.isArray(m) ? m : []);
      setCats(Array.isArray(c) ? c : []);
      setStations(Array.isArray(s) ? s : []);
      setIngredients(Array.isArray(ing) ? ing : []);
      setActiveCat((prev) => prev || (c[0]?.name ?? ""));
    } catch { toast.push("bad", "Could not load menu"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const shownItems = useMemo(() => {
    if (q.trim()) { const s = q.toLowerCase(); return items.filter((i) => i.name.toLowerCase().includes(s)); }
    return items.filter((i) => i.category === activeCat);
  }, [items, activeCat, q]);

  async function toggleSoldOut(it: MenuItem) {
    try {
      const u = await apiPatch<MenuItem>(`/menu/${it.id}/sold-out`, { soldOut: !it.soldOut });
      setItems((p) => p.map((x) => (x.id === u.id ? u : x)));
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function removeItem(it: MenuItem) {
    if (!confirm(`Delete "${it.name}"?`)) return;
    try { await apiDelete(`/menu/${it.id}`); setItems((p) => p.filter((x) => x.id !== it.id)); toast.push("ok", "Deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }
  async function removeCat(c: Category) {
    if (!confirm(`Delete category "${c.name}"? Items keep the name but become uncategorised.`)) return;
    try { await apiDelete(`/categories/${c.id}`); setCats((p) => p.filter((x) => x.id !== c.id)); toast.push("ok", "Deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }
  async function removeStn(s: Station) {
    if (!confirm(`Delete station "${s.name}"?`)) return;
    try { await apiDelete(`/stations/${s.id}`); setStations((p) => p.filter((x) => x.id !== s.id)); toast.push("ok", "Deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const count = (name: string) => items.filter((i) => i.category === name).length;

  if (loading) return <PageLoader label="Loading menu" />;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Menu" subtitle={`${items.length} dishes · ${cats.length} categories · ${stations.length} stations`} icon={UtensilsCrossed}>
          {tab === "items" && (
            <button onClick={() => setEditItem("new")} className="btn btn-primary btn-sm">
              <Plus size={14} /> New dish
            </button>
          )}
          {tab === "categories" && (
            <button onClick={() => setEditCat("new")} className="btn btn-primary btn-sm">
              <Plus size={14} /> New category
            </button>
          )}
          {tab === "stations" && (
            <button onClick={() => setEditStn("new")} className="btn btn-primary btn-sm">
              <Plus size={14} /> New station
            </button>
          )}
        </PageHeader>

        <div className="flex gap-1.5 p-1 rounded-full self-start" style={{ background: "var(--panel-2)" }}>
          {([
            ["items",     "Items",      UtensilsCrossed],
            ["categories","Categories", FolderCog],
            ["stations",  "Stations",   Flame],
          ] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors flex items-center gap-2"
              style={tab === k
                ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                : { color: "var(--muted)" }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </Screen>

      {/* ---- ITEMS TAB ---- */}
      {tab === "items" && (
        <div className="grid lg:grid-cols-[220px_1fr] gap-3">
          <Screen className="!p-3">
            <div className="scroll-thin flex flex-col gap-1 max-h-[70vh] overflow-y-auto pr-1">
              {cats.map((c) => (
                <button key={c.id} onClick={() => { setActiveCat(c.name); setQ(""); }}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-left text-[13px] transition-colors"
                  style={!q && activeCat === c.name
                    ? { background: "var(--olive)", color: "var(--on-accent)" }
                    : { background: "transparent", color: "var(--ink)" }}>
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="text-[11px]" style={{ opacity: 0.8 }}>{count(c.name)}</span>
                </button>
              ))}
            </div>
          </Screen>

          <Screen>
            <div className="relative max-w-md mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input className="inp pl-9" placeholder="Search all dishes…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            {!shownItems.length ? (
              <EmptyState title="No dishes" hint={q ? "Try another search." : "Add one with the button above."} icon={<UtensilsCrossed size={28} />} />
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {shownItems.map((it) => (
                  <div key={it.id} className="rounded-xl p-3 flex items-start gap-3"
                    style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
                    {it.imageUrl ? (
                      <img src={it.imageUrl} alt="" className="size-14 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="size-14 rounded-lg shrink-0 flex items-center justify-center"
                        style={{ background: "var(--panel)", color: "var(--muted)" }}>
                        <ImageIcon size={20} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-[13.5px] text-ink truncate">{it.name}</div>
                          <div className="text-[11px] text-muted">
                            {stations.find((s) => s.id === it.stationId)?.name || "No station"}
                            {it.plu ? ` · #${it.plu}` : ""}
                          </div>
                        </div>
                        <div className="mono font-semibold text-ink text-[14px] whitespace-nowrap">{money(it.price, currency)}</div>
                      </div>
                      <div className="flex gap-1 mt-2 justify-end">
                        {it.modifiers && it.modifiers.length > 0 && (
                          <span className="pill pill-olive mr-auto" style={{ padding: "1px 7px", fontSize: 10 }}>
                            {it.modifiers.length} mods
                          </span>
                        )}
                        <button onClick={() => toggleSoldOut(it)} className="btn btn-ghost btn-sm !px-2" title={it.soldOut ? "Mark available" : "Mark sold out"}>
                          {it.soldOut ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button onClick={() => setEditItem(it)} className="btn btn-ghost btn-sm !px-2" title="Edit">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => removeItem(it)} className="btn btn-ghost btn-sm !px-2" title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Screen>
        </div>
      )}

      {/* ---- CATEGORIES TAB ---- */}
      {tab === "categories" && (
        <Screen>
          {!cats.length ? (
            <EmptyState title="No categories" hint="Add one above." icon={<FolderCog size={28} />} />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {cats.map((c) => (
                <div key={c.id} className="rounded-xl p-4 flex items-center justify-between"
                  style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
                  <div>
                    <div className="font-semibold text-ink">{c.name}</div>
                    <div className="text-[11.5px] text-muted">{count(c.name)} items</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditCat(c)} className="btn btn-ghost btn-sm !px-2"><Pencil size={13} /></button>
                    <button onClick={() => removeCat(c)} className="btn btn-ghost btn-sm !px-2"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Screen>
      )}

      {/* ---- STATIONS TAB ---- */}
      {tab === "stations" && (
        <Screen>
          {!stations.length ? (
            <EmptyState title="No stations" hint="Stations tell the kitchen which section cooks what." icon={<Flame size={28} />} />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {stations.map((s) => (
                <div key={s.id} className="rounded-xl p-4 flex items-center justify-between"
                  style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
                  <div className="flex items-center gap-2.5">
                    <span className="size-5 rounded-md" style={{ background: s.color || "var(--olive)" }} />
                    <div>
                      <div className="font-semibold text-ink">{s.name}</div>
                      <div className="text-[11.5px] text-muted">{items.filter((i) => i.stationId === s.id).length} items</div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditStn(s)} className="btn btn-ghost btn-sm !px-2"><Pencil size={13} /></button>
                    <button onClick={() => removeStn(s)} className="btn btn-ghost btn-sm !px-2"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Screen>
      )}

      {editItem && (
        <ItemEditor
          existing={editItem === "new" ? null : editItem}
          categories={cats}
          stations={stations}
          ingredients={ingredients}
          currency={currency}
          onClose={() => setEditItem(null)}
          onDone={() => { setEditItem(null); load(); toast.push("ok", "Saved"); }}
        />
      )}
      {editCat && (
        <CategoryEditor
          existing={editCat === "new" ? null : editCat}
          onClose={() => setEditCat(null)}
          onDone={() => { setEditCat(null); load(); toast.push("ok", "Saved"); }}
        />
      )}
      {editStn && (
        <StationEditor
          existing={editStn === "new" ? null : editStn}
          onClose={() => setEditStn(null)}
          onDone={() => { setEditStn(null); load(); toast.push("ok", "Saved"); }}
        />
      )}
    </div>
  );
}

/* ---------- ITEM EDITOR (image, modifiers, recipe) ---------- */
function ItemEditor({
  existing, categories, stations, ingredients, currency, onClose, onDone,
}: {
  existing: MenuItem | null;
  categories: Category[];
  stations: Station[];
  ingredients: Ingredient[];
  currency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    name: existing?.name || "",
    price: String(existing?.price || 0),
    category: existing?.category || categories[0]?.name || "",
    plu: existing?.plu || "",
    stationId: String(existing?.stationId || ""),
    imageUrl: existing?.imageUrl || "",
  });
  const [modifiers, setModifiers] = useState<ModifierGroup[]>(existing?.modifiers || []);
  const [recipe, setRecipe] = useState<RecipeLine[]>(
    ((existing as unknown as { recipe?: RecipeLine[] })?.recipe) || []
  );
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"basic" | "mods" | "recipe">("basic");

  async function save() {
    if (!f.name.trim()) { toast.push("bad", "Name is required"); return; }
    setBusy(true);
    const payload = {
      name: f.name,
      price: Number(f.price) || 0,
      category: f.category,
      plu: f.plu || null,
      stationId: f.stationId ? Number(f.stationId) : null,
      imageUrl: f.imageUrl,
      modifiers,
      recipe,
    };
    try {
      if (existing) await apiPut(`/menu/${existing.id}`, payload);
      else await apiPost("/menu", payload);
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }

  // Dish photo → shrunk to ~800 px JPEG in the browser (any phone photo works,
  // and the customer QR menu stays fast on mobile data).
  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const url = await resizeImageFile(file, { maxWidth: 800, maxHeight: 800, maxBytes: 180 * 1024 });
      setF((p) => ({ ...p, imageUrl: url }));
    } catch (err) { toast.push("bad", err instanceof Error ? err.message : "Could not use that picture"); }
  }

  return (
    <Modal open title={existing ? `Edit — ${existing.name}` : "New dish"} onClose={onClose} width={560}>
      <div className="flex gap-1.5 p-1 rounded-full mb-4" style={{ background: "var(--panel-2)" }}>
        {(["basic", "mods", "recipe"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-1.5 rounded-full text-[12.5px] font-semibold capitalize transition-colors"
            style={tab === t
              ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
              : { color: "var(--muted)" }}>
            {t === "basic" ? "Basic" : t === "mods" ? "Modifiers" : "Recipe"}
          </button>
        ))}
      </div>

      {tab === "basic" && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div
              className="size-24 shrink-0 rounded-xl overflow-hidden flex items-center justify-center"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}
            >
              {f.imageUrl ? (
                <img src={f.imageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon size={28} style={{ color: "var(--muted)" }} />
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <label className="btn btn-ghost btn-sm cursor-pointer">
                <ImageIcon size={13} /> Upload image
                <input type="file" accept="image/*" className="hidden" onChange={pickImage} />
              </label>
              {f.imageUrl && (
                <button onClick={() => setF({ ...f, imageUrl: "" })} className="btn btn-ghost btn-sm">
                  <X size={13} /> Remove
                </button>
              )}
              <div className="text-[11px] text-muted">Up to 2 MB</div>
            </div>
          </div>
          <div><label className="lbl">Name</label>
            <input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="lbl">Price ({currency.trim()})</label>
              <input className="inp mono" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
            <div><label className="lbl">PLU code (optional)</label>
              <input className="inp mono" value={f.plu} onChange={(e) => setF({ ...f, plu: e.target.value })} /></div>
            <div><label className="lbl">Category</label>
              <select className="inp" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select></div>
            <div><label className="lbl">Station</label>
              <select className="inp" value={f.stationId} onChange={(e) => setF({ ...f, stationId: e.target.value })}>
                <option value="">— None —</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
          </div>
        </div>
      )}

      {tab === "mods" && (
        <ModifierBuilder groups={modifiers} onChange={setModifiers} currency={currency} />
      )}

      {tab === "recipe" && (
        <RecipeBuilder lines={recipe} ingredients={ingredients} onChange={setRecipe} />
      )}

      <button onClick={save} disabled={busy} className="btn btn-primary w-full btn-lg mt-5">
        {busy ? "Saving…" : existing ? "Save changes" : "Create dish"}
      </button>
    </Modal>
  );
}

/* ---------- Modifier groups editor ---------- */
function ModifierBuilder({
  groups, onChange, currency,
}: {
  groups: ModifierGroup[];
  onChange: (g: ModifierGroup[]) => void;
  currency: string;
}) {
  function addGroup() {
    onChange([...groups, { id: Date.now(), name: `Group ${groups.length + 1}`, options: [] }]);
  }
  function updateGroup(idx: number, patch: Partial<ModifierGroup>) {
    const next = [...groups]; next[idx] = { ...next[idx], ...patch }; onChange(next);
  }
  function removeGroup(idx: number) { onChange(groups.filter((_, i) => i !== idx)); }
  function addOption(gi: number) {
    const next = [...groups]; next[gi] = { ...next[gi], options: [...next[gi].options, { option: "", priceDelta: 0 }] }; onChange(next);
  }
  function updateOption(gi: number, oi: number, patch: Partial<{ option: string; priceDelta: number }>) {
    const next = [...groups];
    const opts = [...next[gi].options]; opts[oi] = { ...opts[oi], ...patch };
    next[gi] = { ...next[gi], options: opts }; onChange(next);
  }
  function removeOption(gi: number, oi: number) {
    const next = [...groups]; next[gi] = { ...next[gi], options: next[gi].options.filter((_, i) => i !== oi) }; onChange(next);
  }
  return (
    <div className="space-y-3 max-h-[380px] overflow-y-auto -mx-1 px-1">
      {!groups.length && <p className="text-sm text-muted text-center py-4">No modifier groups. Add one below to let staff pick options (e.g. “Size”, “Spice level”).</p>}
      {groups.map((g, gi) => (
        <div key={gi} className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
          <div className="flex items-center gap-2 mb-2">
            <input className="inp !py-1.5 text-[13px] font-semibold flex-1" value={g.name}
              onChange={(e) => updateGroup(gi, { name: e.target.value })} />
            <button onClick={() => removeGroup(gi)} className="btn btn-ghost btn-sm !px-2"><Trash2 size={13} /></button>
          </div>
          <div className="flex flex-col gap-1.5">
            {g.options.map((o, oi) => (
              <div key={oi} className="flex gap-2">
                <input className="inp !py-1.5 text-[12.5px] flex-1" placeholder="Option (e.g. Small)" value={o.option}
                  onChange={(e) => updateOption(gi, oi, { option: e.target.value })} />
                <input className="inp !py-1.5 text-[12.5px] mono" style={{ width: 110 }} placeholder="+ price" inputMode="decimal"
                  value={o.priceDelta || ""} onChange={(e) => updateOption(gi, oi, { priceDelta: Number(e.target.value) || 0 })} />
                <button onClick={() => removeOption(gi, oi)} className="btn btn-ghost btn-sm !px-2"><X size={12} /></button>
              </div>
            ))}
            <button onClick={() => addOption(gi)} className="btn btn-ghost btn-sm self-start"><Plus size={13} /> Add option</button>
          </div>
        </div>
      ))}
      <button onClick={addGroup} className="btn btn-primary btn-sm"><Plus size={13} /> Add modifier group</button>
    </div>
  );
}

/* ---------- Recipe builder (links to inventory for auto-deduct) ---------- */
function RecipeBuilder({
  lines, ingredients, onChange,
}: {
  lines: RecipeLine[];
  ingredients: Ingredient[];
  onChange: (lines: RecipeLine[]) => void;
}) {
  function add() {
    onChange([...lines, { ingredientId: ingredients[0]?.id || 0, qty: 1 }]);
  }
  function update(i: number, patch: Partial<RecipeLine>) {
    const next = [...lines]; next[i] = { ...next[i], ...patch }; onChange(next);
  }
  function remove(i: number) { onChange(lines.filter((_, j) => j !== i)); }
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">
        Add the ingredients used per serving. When this dish is ordered, those ingredients come out of inventory automatically.
      </p>
      {!ingredients.length && (
        <p className="text-[12.5px] text-warn">Add ingredients under Inventory first.</p>
      )}
      {lines.map((l, i) => {
        const ing = ingredients.find((x) => x.id === l.ingredientId);
        return (
          <div key={i} className="flex gap-2 items-center">
            <select className="inp flex-1" value={l.ingredientId}
              onChange={(e) => update(i, { ingredientId: Number(e.target.value) })}>
              {ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <input className="inp mono" style={{ width: 110 }} inputMode="decimal" value={l.qty}
              onChange={(e) => update(i, { qty: Number(e.target.value) || 0 })} />
            <span className="text-[12px] text-muted w-10">{ing?.unit}</span>
            <button onClick={() => remove(i)} className="btn btn-ghost btn-sm !px-2"><Trash2 size={13} /></button>
          </div>
        );
      })}
      <button onClick={add} disabled={!ingredients.length} className="btn btn-primary btn-sm">
        <Plus size={13} /> Add ingredient
      </button>
    </div>
  );
}

/* ---------- Category + Station editors (small) ---------- */
function CategoryEditor({ existing, onClose, onDone }: { existing: Category | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name || "");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (existing) await apiPut(`/categories/${existing.id}`, { name });
      else await apiPost("/categories", { name });
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={existing ? `Edit — ${existing.name}` : "New category"} onClose={onClose} width={360}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

function StationEditor({ existing, onClose, onDone }: { existing: Station | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name || "");
  const [color, setColor] = useState(existing?.color || "#7471f6");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (existing) await apiPut(`/stations/${existing.id}`, { name, color });
      else await apiPost("/stations", { name, color });
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={existing ? `Edit — ${existing.name}` : "New station"} onClose={onClose} width={360}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="lbl">Colour</label>
          <input type="color" className="inp !p-1 h-10 w-full cursor-pointer" value={color} onChange={(e) => setColor(e.target.value)} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}
