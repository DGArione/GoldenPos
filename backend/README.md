# RapidPOS — Restaurant Point of Sale (Node.js)

A full-featured restaurant POS: multi-branch ordering, kitchen display, floor/tables,
inventory & recipes, online ordering, payments (cash/card/online) with card-fee
tracking, discounts & voids with manager approval, staff/shifts/payroll, messaging,
notifications, Z-reports, stock periods, and rich analytics.

This is a **Node.js port** of an original PHP single-page app. The browser front-end
is the same vanilla-JS SPA; the PHP/MySQL backend has been rewritten as an
**Express** server backed by Node's **built-in SQLite** (`node:sqlite`), so there is
no separate database server to install.

## Requirements

- **Node.js ≥ 22.5** (uses the built-in `node:sqlite` module)
- No MySQL/PHP needed. The only npm dependency is Express.

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000**. On first run the app creates
`data/pos.db` and seeds two demo branches, a demo menu, and six accounts.

Set a different port with `PORT=8080 npm start`.

### Demo logins (PIN)

| Role          | PIN  |
|---------------|------|
| Admin         | 9999 |
| Super Manager | 1234 |
| Manager       | 1111 |
| Server        | 2222 |
| Cashier       | 3333 |
| Kitchen       | 4444 |

> These are well-known demo PINs — change them under **Admin → Users** before any
> real use. The Admin account can also switch to username/password login.

## Project layout

```
server.js            Express app: static hosting, clean URLs, /api mount
src/
  db.js              SQLite schema, first-run seed, PDO-style wrapper
  helpers.js         Auth tokens, hashing, row parsers, totals, inventory
  api.js             The REST API (port of the original api/index.php router)
public/              The front-end SPA (HTML/CSS/vanilla JS)
data/                SQLite database + signing secret (git-ignored)
```

## How it works

- **API** — every route lives under `/api` (e.g. `GET /api/menu`,
  `POST /api/orders`). Legacy `api/index.php/...` paths used by a few pages are
  accepted too. Auth uses a signed token (HMAC-SHA256) sent as an `X-Auth-Token`
  header or `?_auth=` query param; `superManager` passes the active `branchId` as a
  query param.
- **Database** — a single SQLite file at `data/pos.db`. Delete it to reset to a
  fresh seeded state. All tables from the original schema are recreated.
- **Passwords/PINs** — hashed with scrypt. The seeded plain-text demo PINs are
  transparently upgraded to hashes on first login.
- **Money math** — service charge and VAT rates are configurable in
  **Admin → Settings**; totals and inventory deductions are always computed
  server-side, never trusted from the browser.

## Configuration

Environment variables (all optional):

| Variable       | Default        | Purpose                        |
|----------------|----------------|--------------------------------|
| `PORT`         | `3000`         | HTTP port                      |
| `POS_DATA_DIR` | `./data`       | Where the DB + secret live     |
| `POS_DB_FILE`  | `<data>/pos.db`| SQLite database file path      |

## Notes

- Admin → Settings has a **full JSON export** (`/api/settings/export`) for backups.
- `data/secret.txt` holds the per-install token signing key. Keep it private;
  deleting it logs everyone out.
