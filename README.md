# Delivery Expense Tracker

Mobile-first Next.js application for recording water deliveries, bottle prices and payments. Neon PostgreSQL stores the ledger, user accounts, signed sessions, notification subscriptions and theme preferences. Amounts are stored as integer paise. Dates use Asia/Karachi.

## Reading the dashboard

**Remaining amount** is the unpaid portion of all recorded deliveries. Overpayments appear as advance credit. **Last payment** shows its amount, date and method. Expand it for the balance immediately after that payment and deliveries recorded since.

**Bottles with a balance** allocates payments to the oldest delivered bottles first, using each delivery's recorded price. For 10 bottles at Rs. 150 and a payment of Rs. 1,000, Rs. 500 remains. Three bottles are fully unpaid and one is partly paid with Rs. 50 outstanding. The lifetime delivery count is 10. Advance credit pays for subsequent deliveries.

Date ranges include both endpoints. The opening balance carries earlier transactions forward, and the closing balance includes all activity up to the end date. Reports include bottle counts, last payment and outstanding money, and support CSV download, sharing and print to PDF.

## Offline on a phone

Sign in online and keep the dashboard open until **Ready for offline use** appears. Optionally use your browser's **Add to Home Screen** or **Install app** command. Open the same site or installed app on that device when offline. You can read the saved ledger, view balances and reports, and add deliveries, payments and prices. Each new entry immediately updates the local balance. The pending count shows how many entries still need to reach Neon.

Keep the browser's site data until the pending count clears. The app syncs on reconnection, reopening and return to the foreground. Browsers that support Background Sync can also upload while the app is closed. Expired sessions require signing back into the same account. Confirmed deletions also sync from the offline queue. Editing existing records, account changes, and sign-out require a connection. Sign-out removes that account's cached ledger from the device.

## Account management

Administrators can create personal ledger accounts in Users. Sign in with either the username or email address. Settings supports changing email or password after confirming the current password. Other sessions are revoked on either change. Account management requires an internet connection.

## Install and deploy

Use Node.js 24 and a TLS-enabled Neon PostgreSQL connection. Copy `.env.example` to `.env.local` and set `DATABASE_URL` and a strong initial `ADMIN_PASSWORD`.

```sh
npm ci
npm run db:migrate
npm run dev
```

The migration creates the `delivery_expense` schema, signing and push keys, and the initial account **admin@sfk.com**. Repeated migrations preserve existing credentials and records. The server requires `DATABASE_URL` at runtime. For Vercel, set this as a production secret, select Next.js and Node.js 24, and deploy. This installation uses a scoped runtime role with access to the ledger schema. Use separate database credentials and database schemas for development and previews.

New sign-ups receive a single-use recovery key. Settings can replace it after password verification. Recovery revokes old sessions. An operator can run `npm run admin:recovery` to generate a fresh admin recovery key. For emailed reset links, set `APP_ORIGIN`, `RESEND_API_KEY` and a verified `MAIL_FROM`, then redeploy.

Set a rupee limit in Settings for a dated in-app notification on an upward crossing. Enable device alerts per browser over HTTPS. iOS web push requires installation on the Home Screen and notification permission.

## Bringing over existing records

`npm run import:sqlite -- /path/to/tracker.sqlite` copies one local snapshot into an empty hosted ledger. It preserves accounts, records, themes and alerts and retains the hosted administrator's bootstrap password. It ignores old sessions. A completed import is marked in PostgreSQL so a retry cannot duplicate the snapshot.

`npm run import:legacy` optionally copies records from the original Neon application's public deliveries, payments and bottle price tables into the administrator's ledger. Run this only for distinct history you intend to add.

## Verification

`npm test` runs lint, the Next.js production build, balance regressions and HTTP integration tests against a fresh disposable schema on the configured Neon database. These tests cover a 1,500-record fixture, concurrent payments, payment-only date ranges, edits, a 500-record deletion, advance credit, account isolation, recovery, session revocation, theme and threshold alerts. Tests require credentials that can create a temporary schema. The runtime-only production credentials have fewer privileges.

After building, `npm run test:browser` runs Chrome against another temporary schema and checks all seven tabs, mobile entry, reports, search, sharing, PDF rendering, partial payments and four responsive widths. Install Chrome or set `CHROME_PATH` to its executable. Test data is removed at the end of each run.
