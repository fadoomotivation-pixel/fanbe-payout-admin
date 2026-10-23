# Fanbe Payout Admin — what this repo is, and what it is not

Internal CRM for **Fanbe Group**: real-estate plots sold on EMI through an
affiliate network and through traditional brokers. Lives at
`admin.fanbegroup.com`. React + Vite + TypeScript, Supabase, Vercel.

## Dholera is NOT part of this project

**Dholera has nothing to do with Fanbe.** Dholera news, the Dholera sales
agent, Dholera content of any kind — none of it belongs in this repo, this
database or this app. It lives in the separate **`cap`** project.

If a request mentions Dholera while this repo is open, it has most likely
landed in the wrong chat. Say so and confirm which project is meant before
building anything.

## The website and its leads are NOT part of this project either

**www.fanbegroup.com is a separate thing.** A client landing on the website, the form
they fill, and anything to do with sending those leads out on WhatsApp — none of it is
the payout admin's job. Admin: *"ye lead waha se ayegi www.fanbegroup.com pr koi client
aata h, iska payout admin lena dena nahi."*

The confusion is easy to fall into, because the `leads` table those leads land in lives
in **this** database — it belongs to the call-centre CRM, which shares it. This app only
reads it, to display. Nothing here writes a lead, and nothing here sends a WhatsApp
message: `lib/whatsapp.ts` only builds a `wa.me` click-link that a person presses.

If a question is about leads arriving, lead notifications, or WhatsApp delivery, say that
it is the website / call-centre side before investigating anything in this repo.

## The databases

| Project | Ref | What it is |
|---|---|---|
| **Fanbe-CRM** | `mfgjzkaabyltscgrkhdz` | This app. All SQL goes here. |
| SalesAutoCall | `rqgkzamuohdvttnkluzn` | A different product. SQL has been pasted here by mistake before — every migration carries a guard that aborts if `public.is_staff()` or the expected table is missing. |

The call-centre CRM shares the Fanbe-CRM database. **Never write to**
`leads`, `calls`, `hr_*`, `attendance`, `profiles`, `crm_*`, `site_visits`,
`tasks`, `employee_leads`. Reading them to display is fine.

## Commission is written in exactly one place

`recompute_booking_payouts(booking_id)` — nothing else may insert into
`payout_distributions`. TDS 5% and admin 10% are deducted once, at credit.

It is fired by triggers on `bp_payments` (amount / verification_status /
booking_id) and on `bp_bookings.broker_id`.

Three things must all be true before a booking pays anybody:

1. a broker on the booking,
2. a payment that is **verified**,
3. a commission set — a %, a ₹/gaj rate, or `bp_booking_brokers` rows.

**Traditional split beats everything.** When `bp_booking_brokers` has rows and
the booking is traditional, the function pays those rows and ignores
`bp_bookings.broker_id` completely. Anything that moves a booking's broker must
move the split row too, and must do it *first* — the booking's own update is
what fires the recompute.

`traditional_pay_upline` is a trap: it routes a traditional sale into the
Affiliate cascade, which reads percentages from `commission_ranks` via
`brokers.rank`. Traditional brokers have no real rank but the form defaults the
column to `'Executive'` — a live 5% slab. It is forced `false` everywhere.

## Working agreements

- Ship through a PR merged to `main`. A merged PR is finished: restart the
  branch from `main` for follow-up work rather than stacking on merged history.
- Migrations are run by hand in the Supabase SQL editor, so any new column must
  be **feature-detected** in the app — the deploy lands before the SQL does.
- Reply in **Hinglish**. Write **UI copy in simple English**.
- Verify against the live database, not against assumptions. The test harness
  mocks Supabase and does **not** enforce constraints — a `CHECK` violation will
  pass there and fail in production.

## Dead code — do not bother with it

`src/pages/<subfolder>/*`, `src/pages/EMI.tsx`, `src/hooks/usePlots.ts`.
