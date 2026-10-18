# Golden POS — Local hosting on the POS terminal (Windows)

This sets the GLeam / DBL POS terminal up as an **always-on, self-starting till**:

- Power on → Windows boots → POS server starts by itself (before login)
- Cashier logs in → POS opens **full-screen** automatically
- Bill prints **silently** on payment, cash drawer **opens by itself** on cash
- Every bill is **logged to disk automatically** and the database is **backed up daily**
- If anything crashes it **restarts by itself**; power-cut safe

---

## 1. One-time preparation (≈15 min)

1. **Install Node.js 22 LTS** (or newer) from nodejs.org → choose the default "install for all users".
2. **Install Google Chrome** (Edge works too, Chrome preferred).
3. **Install both thermal printers** in Windows (Settings → Bluetooth & devices → Printers & scanners) and print a Windows test page from each. Note their **exact names** (e.g. `XP-80C` and `XP-80C (Kitchen)`).
4. Connect the **cash drawer RJ11 cable to the payment (receipt) printer** — the printer fires the drawer.
5. Set the Wi-Fi/Ethernet network to **Private** (Settings → Network → Properties) so tablets can connect.
6. BIOS (optional but recommended): set **"Restore on AC power loss" = Power On**, so the till turns itself back on after a power cut.

## 2. Install (double-click)

Double-click **`INSTALL-POS.cmd`** in the project folder, while logged in to the Windows account the cashier uses, and click **Yes** when Windows asks for permission. Wait until it says **DONE**.

(Technicians can still run `deploy\windows\install.ps1` directly with options such as `-BackupDir "D:\GoldenPOS-Backups"` to copy every daily backup to another drive / USB.)

The installer:

| Step | What happens |
|---|---|
| Copy | Installs to **`C:\GoldenPOS`** (off the Desktop/OneDrive — SQLite must not live in a synced folder). Existing `backend\data` is kept. |
| Build | `npm install` + **production build** of the UI (first load ~0.1 s instead of ~15 s compile in dev mode). |
| Auto-start | Scheduled task **"GoldenPOS Server"** — runs at **boot** as SYSTEM, restarts every minute if stopped, no time limit. |
| Kiosk | Startup shortcut opens Chrome **full-screen** with `--kiosk-printing` (no print dialog, no "Save as PDF"), its own profile (no "Restore pages?" bar), and re-opens itself if closed. |
| Firewall | Port **3000** open on **Private** networks only. 3001 (API) and 9110 (printer agent) stay internal. |
| Power | Never sleep, monitor always on, **USB selective-suspend off** (printers/drawer never drop), Fast Startup off, Windows Update active hours 06:00–23:00. |
| Printer | Sets the payment printer as the Windows default (only used if the browser fallback ever prints). |

## 3. Configure printers in the POS (once)

Log in as **Admin (9999)** → **Settings → Printer management**:

1. Tick **Enable direct thermal printing**
2. **Refresh printer list** → choose **Kitchen printer** and **Payment printer**
3. Paper width **80 mm** → **Save printer settings** → **Test** both

## 4. Sign-in without a password prompt (optional, recommended for a till)

Use Microsoft's free **Sysinternals Autologon** tool (learn.microsoft.com/sysinternals) → enter the cashier account → Enable. The password is stored encrypted, and after a power cut the till comes all the way back to the POS screen without anyone touching it.

**Then restart the PC once** and confirm: it boots → logs in → POS full-screen.

---

## How the automation works now

| Event | What happens automatically |
|---|---|
| Order sent to kitchen | KOT prints on the kitchen printer (also from waiter tablets on Wi-Fi — routed through the till) |
| **Cash** payment | Bill prints on the payment printer **and the drawer kick is inside the same print job** → drawer opens instantly as the bill starts |
| Card payment | Bill prints, drawer stays closed |
| Printer offline | Payment is still saved; a red toast tells the cashier; the bill is still logged |
| Every bill / KOT | Appended to `C:\GoldenPOS\backend\data\print-log\YYYY-MM\YYYY-MM-DD-receipts.log` (and `-kot.log`) |
| Database | `C:\GoldenPOS\backend\data\pos.db` — WAL mode, full fsync (power-cut safe) |
| Backups | Daily snapshot at start-up + after 23:30 → `backend\data\backups\pos-YYYY-MM-DD.db`, newest 30 kept (+ mirror folder if `-BackupDir`) |
| A service crashes | Supervisor restarts it in 1 s → 2 s → … max 30 s; the scheduled task restarts the supervisor itself |
| Logs | `C:\GoldenPOS\logs\` (`launcher`, `backend`, `agent`, `web`) — auto-rotated at 10 MB |

## Daily management

Double-click **Golden POS Control** on the desktop: check it's running, restart, backup now, open the bill log, leave full-screen.

- **Leave full-screen** for maintenance: `deploy\windows\exit-kiosk.cmd` (re-open: "Golden POS" desktop shortcut).
- **Restore a backup**: stop the server (control panel → 3), copy `backups\pos-YYYY-MM-DD.db` over `backend\data\pos.db`, delete `pos.db-wal` and `pos.db-shm`, start the server.
- **Update to a new version**: extract the new version anywhere and double-click its `INSTALL-POS.cmd`. Code is replaced, data is kept, UI is rebuilt.
- **Remove auto-start**: `deploy\windows\uninstall.ps1` (data is not deleted).

## Table QR ordering (customers order from their phone)

**How it works:** customer sits down → scans the QR on the table → sees the menu on their phone → places the order → the cashier gets a big pop-up + a number on the bell → **Online Orders → Table Orders → Accept & send to kitchen** → the kitchen ticket prints.

Because the POS runs on this computer, the customer's phone must be on the **restaurant Wi-Fi**, and the QR code contains this computer's address (e.g. `http://192.168.1.25:3000`). The address must **never change**, otherwise every printed QR stops working.

