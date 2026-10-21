// ============================================================
// src/sample-images.js — demo pictures for a brand-new install
// ------------------------------------------------------------
// Runs ONLY when a new, empty database is first seeded (see db.js
// seedIfEmpty). It fills every picture slot that is still empty:
//   • a photo for every seeded menu item   (sample-images/menu/<slug>.jpg)
//   • logo, login background, login side panel, branch picture
//   • two home banners with pictures
// An existing database is never touched. Set POS_NO_SAMPLE_IMAGES=1 to
// start a new install without them. Photo credits: sample-images/CREDITS.md
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'sample-images');

/** "Veg, Egg & Chicken Fried Rice" -> "veg-egg-chicken-fried-rice" */
function slug(name) {
  return String(name || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function dataUrl(file) {
  try {
    const buf = fs.readFileSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (_) { return ''; }
}

function applySampleImages(db) {
  if (String(process.env.POS_NO_SAMPLE_IMAGES || '') === '1') return 0;
  if (!fs.existsSync(DIR)) return 0;
  let n = 0;

  // Menu items
  const menuDir = path.join(DIR, 'menu');
  if (fs.existsSync(menuDir)) {
    const files = new Map(fs.readdirSync(menuDir).map((f) => [f.replace(/\.(jpe?g|png|webp)$/i, ''), path.join(menuDir, f)]));
    const upd = db.prepare('UPDATE menu_items SET imageUrl=? WHERE id=?');
    for (const m of db.query("SELECT id, name FROM menu_items WHERE imageUrl IS NULL OR imageUrl=''").fetchAll()) {
      const f = files.get(slug(m.name));
      if (f) { const url = dataUrl(f); if (url) { upd.execute([url, m.id]); n++; } }
    }
  }

  // Branding: logo, login background, login side panel
  const s = db.query('SELECT * FROM settings WHERE id=1').fetch() || {};
  const brand = [['logoUrl', 'logo.png'], ['loginBgUrl', 'login-background.jpg'], ['loginPanelImageUrl', 'login-panel.jpg']];
  for (const [col, file] of brand) {
    const f = path.join(DIR, file);
    if (!s[col] && fs.existsSync(f)) { db.prepare(`UPDATE settings SET ${col}=? WHERE id=1`).execute([dataUrl(f)]); n++; }
  }

  // Branch picture
  const bf = path.join(DIR, 'branch.jpg');
  if (fs.existsSync(bf)) {
    const r = db.prepare("UPDATE branches SET imageUrl=? WHERE imageUrl IS NULL OR imageUrl=''"); r.execute([dataUrl(bf)]); n++;
  }

  // Home banners (only if none are set)
  let banners = [];
  try { banners = JSON.parse(s.homeBanners || '[]') || []; } catch (_) { banners = []; }
  const b1 = path.join(DIR, 'banner-1.jpg'), b2 = path.join(DIR, 'banner-2.jpg');
  if (!banners.length && fs.existsSync(b1) && fs.existsSync(b2)) {
    banners = [
      { title: 'Fresh from the kitchen', body: 'Sri Lankan rice & curry, kottu and hoppers - made to order.', color: '#f6990d', imageUrl: dataUrl(b1) },
      { title: 'Juices & shakes', body: 'Fresh tropical juices, lassi and milkshakes all day.', color: '#0e7490', imageUrl: dataUrl(b2) },
    ];
    db.prepare('UPDATE settings SET homeBanners=? WHERE id=1').execute([JSON.stringify(banners)]); n++;
  }

  if (n) console.log(`[db] Added ${n} sample picture(s) for the demo menu and branding.`);
  return n;
}

module.exports = { applySampleImages, slug };
