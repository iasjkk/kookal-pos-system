# KOOKAL – Farm & Kitchen POS

Local restaurant POS with Admin, Manager and Cashier roles, SQLite persistence, per-item GST, sales reports and 80mm receipt printing.

## Requirements
- Windows 10/11
- Node.js 20 LTS or newer
- USB 80mm thermal printer installed in Windows with its manufacturer driver

## Install and run
Open PowerShell in this folder:

```powershell
npm install
Copy-Item server/.env.example server/.env
# Edit server/.env and set strong values for JWT_SECRET and INITIAL_ADMIN_PASSWORD
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4000/api
- SQLite database: `server/data/kookal.db` (created automatically)

## First login
- Username: `admin`
- Password: the value you set for `INITIAL_ADMIN_PASSWORD` in `server/.env`

The administrator is created only when the database has no users. Change the password after first login and create individual Manager and Cashier accounts from **Users**.

## USB thermal printing
The receipt is laid out for 80mm paper. Click **Pay & Print** or **Reprint** and choose your installed USB thermal printer in the Windows print dialog. In printer preferences, set paper width to 80mm, margins to None/Minimum, scale to 100%, and disable browser headers/footers.

The browser print dialog is intentional for this first version: standard browsers do not permit websites to silently access USB printers. For silent one-click ESC/POS printing, install and configure a local bridge such as QZ Tray in a later deployment step.

## GST
GST is stored per menu item as a percentage. The POS calculates tax as inclusive/exclusive according to the item's `GST inclusive` setting. The default is exclusive. Confirm the correct tax treatment, HSN/SAC and invoice requirements with your accountant before live use.

## Important operational notes
- Bills receive unique sequential bill numbers.
- A bill is not saved as paid until the payment action completes.
- Managers can cancel bills with a mandatory reason. Cancelled bills remain in the database and reports.
- Cashiers can create bills and reprint their own bills; they cannot cancel bills or access reports.
- This is a local single-machine starter. For multiple tills, network access, automated backup and production deployment, add authentication hardening, HTTPS and a shared server/database strategy.
- Back up `server/data/kookal.db` daily. Stop the server before manually copying the database.

## Menu structure
Meal period → Category (e.g. Beverages, Starters, Main Course) → Item.
Admins can add meal periods, categories and items. A category can be assigned to one or more meal periods in the UI by creating a category under a meal period.
