// ============================================================
// src/db.js — SQLite database layer
// ------------------------------------------------------------
// Uses Node's built-in synchronous SQLite (node:sqlite), which maps
// cleanly onto the original PHP/PDO code. A thin PDO-like wrapper
// (prepare/execute/fetch/fetchAll/fetchColumn/query/exec/lastInsertId +
// transactions) lets the router read almost identically to the PHP.
// ============================================================
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Where the data lives is chosen in Settings > Storage (storage-config.js). A folder
// move requested there is carried out HERE, before the database is opened.
const SC = require('./storage-config');
try { SC.applyPendingMove(); } catch (e) { console.error('[storage] move failed:', e.message); }
const DATA_DIR = SC.dataDir();
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.POS_DB_FILE || path.join(DATA_DIR, 'pos.db');

// A restore chosen in System Admin is applied here, before the file is opened.
try { require('./backup').applyPendingRestore(); } catch (e) { console.error('[restore] failed:', e.message); }

const raw = new DatabaseSync(DB_FILE);
raw.exec('PRAGMA journal_mode = WAL;');
raw.exec('PRAGMA foreign_keys = ON;');
// Wait (instead of failing) if a backup/checkpoint briefly holds the lock;
// FULL sync keeps every paid bill safe across sudden power cuts.
raw.exec('PRAGMA busy_timeout = 5000;');
raw.exec('PRAGMA synchronous = FULL;');

// ── Normalise bind values for node:sqlite ────────────────────
// node:sqlite only accepts null | number | bigint | string | Uint8Array.
function norm(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// PHP's PDOStatement::fetch() returns false when exhausted — we mirror that.
class Result {
  constructor(rows, info) {
    this._rows = rows || [];
    this._i = 0;
    this._info = info || null;
  }
  fetch() {
    return this._i < this._rows.length ? this._rows[this._i++] : false;
  }
  fetchAll() {
    const out = this._rows.slice(this._i);
    this._i = this._rows.length;
    return out;
  }
  fetchColumn(n = 0) {
    const row = this.fetch();
    if (row === false) return false;
    const vals = Object.values(row);
    return vals[n];
  }
}

const SELECTISH = /^\s*(SELECT|PRAGMA|WITH)/i;

class Stmt {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this._stmt = db.raw.prepare(sql);
    this._result = new Result([]);
  }
  execute(params = []) {
    const p = (params || []).map(norm);
    if (SELECTISH.test(this.sql)) {
      const rows = this._stmt.all(...p);
      this._result = new Result(rows);
    } else {
      const info = this._stmt.run(...p);
      this.db._lastId = Number(info.lastInsertRowid);
      this.db._changes = Number(info.changes);
      this._result = new Result([], info);
    }
    return this._result;
  }
  fetch() { return this._result.fetch(); }
  fetchAll() { return this._result.fetchAll(); }
  fetchColumn(n = 0) { return this._result.fetchColumn(n); }
}

class DB {
  constructor(rawDb) {
    this.raw = rawDb;
    this._lastId = 0;
    this._changes = 0;
  }
  prepare(sql) { return new Stmt(this, sql); }
  query(sql) { const s = new Stmt(this, sql); s.execute([]); return s; }
  exec(sql) { this.raw.exec(sql); }
  lastInsertId() { return this._lastId; }
  beginTransaction() { this.raw.exec('BEGIN'); }
  commit() { this.raw.exec('COMMIT'); }
  rollBack() { this.raw.exec('ROLLBACK'); }
}

const db = new DB(raw);

