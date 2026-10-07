# Single-store grocery ordering

The customer storefront and staff dashboard use the same server-side SQLite database. A physical counter sale entered in the dashboard reduces the stock shown online; a placed online order reduces that same stock in one database transaction. The database and order history persist across browser refreshes and server restarts. The initial catalogue is deliberately empty (categories are ready) so sample products or sample quantities are never offered to real customers.

## Run locally

Requires Node.js 22.5 or newer. Open PowerShell in the project folder and run:

```powershell
$env:ADMIN_PASSWORD = "choose-a-long-private-password"
npm start
```

Open `http://127.0.0.1:3000`. Keep the server running while using the storefront. The first start creates `data/store.sqlite` from `database.sql`; later starts preserve the saved catalogue, stock, and orders. Back up that database file regularly.

Run the backend checks with:

```powershell
npm test
```

## Set up your shop

1. Open **Store dashboard** and sign in with the server's `ADMIN_PASSWORD`.
2. Add products from your actual shop with their category, selling price, MRP, pack size, and opening stock.
3. Record each physical counter sale under **Counter sales & stock**. Use **Restocked from supplier** for deliveries and **Set actual counted stock** for a physical stock count.
4. Accept online orders in the dashboard, prepare and deliver them, then move their status forward. Cancelling an undelivered order returns its units to available stock.

The staff password is not stored in the browser. Staff sessions are temporary and end when the server restarts or the session expires.

## What is and is not connected

- This version is a single-store MVP. Staff must enter counter sales in this dashboard for online stock to stay synchronized. A separate POS/billing app is **not** automatically connected yet. To automate that, the POS vendor and its API/export format are needed.
- Customer orders currently use **Cash on Delivery**. Real UPI/card payments need a payment-provider merchant account and a server-side gateway integration; this app intentionally does not collect card/UPI credentials or claim a demo payment succeeded.
- Customer details are an optional convenience saved in that browser, not a verified account or OTP sign-in.
- The store address, delivery fee, service area, and delivery estimates are not configured yet. Set these to your real store policies before launch.

## Before serving real customers

Deploy the Node server on a host that stays online and provides persistent disk for `data/store.sqlite`. Put it behind HTTPS, set a strong private `ADMIN_PASSWORD`, configure your real store details and delivery area, and test backups/restore. Do not expose the development server directly to the public internet. If your POS can provide live stock events or an API, integrate it as the stock source of truth instead of relying on staff to enter every counter sale.
