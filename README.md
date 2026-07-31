# BrokerPay Pro — Real Estate MLM Commission & Payout Admin

A complete admin panel for real-estate companies running an MLM / referral-broker model: track customer bookings, calculate multi-level differential commissions per payment, manage broker withdrawals, KYC, and rank-based programs — all from one dashboard.

Built on React 18 + TypeScript + Vite + Tailwind CSS + Supabase.

---

## What's inside

- **Admin dashboard** — operational health at a glance, live activity feed, top-broker leaderboard, MoM revenue deltas
- **Analytics** — financial KPIs, 6-month revenue/booking trends, sales funnel, top brokers, top projects
- **Sales pipeline** — inquiries → qualified leads → customer pipeline with bookings, payments, EMI schedule
- **Customer Pipeline** — paginated booking management with per-customer focus view (cost, paid, outstanding, overdue EMIs)
- **Brokers** — broker master list, profile pages, downline tree, login management (create/reset password)
- **KYC review** — admin approves/rejects broker documents; brokers upload from their own portal
- **Differential payout engine** — per-payment MLM distribution with the "highest-so-far floor" rule so upline rank reversals can't over-pay
- **Payout cycles** — admin batches unpaid commissions into payout cycles with race-safe cycle stamping
- **Withdrawals** — 4-step pipeline (Pending -> Approved -> Money sent -> Locked) with KYC gating, UTR uniqueness, and audit lock
- **Programs** — Achievers Club (lifetime sqyd leaderboard) + Team Rewards (tiered bonuses)
- **Commission ranks** — 15-rank ladder configuration with per-rank commission % and qualification rules
- **Broker portal** — brokers see their earnings, customers (with payment + EMI detail), team, withdrawal requests, KYC docs upload
- **Receipts & forms** — printable payment receipts, application forms, broker statements
- **Reports & CSV export** — admin-editable transaction reports

## Tech stack

| Layer | Tech |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, React Router 6, React Query, Tailwind CSS, Lucide icons |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) |
| Hosting | Static frontend (Vercel / Netlify / Cloudflare Pages / any) |

## Getting started

See **INSTALL.md** for the full step-by-step setup. Quick version:

1. Create a Supabase project
2. Run the SQL migrations in `supabase/migrations/` (apply in chronological order)
3. Copy `.env.example` to `.env` and fill in your Supabase URL + anon key
4. `npm install && npm run dev`
5. Deploy `npm run build` output to Vercel / Netlify / your host

## Branding

All company strings are in **one file**: `src/lib/branding.ts`. Edit it once after install — every page (sidebar, login, broker portal, receipts, WhatsApp templates) reads from these constants.

```ts
export const BRAND = {
  product: 'BrokerPay Pro',
  company: 'Your Company',
  tagline: 'Broker Payout Admin',
  address: 'Your registered office address',
  email: 'contact@yourcompany.com',
  website: 'www.yourcompany.com',
  phone: '',
  applicationTagline: 'Success Starts Here',
}
```

## License

This project is licensed under the **Envato Marketplace Standard License**. See `LICENSE.txt` for details. One license per end product.

## Support

Support and updates are available through your Envato CodeCanyon item page. Please open a support ticket there for any installation or customization questions.
