# Installation Guide

This guide walks you through deploying BrokerPay Pro from scratch in under 30 minutes.

## What you'll need

- A free **Supabase** account: https://supabase.com
- **Node.js 18+** installed locally
- A hosting account on **Vercel**, **Netlify**, **Cloudflare Pages**, or any static host

## Step 1 — Create your Supabase project

1. Go to https://app.supabase.com and create a new project.
2. Choose any region close to your users.
3. Wait ~2 minutes for it to provision.
4. From the project dashboard, copy these two values:
   - **Project URL** (Project Settings -> API -> Project URL)
   - **anon public key** (Project Settings -> API -> Project API keys -> anon public)

## Step 2 — Run the database migrations

The `supabase/migrations/` folder contains every SQL migration in chronological order. Run them all on your new project:

### Option A — Supabase CLI (recommended)

```bash
# Install the CLI if you don't have it
npm install -g supabase

# Link to your project (it will ask for your project ref)
supabase link --project-ref <YOUR_PROJECT_REF>

# Push all migrations
supabase db push
```

### Option B — Manual via the SQL editor

1. In the Supabase dashboard, open the **SQL Editor**.
2. Open each `.sql` file in `supabase/migrations/` in alphabetical order.
3. Paste each one into the SQL editor and click **Run**.

The migrations will create every table the app needs: brokers, bp_customers, bp_bookings, bp_payments, payout_distributions, withdrawal_requests, commission_ranks, and more.

## Step 3 — Deploy the two edge functions

Two edge functions handle privileged operations (creating broker logins, resetting passwords). They live in `supabase/functions/` and need to be deployed once:

```bash
supabase functions deploy create-broker-login
supabase functions deploy reset-broker-password
```

Both functions automatically use the service role internally — no extra secrets needed.

## Step 4 — Configure environment variables

In the project root, copy the example env file:

```bash
cp .env.example .env
```

Edit `.env` and paste in the two values from Step 1:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...your-anon-public-key-here
```

## Step 5 — Customize your branding

Open `src/lib/branding.ts` and replace the placeholder values:

```ts
export const BRAND = {
  product: 'BrokerPay Pro',             // browser tab title, login screen
  company: 'Your Company Name',         // sidebar, receipts, WhatsApp templates
  tagline: 'Broker Payout Admin',       // sidebar subtitle
  address: 'Your registered address',   // printed on every receipt
  email: 'contact@yourcompany.com',
  website: 'www.yourcompany.com',
  phone: '+91 ...',                     // optional
  applicationTagline: 'Success Starts Here',
}
```

Save and you're done — every page reads from this file.

## Step 6 — Create your first admin user

1. In Supabase dashboard -> **Authentication** -> **Users** -> **Add user** -> **Create new user**.
2. Set an email + password. **Auto-confirm** = true.
3. In the SQL editor, run:

```sql
INSERT INTO app_users (auth_user_id, role_id, active, name, email)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'admin@yourcompany.com'),
  (SELECT id FROM roles WHERE name = 'admin'),
  true,
  'Admin',
  'admin@yourcompany.com'
);
```

(Replace the email with the one you just created.)

## Step 7 — Run locally to verify

```bash
npm install
npm run dev
```

Open http://localhost:5173. Log in with the admin credentials from Step 6. You should land on the dashboard.

## Step 8 — Deploy to production

### Vercel (recommended)

1. Push the project to a GitHub repo.
2. Import the repo on https://vercel.com/new.
3. Vercel auto-detects Vite. Add the two environment variables from Step 4 in Project Settings -> Environment Variables.
4. Click **Deploy**.

### Netlify / Cloudflare Pages / your host

The build output is in `dist/` after `npm run build`. Upload that folder, set the two env vars in your host's UI, and you're done. The app is a pure static SPA.

## Step 9 — First-run admin tasks

Once you can log in:

1. **Commission Ranks** — review the default 15-rank ladder under `/commission-ranks`. Adjust `commission_pct` per rank to match your business plan.
2. **Payout Settings** — under `/payout-terms`, set TDS %, admin charge %, minimum withdrawal, and grace period.
3. **Bank Accounts** — add your company bank accounts under `/bank-accounts`.
4. **Projects + Plots** — add your real-estate projects and the plots under each project.
5. **Brokers** — add your first broker under `/brokers`. The system will auto-generate a login for them.
6. **Inquiries / Customer Pipeline** — start booking customers and recording payments.

The MLM commission engine runs **automatically** as a database trigger every time a payment is verified — no manual cron needed.

## Troubleshooting

**Build fails with "Missing Supabase environment variables"** — you forgot to set `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`. Set them in `.env` for local dev, or in your hosting dashboard for production.

**"Failed to create login" when adding a broker** — the edge function `create-broker-login` isn't deployed. Re-run Step 3.

**Broker login goes to the admin dashboard** — the broker's `auth_user_id` isn't linked to a row in `brokers`. Check the `brokers` table and make sure the auth user id matches.

**Receipts show "Your Company" instead of your company** — you didn't update `src/lib/branding.ts` (Step 5). Edit it and redeploy.

## Updating

When a new version of BrokerPay Pro ships:

1. Back up your database (Supabase dashboard -> Database -> Backups).
2. Pull the latest code.
3. Run any new SQL migrations.
4. Redeploy.

Your config in `src/lib/branding.ts` should be preserved (or copy it across if you've forked).