// ── Schema (translated from _install/pos_php_fresh.sql to SQLite) ──
const SCHEMA = `
CREATE TABLE IF NOT EXISTS branches (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  address   TEXT DEFAULT '',
  phone     TEXT DEFAULT '',
  status    TEXT DEFAULT 'active',
  createdAt TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId           INTEGER DEFAULT NULL,
  name               TEXT NOT NULL,
  pin                TEXT NOT NULL DEFAULT '____',
  pin_index          TEXT DEFAULT NULL,
  role               TEXT NOT NULL DEFAULT 'server',
  payRate            REAL DEFAULT 0,
  payType            TEXT DEFAULT 'hourly',
  authMethod         TEXT DEFAULT 'pin',
  passwordHash       TEXT DEFAULT NULL,
  mustChangePassword INTEGER DEFAULT 0,
  isHeld             INTEGER DEFAULT 0,
  username           TEXT DEFAULT NULL,
  UNIQUE (username)
);
CREATE INDEX IF NOT EXISTS idx_pin ON users (pin);
CREATE INDEX IF NOT EXISTS idx_pin_index ON users (pin_index);

CREATE TABLE IF NOT EXISTS settings (
  id                       INTEGER PRIMARY KEY,
  businessName             TEXT DEFAULT 'Restaurant POS',
  logoUrl                  TEXT DEFAULT '',
  businessTagline          TEXT DEFAULT '',
  businessPhone            TEXT DEFAULT '',
  businessAddress          TEXT DEFAULT '',
  businessEmail            TEXT DEFAULT '',
  theme                    TEXT DEFAULT 'light',
  allowUserThemeOverride   INTEGER DEFAULT 1,
  lightThemeId             TEXT DEFAULT 'goldenPos',
  darkThemeId              TEXT DEFAULT 'goldenPosDark',
  activeThemeId            TEXT DEFAULT 'goldenPos',
  accentColor              TEXT DEFAULT '#f6990d',
  accentDark               TEXT DEFAULT '#a85e00',
  accentSoft               TEXT DEFAULT '#fff3dc',
  font                     TEXT DEFAULT 'Poppins',
  currencySymbol           TEXT DEFAULT 'Rs. ',
  serviceChargeRate        REAL DEFAULT 0.1000,
  vatRate                  REAL DEFAULT 0.0800,
  cardFeePercent           REAL DEFAULT 0.0000,
  dateFormat               TEXT DEFAULT 'DD/MM/YYYY',
  lowStockDefaultThreshold INTEGER DEFAULT 5,
  receiptFooterText        TEXT DEFAULT 'Thank you for dining with us!',
  receiptShowVatBreakdown  INTEGER DEFAULT 1,
  notifyEmailEnabled       INTEGER DEFAULT 0,
  notifySmsEnabled         INTEGER DEFAULT 0,
  loginLayout              TEXT DEFAULT 'chalkboard',
  loginBgUrl               TEXT DEFAULT '',
  lastBackupAt             TEXT DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS stations (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId INTEGER NOT NULL,
  name     TEXT NOT NULL,
  color    TEXT DEFAULT '#8a5a34',
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId  INTEGER NOT NULL,
  name      TEXT NOT NULL,
  sortOrder INTEGER DEFAULT 0,
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS menu_items (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId  INTEGER NOT NULL,
  name      TEXT NOT NULL,
  price     REAL DEFAULT 0,
  category  TEXT DEFAULT '',
  plu       TEXT DEFAULT NULL,
  imageUrl  TEXT DEFAULT '',
  stationId INTEGER DEFAULT NULL,
  soldOut   INTEGER DEFAULT 0,
  tags      TEXT DEFAULT '',
  recipe    TEXT DEFAULT NULL,
  modifiers TEXT DEFAULT NULL,
  FOREIGN KEY (branchId)  REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (stationId) REFERENCES stations(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS tables_list (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId INTEGER NOT NULL,
  name     TEXT NOT NULL,
  seats    INTEGER DEFAULT 4,
  status   TEXT DEFAULT 'open',
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ingredients (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId          INTEGER NOT NULL,
  name              TEXT NOT NULL,
  unit              TEXT DEFAULT 'pcs',
  qty               REAL DEFAULT 0,
  unitCost          REAL DEFAULT 0,
  lowStockThreshold REAL DEFAULT 0,
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS stock_periods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId      INTEGER NOT NULL,
  label         TEXT NOT NULL,
  startDate     TEXT NOT NULL,
  endDate       TEXT NOT NULL,
  status        TEXT DEFAULT 'closed',
  "lines"       TEXT NOT NULL,
  openingValue  REAL DEFAULT 0,
  purchaseValue REAL DEFAULT 0,
  consumedValue REAL DEFAULT 0,
  closingValue  REAL DEFAULT 0,
  closedByName  TEXT DEFAULT '',
  note          TEXT DEFAULT '',
  createdAt     TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS suppliers (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId INTEGER NOT NULL,
  name     TEXT NOT NULL,
  contact  TEXT DEFAULT '',
  email    TEXT DEFAULT '',
  notes    TEXT DEFAULT '',
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS purchases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId     INTEGER NOT NULL,
  supplierId   INTEGER DEFAULT NULL,
  supplierName TEXT DEFAULT '',
  items        TEXT NOT NULL,
  total        REAL DEFAULT 0,
  note         TEXT DEFAULT '',
  createdAt    TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (branchId)   REFERENCES branches(id)  ON DELETE CASCADE,
  FOREIGN KEY (supplierId) REFERENCES suppliers(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  orderSeqNum       INTEGER DEFAULT NULL,
  branchId          INTEGER NOT NULL,
  orderType         TEXT DEFAULT 'dine-in',
  tableId           INTEGER DEFAULT NULL,
  tableName         TEXT DEFAULT '',
  staffId           INTEGER DEFAULT NULL,
  staffName         TEXT DEFAULT '',
  customerName      TEXT DEFAULT '',
  customerPhone     TEXT DEFAULT '',
  customerAddress   TEXT DEFAULT '',
  note              TEXT DEFAULT '',
  items             TEXT NOT NULL,
  subtotal          REAL DEFAULT 0,
  discount          TEXT DEFAULT NULL,
  serviceCharge     REAL DEFAULT 0,
  vat               REAL DEFAULT 0,
  total             REAL DEFAULT 0,
  status            TEXT DEFAULT 'pending',
  paymentStatus     TEXT DEFAULT 'unpaid',
  priority          TEXT DEFAULT 'normal',
  kitchenTag        TEXT DEFAULT NULL,
  inventoryDeducted INTEGER DEFAULT 0,
  payments          TEXT DEFAULT '[]',
  amountPaid        REAL DEFAULT 0,
  tipAmount         REAL DEFAULT 0,
  void_data         TEXT DEFAULT NULL,
  paidAt            TEXT DEFAULT NULL,
  readyAt           TEXT DEFAULT NULL,
  dispatchedAt      TEXT DEFAULT NULL,
  createdAt         TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS table_bills (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId    INTEGER NOT NULL,
  tableId     INTEGER NOT NULL,
  tableName   TEXT DEFAULT '',
  orderIds    TEXT NOT NULL,
  snapshot    TEXT NOT NULL,
  discount    TEXT DEFAULT NULL,
  status      TEXT DEFAULT 'open',
  payments    TEXT DEFAULT '[]',
  amountPaid  REAL DEFAULT 0,
  createdBy   TEXT DEFAULT '',
  createdAt   TEXT DEFAULT (datetime('now','localtime')),
  paidAt      TEXT DEFAULT NULL,
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_table_bills_branch_status ON table_bills(branchId, status);
CREATE TABLE IF NOT EXISTS held_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId        INTEGER NOT NULL,
  label           TEXT DEFAULT '',
  staffName       TEXT DEFAULT '',
  orderType       TEXT DEFAULT 'dine-in',
  tableId         INTEGER DEFAULT NULL,
  tableName       TEXT DEFAULT '',
  customerName    TEXT DEFAULT '',
  customerPhone   TEXT DEFAULT '',
  customerAddress TEXT DEFAULT '',
  items           TEXT NOT NULL,
  note            TEXT DEFAULT '',
  priority        TEXT DEFAULT 'normal',
  heldAt          TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS customers (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId  INTEGER NOT NULL,
  phone     TEXT NOT NULL,
  name      TEXT DEFAULT '',
  address   TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE (branchId, phone),
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId     INTEGER DEFAULT NULL,
  type         TEXT DEFAULT 'info',
  message      TEXT NOT NULL,
  targetRole   TEXT DEFAULT 'all',
  targetUserId INTEGER DEFAULT NULL,
  relatedId    INTEGER DEFAULT NULL,
  readBy       TEXT DEFAULT '[]',
  createdAt    TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId   INTEGER NOT NULL,
  parentId   INTEGER DEFAULT NULL,
  fromUserId INTEGER NOT NULL,
  fromName   TEXT DEFAULT '',
  fromRole   TEXT DEFAULT '',
  toUserId   INTEGER DEFAULT NULL,
  toName     TEXT DEFAULT '',
  toRole     TEXT DEFAULT NULL,
  body       TEXT NOT NULL,
  readBy     TEXT DEFAULT '[]',
  createdAt  TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS shifts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId INTEGER NOT NULL,
  userId   INTEGER NOT NULL,
  userName TEXT DEFAULT '',
  clockIn  TEXT NOT NULL,
  clockOut TEXT DEFAULT NULL,
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (userId)   REFERENCES users(id)    ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS z_reports (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId           INTEGER NOT NULL,
  generatedBy        TEXT DEFAULT '',
  fromDate           TEXT NOT NULL DEFAULT '',
  toDate             TEXT NOT NULL DEFAULT '',
  generatedAt        TEXT DEFAULT (datetime('now','localtime')),
  orderCount         INTEGER DEFAULT 0,
  grossSales         REAL DEFAULT 0,
  totalDiscounts     REAL DEFAULT 0,
  totalServiceCharge REAL DEFAULT 0,
  totalVat           REAL DEFAULT 0,
  netSales           REAL DEFAULT 0,
  paymentBreakdown   TEXT NOT NULL,
  voidedCount        INTEGER DEFAULT 0,
  voidedTotal        REAL DEFAULT 0,
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS petty_cash (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId    INTEGER NOT NULL,
  type        TEXT NOT NULL,
  amount      REAL NOT NULL,
  description TEXT DEFAULT '',
  staffName   TEXT DEFAULT '',
  createdAt   TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS login_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  userId     INTEGER NOT NULL,
  userName   TEXT DEFAULT '',
  role       TEXT DEFAULT '',
  branchId   INTEGER DEFAULT NULL,
  branchName TEXT DEFAULT '',
  userAgent  TEXT DEFAULT '',
  at         TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS login_rate_limits (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  keyHash TEXT NOT NULL,
  hitAt   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_key_time ON login_rate_limits (keyHash, hitAt);

CREATE TABLE IF NOT EXISTS permissions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  branchId                 INTEGER NOT NULL,
  serverMaxDiscountPercent REAL DEFAULT 10.00,
  allowServerVoid          INTEGER DEFAULT 0,
  allowCashierVoid         INTEGER DEFAULT 0,
  UNIQUE (branchId),
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS order_sequences (
  branchId     INTEGER NOT NULL PRIMARY KEY,
  currentNum   INTEGER NOT NULL DEFAULT 0,
  lastResetAt  TEXT DEFAULT NULL,
  lastResetNum INTEGER DEFAULT 0,
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);
`;

