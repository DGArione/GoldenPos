# RapidPOS Thermal Print Agent

A tiny, dependency-free helper that prints KOTs and receipts straight to an
ESC/POS thermal printer, so the POS never has to open the browser's print
dialog (which drops the till out of full-screen).

## Why

The POS runs in a browser. Browsers can't talk to a USB/serial printer
directly, and `window.print()` always shows a dialog. This agent runs locally
on the till computer, listens for print jobs from the POS over HTTP, and writes
ESC/POS bytes to your printer.

## Run it

```bash
# Dry run — jobs print to the console so you can see the formatting
node agent.js

# USB / character device (Linux)
PRINTER=/dev/usb/lp0 node agent.js

# Network / Wi-Fi printer (most support raw port 9100)
PRINTER=tcp://192.168.1.50:9100 node agent.js
```

Environment variables:

| Var       | Default            | Meaning                                              |
|-----------|--------------------|------------------------------------------------------|
| `PORT`    | `9110`             | Port the agent listens on                            |
| `PRINTER` | `stdout`           | `stdout`, a device path, or `tcp://host:port`        |
| `CORS`    | `*`                | Allowed browser origin                               |

## Point the POS at it

In the POS: **Settings → Printing**

1. Tick **Use a thermal print agent**
2. **Agent URL:** `http://localhost:9110/print`
3. Pick your **paper width** (80mm = 48 cols, 58mm = 32 cols)
4. **Save**, then **Test print**

KOTs now print automatically on send (when KOT printing is on in Order Entry),
and **Reprint Bill** in History prints the receipt — both with no dialog.

## Notes

- Serve the POS over **http** on the till (or give the agent a TLS cert), since
  an https page can't call an http agent (mixed content).
- The agent sends an init sequence and a partial cut around each ticket. If your
  printer needs a full cut or a drawer kick, adjust `CUT`/add codes in `agent.js`.
- Run it on boot with a systemd unit, pm2, or a Startup shortcut.


## Windows USB printers (Golden POS)

On Windows, install both USB thermal printers under **Settings → Bluetooth & devices → Printers & scanners**. Golden POS starts this print agent automatically when you run `npm start`. The agent discovers Windows printers at `http://localhost:9110/printers`.

In Golden POS, open **Settings → Printer management**, click **Refresh printer list**, choose one printer for **Kitchen printer — KOT tickets** and the other for **Payment printer — bills & receipts**, then click **Save printer settings**. Use the two Test buttons before service. KOTs are routed to the kitchen printer; bills/receipts are routed to the payment printer.

The Windows route uses the installed Windows printer driver (`Out-Printer`), so the driver controls paper size and cutter behavior. Set the correct receipt paper size in **Windows Printing Preferences** for each thermal printer. The print agent listens on loopback only because the USB printers are attached to this computer.