### 1. Fix the computer's address (do this once — 5 minutes in the router)
Use **DHCP reservation** (also called "Address Reservation", "Static Lease" or "Bind IP to MAC") in the Wi-Fi router:
1. On the POS computer, open Command Prompt and run `ipconfig /all`. Note the **IPv4 Address** (e.g. `192.168.1.25`) and **Physical Address** (MAC, e.g. `A4-5E-60-xx-xx-xx`) of the Wi-Fi or Ethernet adapter in use.
2. Open the router page in a browser (usually `http://192.168.1.1` or `192.168.8.1` — it's printed on the router label; Dialog / SLT / Mobitel routers all have this).
3. Find **LAN / DHCP → Address Reservation** (or **Static DHCP**), add the MAC and IP from step 1, save, and restart the router once.
4. The computer now always gets the same address, even after restarts and power cuts.

> Prefer an Ethernet cable for the POS computer if the router is near — it's more reliable than Wi-Fi.

### 2. Tell the POS the address
**Settings → Online ordering & QR** shows *"This computer's address right now"*. Press **Use this computer's address**, fill in the **Wi-Fi name and password** (printed on the table cards so customers can join with one scan), then **Save changes**.

### 3. Print the table cards
**Floor → Print all table QR cards** (or tap a table → **QR code → Print table card**). Each card has: ① a QR to join the Wi-Fi, ② a QR to open the menu for that table. Laminate and put one on each table.

### If the address ever changes
The POS checks it for you: a **red warning** appears in *Settings → Online ordering & QR*, in each table's QR window and in **System Admin → Health check**. Fix the router reservation, press *Use this computer's address*, Save, and reprint the cards.

### Wi-Fi rules for QR ordering
- Customers must join the **same Wi-Fi network** as the POS computer.
- Turn **off "AP / client isolation"** (often on for "Guest" networks) — it stops phones reaching the POS.
- Customers on **mobile data**: see the next section.

## Customers on mobile data (online QR ordering)

Double-click **`SETUP-ONLINE-ORDERING.cmd`** on the POS computer. It publishes **only the table menu and "place order"** to the internet through a secure tunnel — the POS stays on this computer, no router changes or port forwarding.

```
Customer phone (mobile data) ─► https://order.your-domain ─► Cloudflare/Tailscale tunnel
      ─► customer gateway on this PC (127.0.0.1:3100) ─► POS
```

**What is reachable from the internet:** the table menu page, the menu, "place order" and "reserve a table" — nothing else. Staff screens, PIN login, admin, reports, data export and printers all answer *404* from outside (tested). Orders still wait for the cashier to **Accept & send to kitchen**, and each phone is limited to 8 orders per 10 minutes (30 per table per hour) so a leaked QR can't flood the kitchen.

| Option | Address | Needs | Best for |
|---|---|---|---|
| **1 Cloudflare Tunnel** (recommended) | `https://order.goldenbeach.lk` — permanent | A domain added to a free Cloudflare account | Printed QR cards for years |
| **2 Tailscale Funnel** | `https://golden-pos.tailXXXX.ts.net` — permanent | Free Tailscale account, no domain | No domain yet |
| **3 Quick test** | `https://random-words.trycloudflare.com` — changes every time | Nothing | Trying it out only — don't print |

After setup:
1. **Settings → Online ordering & QR** → paste the https address into *QR code address* → **Save changes**.
2. **Floor → Print all table QR cards** (one QR now works on Wi-Fi *and* mobile data).
3. Test with Wi-Fi switched **off** on a phone.

Notes:
- The tunnel runs as a Windows service and starts by itself after restarts/power cuts, like the POS.
- If the restaurant's **internet** is down, phones can't reach the menu from outside (staff screens keep working). Customers on the restaurant Wi-Fi can still use the local address — keep a few local-address cards at the counter as a backup if internet is unreliable.
- To switch it off: run `SETUP-ONLINE-ORDERING.cmd` → option **4**.

## Waiter tablets / phones on the same Wi-Fi## Troubleshooting

| Problem | Fix |
|---|---|
| POS screen doesn't open after login | `pos-control.cmd` → 1 (Status). If DOWN, see `logs\launcher.log` |
| "Printer list empty" in Settings | Printer must be installed for **all users** (local USB printers are). If you added it as a per-user/network share, re-run install with `-RunAs User` |
| Bill prints but drawer doesn't open | Drawer cable must be in the **payment** printer; test with a cash payment. Some drawers need pin 5: change `0x00` to `0x01` in `DRAWER_KICK` in `backend\print-agent\agent.js` |
| Print dialog / "Save PDF" appears | Payment printer not selected in Printer management **or** POS opened in normal Chrome instead of the kiosk shortcut; also check the Windows default printer isn't "Microsoft Print to PDF" |
| Port in use | The launcher frees ports 3000/3001/9110 automatically on start |

## Moving to hybrid later

The structure is ready for it: the UI already talks to the API through `/api` and to printers through `/print-agent`, the database is one file with daily snapshots, and the print agent stays on the till. Hybrid = cloud copy of the API/DB + this till as the offline-capable edge with sync — a separate step when you're ready.