function migrate() {
  db.exec(SCHEMA);
  // ── Golden POS re-theme migration ─────
  // Switch databases still on the old vintage "Golden Beach" palette over to
  // the new Golden POS orange/grey design. Users who have picked a different
  // theme (ocean, slate, violet, …) are left alone.
  try {
    db.exec(`
      UPDATE settings SET lightThemeId  = 'goldenPos'      WHERE lightThemeId  = 'goldenBeach';
      UPDATE settings SET darkThemeId   = 'goldenPosDark'  WHERE darkThemeId   = 'goldenBeachNight';
      UPDATE settings SET activeThemeId = 'goldenPos'      WHERE activeThemeId = 'goldenBeach';
      UPDATE settings SET
        accentColor = '#f6990d',
        accentDark  = '#a85e00',
        accentSoft  = '#fff3dc'
        WHERE accentColor = '#b06a38';
      UPDATE settings SET font = 'Poppins' WHERE font = 'Hanken Grotesk';
    `);
  } catch (e) { /* fresh install — settings row not inserted yet */ }
  // Additive migrations for existing databases (safe no-ops on fresh installs).
  const addCol = (table, col, def) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch (e) { /* already exists */ }
  };
  addCol('settings', 'autoStockClose', 'INTEGER DEFAULT 1');
  addCol('settings', 'lastAutoStockCloseMonth', 'TEXT DEFAULT NULL');
  // Golden POS home banners (JSON array of {title, body, color?, imageUrl?, menuItemId?}).
  addCol('settings', 'homeBanners', "TEXT DEFAULT '[]'");
  // Branch photo for the branch picker / page.
  addCol('branches', 'imageUrl', "TEXT DEFAULT ''");
  // Preferred supplier per ingredient (link suppliers → ingredients).
  addCol('ingredients', 'supplierId', "INTEGER DEFAULT NULL");
  // Separate approval PIN for managers (used to authorise discounts/voids/
  // refunds), kept distinct from the login PIN.
  addCol('users', 'approvalPin', 'TEXT DEFAULT NULL');
  addCol('users', 'approvalPinIndex', 'TEXT DEFAULT NULL');
  // Add-on framework + customer loyalty balance.
  addCol('settings', 'enabledAddons', "TEXT DEFAULT '[]'");
  addCol('customers', 'loyaltyPoints', 'REAL DEFAULT 0');
  addCol('tables_list', 'floor', "TEXT DEFAULT ''");   // optional floor/area label
  // Loyalty add-on configuration (points earning + redemption rates).
  addCol('settings', 'loyaltyEarnPoints', 'REAL DEFAULT 1');   // points earned …
  addCol('settings', 'loyaltyEarnPer', 'REAL DEFAULT 100');    // … per this much spent
  addCol('settings', 'loyaltyRedeemValue', 'REAL DEFAULT 1');  // currency value of 1 point
  addCol('settings', 'loyaltyMinRedeem', 'REAL DEFAULT 0');    // min points before redeeming
  // Mark on the order so points are awarded exactly once.
  addCol('orders', 'loyaltyAwarded', 'INTEGER DEFAULT 0');
  // Automatic promotion applied to an order: {promotionId,name,amount}.
  addCol('orders', 'promo_data', 'TEXT DEFAULT NULL');
  // Kitchen -> server hand-off: when cooking started, which server is taking
  // the ready food to the table (only one at a time), and who served it.
  // Staff phone access (mobile data): email used for the Cloudflare email code.
  // Picture inside the coloured panel on the PIN/login screen (optional).
  addCol('settings', 'loginPanelImageUrl', "TEXT DEFAULT ''");
  addCol('users', 'email', "TEXT DEFAULT ''");
  addCol('users', 'phoneAccess', 'INTEGER DEFAULT 0');
  addCol('orders', 'startedAt', 'TEXT DEFAULT NULL');
  addCol('orders', 'pickupById', 'INTEGER DEFAULT NULL');
  addCol('orders', 'pickupByName', "TEXT DEFAULT ''");
  addCol('orders', 'pickupAt', 'TEXT DEFAULT NULL');
  addCol('orders', 'servedById', 'INTEGER DEFAULT NULL');
  addCol('orders', 'servedByName', "TEXT DEFAULT ''");
  // Promotions add-on.
  db.exec(`CREATE TABLE IF NOT EXISTS promotions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    branchId    INTEGER NOT NULL,
    name        TEXT NOT NULL,
    type        TEXT DEFAULT 'buy_n',    -- buy_n | bundle | daily
    conditions  TEXT DEFAULT '[]',       -- [{menuItemId, qty}]
    rewardKind  TEXT DEFAULT 'percent',  -- percent | amount
    rewardValue REAL DEFAULT 0,
    scope       TEXT DEFAULT 'items',    -- items | order  (for percent rewards)
    days        TEXT DEFAULT '[]',       -- [0..6] weekdays; [] = every day
    active      INTEGER DEFAULT 1,
    priority    INTEGER DEFAULT 0,
    createdAt   TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
  )`);
  // Promotion shown on the customer QR menu (restaurant chooses per promotion).
  addCol('promotions', 'showToCustomers', 'INTEGER DEFAULT 0');
  addCol('promotions', 'customerNote', "TEXT DEFAULT ''");
  // Loyalty activity ledger (earn/redeem/adjust) for reporting + audit.
  db.exec(`CREATE TABLE IF NOT EXISTS loyalty_ledger (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    branchId   INTEGER NOT NULL,
    customerId INTEGER,
    phone      TEXT DEFAULT '',
    orderId    INTEGER,
    type       TEXT DEFAULT 'earn',
    points     REAL DEFAULT 0,
    note       TEXT DEFAULT '',
    byStaffName TEXT DEFAULT '',
    createdAt  TEXT DEFAULT (datetime('now','localtime'))
  )`);
  // Gift cards add-on. A card is scanned/typed by its code at payment.
  db.exec(`CREATE TABLE IF NOT EXISTS gift_cards (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    branchId       INTEGER NOT NULL,
    code           TEXT NOT NULL,
    initialBalance REAL DEFAULT 0,
    balance        REAL DEFAULT 0,
    status         TEXT DEFAULT 'active',
    recipientName  TEXT DEFAULT '',
    note           TEXT DEFAULT '',
    issuedByName   TEXT DEFAULT '',
    createdAt      TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE (branchId, code),
    FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS gift_card_ledger (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    branchId    INTEGER NOT NULL,
    cardId      INTEGER,
    code        TEXT DEFAULT '',
    orderId     INTEGER,
    type        TEXT DEFAULT 'issue',
    amount      REAL DEFAULT 0,
    byStaffName TEXT DEFAULT '',
    createdAt   TEXT DEFAULT (datetime('now','localtime'))
  )`);
  // Gift card trail: what the card held after each movement, which order /
  // bill it was for, and a short note (refund reason, disable, etc.).
  addCol('gift_card_ledger', 'balanceAfter', 'REAL DEFAULT NULL');
  addCol('gift_card_ledger', 'orderNum', "TEXT DEFAULT ''");
  addCol('gift_card_ledger', 'note', "TEXT DEFAULT ''");
  // Full change-audit trail (who changed what, when) — beyond login history.
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    branchId   INTEGER,
    userId     INTEGER,
    userName   TEXT DEFAULT '',
    role       TEXT DEFAULT '',
    method     TEXT DEFAULT '',
    path       TEXT DEFAULT '',
    summary    TEXT DEFAULT '',
    statusCode INTEGER,
    ip         TEXT DEFAULT '',
    createdAt  TEXT DEFAULT (datetime('now','localtime'))
  )`);
  // Fiscal / tax-authority foundation.
  addCol('settings', 'taxRegNo', "TEXT DEFAULT ''");          // VAT/TRN registration number
  addCol('settings', 'fiscalEnabled', 'INTEGER DEFAULT 0');    // assign sequential fiscal invoice numbers
  addCol('settings', 'fiscalPrefix', "TEXT DEFAULT 'INV-'");
  addCol('settings', 'fiscalSeq', 'INTEGER DEFAULT 0');
  addCol('orders', 'fiscalNumber', 'TEXT DEFAULT NULL');
  // Thermal print agent (a small local service that drives an ESC/POS printer).
  addCol('settings', 'printAgentUrl', "TEXT DEFAULT ''");
  addCol('settings', 'printAgentEnabled', 'INTEGER DEFAULT 0');
  addCol('settings', 'printPaperWidth', 'INTEGER DEFAULT 48');  // chars per line (48≈80mm, 32≈58mm)
  addCol('settings', 'kitchenPrinterName', "TEXT DEFAULT ''");
  addCol('settings', 'paymentPrinterName', "TEXT DEFAULT ''");
  addCol('settings', 'qrPrinterName', "TEXT DEFAULT ''");          // printer for table QR cards
  // QR table ordering: per-table scan-to-order.
  addCol('tables_list', 'qrToken', 'TEXT DEFAULT NULL');
  addCol('settings', 'publicBaseUrl', "TEXT DEFAULT ''");          // address the customer's phone uses
  addCol('settings', 'qrOrderAutoKitchen', 'INTEGER DEFAULT 1');   // 1 = straight to kitchen, 0 = staff accepts first
  addCol('orders', 'source', "TEXT DEFAULT 'staff'");              // staff | online | qr
  addCol('settings', 'defaultOrderType', "TEXT DEFAULT 'dine-in'"); // dine-in | takeaway | delivery
  addCol('settings', 'loginThemeId', "TEXT DEFAULT ''");            // own palette for the login page ('' = match app)
  addCol('settings', 'wifiSsid', "TEXT DEFAULT ''");                // printed on table QR cards (scan to join Wi-Fi)
  addCol('settings', 'wifiPassword', "TEXT DEFAULT ''");
  // Waste / transfer / adjustment tracking for inventory.
  db.exec(`CREATE TABLE IF NOT EXISTS stock_movements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    branchId       INTEGER NOT NULL,
    ingredientId   INTEGER,
    ingredientName TEXT DEFAULT '',
    type           TEXT DEFAULT 'waste',   -- waste | transfer_out | transfer_in | adjust
    qty            REAL DEFAULT 0,         -- always positive; type gives direction
    unit           TEXT DEFAULT '',
    reason         TEXT DEFAULT '',
    counterpartyBranchId INTEGER,          -- the other branch for a transfer
    byStaffName    TEXT DEFAULT '',
    createdAt      TEXT DEFAULT (datetime('now','localtime'))
  )`);
  // Reservations add-on.
  db.exec(`CREATE TABLE IF NOT EXISTS reservations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    branchId       INTEGER NOT NULL,
    customerName   TEXT DEFAULT '',
    customerPhone  TEXT DEFAULT '',
    partySize      INTEGER DEFAULT 1,
    reserveDate    TEXT DEFAULT '',     -- YYYY-MM-DD
    reserveTime    TEXT DEFAULT '',     -- HH:MM
    tableId        INTEGER,
    tableName      TEXT DEFAULT '',
    status         TEXT DEFAULT 'booked', -- booked | seated | completed | cancelled | no_show
    note           TEXT DEFAULT '',
    createdByName  TEXT DEFAULT '',
    createdAt      TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
  )`);
}

// ── First-run seed (only when there are no branches yet) ─────
function seedIfEmpty() {
  const count = Number(db.query('SELECT COUNT(*) AS c FROM branches').fetch().c);
  if (count > 0) return;

  db.exec(`
    INSERT INTO settings (id, businessName, businessTagline, businessAddress, businessPhone, serviceChargeRate, vatRate,
      font, lightThemeId, darkThemeId, activeThemeId, accentColor, accentDark, accentSoft)
    VALUES (1, 'Golden Beach Restaurant', 'Midigama', 'Midigama, Sri Lanka', '', 0, 0,
      'Poppins', 'goldenPos', 'goldenPosDark', 'goldenPos', '#f6990d', '#a85e00', '#fff3dc');

    INSERT INTO branches (id, name, address, phone, status) VALUES
    (1, 'Golden Beach Restaurant', 'Midigama, Sri Lanka', '', 'active');

    INSERT INTO stations (id, branchId, name, color) VALUES
    (1, 1, 'Kitchen', '#6b7a4e'),
    (2, 1, 'Cold Station', '#3e6b63'),
    (3, 1, 'Bar', '#a9763f');

    INSERT INTO tables_list (branchId, name, seats, status) VALUES
    (1,'Table 1',4,'open'),(1,'Table 2',4,'open'),(1,'Table 3',2,'open'),
    (1,'Table 4',6,'open'),(1,'Table 5',4,'open'),(1,'Table 6',8,'open'),
    (1,'Beach 1',4,'open'),(1,'Beach 2',4,'open');

    INSERT INTO ingredients (branchId, name, unit, qty, lowStockThreshold) VALUES
    (1,'Rice','kg',20,4),
    (1,'Flour','kg',12,3),
    (1,'Mozzarella Cheese','kg',6,1),
    (1,'Chicken','kg',8,2),
    (1,'Fish','kg',6,2),
    (1,'Prawns','kg',4,1),
    (1,'Eggs','pcs',120,24),
    (1,'Avocado','pcs',30,6),
    (1,'Coconut','pcs',40,8),
    (1,'Milk','l',10,2);

    INSERT INTO categories (branchId, name, sortOrder) VALUES
    (1,'Breakfast',1),(1,'Rice & Curry',2),(1,'Fried Rice',3),(1,'Noodles',4),
    (1,'Kottu',5),(1,'Pasta',6),(1,'Devil',7),(1,'Steam Hoppers',8),(1,'Roti',9),
    (1,'Egg Omelette',10),(1,'Pizza',11),(1,'Burger',12),(1,'Sandwiches',13),
    (1,'Soup',14),(1,'Sides & Salads',15),(1,'Pancake',16),(1,'Dessert',17),
    (1,'Coffee',18),(1,'Tea',19),(1,'Juice',20),(1,'Lassi',21),(1,'Milkshake',22);

    INSERT INTO permissions (branchId) VALUES (1);

    INSERT INTO users (branchId, name, pin, pin_index, role, payRate, payType, authMethod) VALUES
    (NULL, 'Admin',         '9999', '888df25ae35772424a560c7152a1de794440e0ea5cfee62828333a456a506e05', 'admin',        0.00, 'hourly', 'pin'),
    (NULL, 'Super Manager', '1234', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'superManager', 0.00, 'hourly', 'pin'),
    (1,    'Manager',       '1111', '0ffe1abd1a08215353c233d6e009613e95eec4253832a761af28ff37ac5a150c', 'manager',     50.00, 'hourly', 'pin'),
    (1,    'Server One',    '2222', 'edee29f882543b956620b26d0ee0e7e950399b1c4222f5de05e06425b4c995e9', 'server',      30.00, 'hourly', 'pin'),
    (1,    'Cashier One',   '3333', '318aee3fed8c9d040d35a7fc1fa776fb31303833aa2de885354ddf3d44d8fb69', 'cashier',     30.00, 'hourly', 'pin'),
    (1,    'Kitchen One',   '4444', '79f06f8fde333461739f220090a23cb2a79f6d714bee100d0e4b4af249294619', 'kitchen',     30.00, 'hourly', 'pin');

    INSERT INTO order_sequences (branchId, currentNum) VALUES (1,0);
  `);

  seedGoldenBeachMenu();

  console.log('[db] Seeded Golden Beach Restaurant (1 branch, full menu, 6 users).');
}

// ── Golden Beach Restaurant — full menu (from the printed price lists) ──
// Station ids: 1 = Kitchen (hot food), 2 = Cold Station (desserts), 3 = Bar (drinks).
function seedGoldenBeachMenu() {
  const KITCHEN = 1, COLD = 2, BAR = 3;
  const pizzaMods = JSON.stringify([
    { id: 5001, name: 'Extras', options: [
      { option: 'Extra Cheese', priceDelta: 300 },
      { option: 'Extra Topping', priceDelta: 400 },
    ] },
  ]);

  // [category, stationId, [ [name, price, modifiersJSON?], ... ] ]
  const MENU = [
    ['Breakfast', KITCHEN, [
      ['Avocado Toast (Two Fried Egg)', 1000],
      ['Sri Lankan Breakfast (Coconut Roti or Hoppers, Dhal Curry, Tea/Coffee)', 800],
      ['Saksuka (Two Bread)', 800],
      ['Bali Breakfast (Two Fried Egg, Two Bread, Avocado, Vegetable Salad)', 1000],
      ['English Breakfast (Two Egg, Bread, Butter, Jam, Two Sausage, Tea/Coffee)', 1200],
      ['Fruit Platter', 700],
      ['Power Porridge', 1250],
      ['Muesli', 1250],
    ]],
    ['Rice & Curry', KITCHEN, [
      ['Vegetable Rice & Curry', 600],
      ['Egg Rice & Curry', 700],
      ['Fish Rice & Curry', 900],
      ['Chicken Rice & Curry', 900],
      ['Prawns Rice & Curry', 1300],
    ]],
    ['Fried Rice', KITCHEN, [
      ['Vegetable Fried Rice', 600],
      ['Vege & Egg Fried Rice', 700],
      ['Vege & Cheese Fried Rice', 900],
      ['Veg, Egg & Fish Fried Rice', 1000],
      ['Veg, Egg & Chicken Fried Rice', 1000],
      ['Veg, Egg, Chicken & Cheese Fried Rice', 1300],
      ['Veg, Egg, Chicken & Prawns Fried Rice', 1500],
      ['Veg, Egg, Chicken, Cheese & Prawns Fried Rice', 1750],
    ]],
    ['Noodles', KITCHEN, [
      ['Vegetable Noodles', 600],
      ['Vege & Egg Noodles', 700],
      ['Veg, Egg & Fish Noodles', 1000],
      ['Veg, Egg & Chicken Noodles', 1000],
      ['Veg, Egg, Chicken & Cheese Noodles', 1400],
      ['Veg, Egg, Chicken & Prawns Noodles', 1500],
      ['Veg, Egg, Chicken, Cheese & Prawns Noodles', 1750],
    ]],
    ['Kottu', KITCHEN, [
      ['Vegetable Kottu', 600],
      ['Egg Kottu', 800],
      ['Egg & Fish Kottu', 1000],
      ['Egg & Chicken Kottu', 1000],
      ['Egg & Cheese Kottu', 900],
      ['Egg, Chicken & Cheese Kottu', 1350],
    ]],
    ['Pasta', KITCHEN, [
      ['Vegetable Pasta', 650],
      ['Vege & Egg Pasta', 750],
      ['Vege & Cheese Pasta', 850],
      ['Veg, Egg & Fish Pasta', 1000],
      ['Veg, Egg & Chicken Pasta', 1000],
      ['Veg, Egg, Chicken & Cheese Pasta', 1350],
    ]],
    ['Devil', KITCHEN, [
      ['Vegetable Devil (with steamed rice)', 800],
      ['Fish Devil (with steamed rice)', 1500],
      ['Chicken Devil (with steamed rice)', 1500],
      ['Prawns Devil (with steamed rice)', 1800],
    ]],
    ['Steam Hoppers', KITCHEN, [
      ['Steam Hoppers with Dhal', 400],
      ['Steam Hoppers with Dhal & Coconut Sambal', 500],
      ['Steam Hoppers with Curry', 600],
    ]],
    ['Roti', KITCHEN, [
      ['Coconut Roti', 200],
      ['Roti with Vegetable', 300],
      ['Roti with Dhal', 400],
      ['Roti with Sweet', 400],
      ['Roti with Eggs', 400],
      ['Roti with Chocolate', 500],
      ['Roti with Cheese', 500],
      ['Roti with Chicken', 500],
      ['Roti with Egg & Chicken', 600],
      ['Roti with Cheese & Coconut Sambol', 600],
      ['Roti with Cheese & Vege', 600],
      ['Roti with Cheese & Tomato', 600],
      ['Roti with Chocolate & Banana', 600],
      ['Roti with Chocolate, Banana & Coconut', 700],
      ['Roti with Cheese & Avocado', 750],
      ['Roti with Cheese, Vege & Avocado', 800],
      ['Roti with Cheese, Vege & Chicken', 800],
      ['Roti with Cheese, Vege, Egg & Chicken', 900],
      ['Roti with Cheese, Vege, Chicken & Avocado', 1000],
      ['Nutella Roti', 1000],
    ]],
    ['Egg Omelette', KITCHEN, [
      ['Two Eggs Omelette', 200],
      ['Two Eggs with Vegetables', 400],
      ['Two Eggs with Tomato', 400],
      ['Two Eggs with Potato', 400],
      ['Four Eggs Omelette', 400],
      ['Two Eggs with Cheese', 500],
      ['Two Eggs with Cheese & Chicken', 700],
    ]],
    ['Pizza', KITCHEN, [
      ['Margherita Pizza (Medium)', 1700, pizzaMods],
      ['Vegetarian Pizza (Medium)', 1800, pizzaMods],
      ['Pineapple Pizza (Medium)', 2000, pizzaMods],
      ['Chicken Pizza (Medium)', 2200, pizzaMods],
      ['Tuna Pizza (Medium)', 2200, pizzaMods],
      ['Garlic Prawns Pizza (Medium)', 2800, pizzaMods],
      ['Mix Seafood Pizza (Medium)', 2800, pizzaMods],
    ]],
    ['Burger', KITCHEN, [
      ['Vegetable Burger', 750],
      ['Vege & Egg Burger', 850],
      ['Chicken Burger', 1000],
      ['Tuna Burger', 1000],
      ['Egg & Chicken Burger', 1100],
      ['Prawns Burger', 1500],
      ['Vege, Egg & Chicken Burger', 1500],
      ['French Fries', 700],
    ]],
    ['Sandwiches', KITCHEN, [
      ['Egg Sandwich', 600],
      ['Chicken Sandwich', 800],
      ['Fish Sandwich', 800],
      ['Prawns Sandwich', 1250],
    ]],
    ['Soup', KITCHEN, [
      ['Vegetable Soup', 400],
      ['Vegetable & Noodles Soup', 500],
      ['Pumpkin Soup', 500],
      ['Chicken & Vegetable Soup', 650],
      ['Chicken, Vegetable & Noodles Soup', 750],
    ]],
    ['Sides & Salads', KITCHEN, [
      ['Steam Vegetables', 700],
      ['Steam Potato', 600],
      ['Vegetable Salad', 600],
      ['Vege / Avocado / Prawns Salad', 2000],
      ['Batter Prawns (sautéed in butter, with steamed rice & garden salad)', 1800],
    ]],
    ['Pancake', KITCHEN, [
      ['Coconut Pancake', 300],
      ['Banana Pancake', 300],
      ['Chocolate Pancake', 450],
      ['Chocolate & Banana Pancake', 550],
      ['Chocolate, Banana & Coconut Pancake', 650],
      ['Nutella Pancake', 700],
    ]],
    ['Dessert', COLD, [
      ['Vanilla Ice Cream', 400],
      ['Chocolate Ice Cream', 500],
      ['Chocolate Brownie Bread with Ice Cream', 800],
      ['Banana Bread', 400],
      ['Fruit Salad', 600],
    ]],
    ['Coffee', BAR, [
      ['Espresso', 500],
      ['Americano', 600],
      ['Cappuccino', 700],
      ['Ice Latte', 800],
      ['Double Espresso', 800],
      ['Sri Lankan Black Coffee', 250],
      ['Sri Lankan Milk Coffee', 350],
    ]],
    ['Tea', BAR, [
      ['Black Tea', 100],
      ['Milk Tea', 200],
    ]],
    ['Juice', BAR, [
      ['Banana Juice', 400],
      ['Papaya Juice', 500],
      ['Lime Juice', 500],
      ['Ginger Juice', 500],
      ['Watermelon Juice', 600],
      ['Mango Juice', 600],
      ['Pineapple Juice', 600],
      ['Mix Juice', 750],
      ['Passion Fruit Juice', 600],
      ['Avocado Juice', 700],
    ]],
    ['Lassi', BAR, [
      ['Banana Lassi', 600],
      ['Papaya Lassi', 650],
      ['Pineapple Lassi', 700],
      ['Mango Lassi', 700],
      ['Avocado Lassi', 800],
    ]],
    ['Milkshake', BAR, [
      ['Vanilla Milkshake', 900],
      ['Chocolate Milkshake', 1000],
      ['Mango Milkshake', 1200],
      ['Mango Banana Milkshake', 1300],
    ]],
  ];

  const ins = db.prepare(
    `INSERT INTO menu_items (branchId, name, price, category, plu, stationId, recipe, modifiers)
     VALUES (1, ?, ?, ?, ?, ?, '[]', ?)`
  );
  let plu = 1000;
  for (const [category, stationId, items] of MENU) {
    for (const [name, price, mods] of items) {
      plu += 1;
      ins.execute([name, price, category, String(plu), stationId, mods || '[]']);
    }
  }
}

// Give every table a QR token. Runs after seeding (so seeded tables get one)
// and on every boot (idempotent — only touches tables still missing a token).
function ensureTableTokens() {
  try {
    const rows = db.query("SELECT id FROM tables_list WHERE qrToken IS NULL OR qrToken=''").fetchAll();
    for (const r of rows) {
      let tok = '';
      for (let i = 0; i < 16; i++) tok += 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)];
      db.prepare('UPDATE tables_list SET qrToken=? WHERE id=?').execute([tok, Number(r.id)]);
    }
  } catch (e) { /* ignore */ }
}

migrate();
seedIfEmpty();
ensureTableTokens();

module.exports = { db, DB_FILE, DATA_DIR, raw };
