// UTR uniqueness guard.
//
// A real bank-issued UTR / reference number is globally unique by definition — every NEFT/RTGS/IMPS
// transaction has exactly one.  If the same UTR appears twice in our system, either it's a
// typo, a copy-paste, or a misuse — and either way, reconciliation against the bank statement
// will fail.  Admins were entering UTRs at five different sites (withdrawal mark-paid, payout
// transaction modal, customer payment forms during booking / EMI / pipeline) and nothing
// rejected duplicates client-side.
//
// This helper checks all three tables that store UTRs — `withdrawal_requests.utr`,
// `bp_payout_transactions.utr_ref`, and `bp_payments.utr_ref` — and returns the first
// conflict.  Callers should toast the conflict message and bail before writing.
//
// `exclude` lets a caller skip its own row when editing (otherwise updates would
// false-positive on themselves).

import { supabase } from './supabase'

export type UtrConflict = { table: 'withdrawal' | 'payout_transaction' | 'payment'; id: string }

export async function findUtrConflict(
  rawUtr: string | null | undefined,
  exclude: { withdrawal?: string; payoutTxn?: string; payment?: string } = {},
): Promise<UtrConflict | null> {
  const utr = (rawUtr || '').trim()
  if (!utr) return null

  const wdQ = supabase.from('withdrawal_requests').select('id').eq('utr', utr).limit(1)
  if (exclude.withdrawal) wdQ.neq('id', exclude.withdrawal)
  const ptxQ = supabase.from('bp_payout_transactions').select('id').eq('utr_ref', utr).limit(1)
  if (exclude.payoutTxn) ptxQ.neq('id', exclude.payoutTxn)
  const pmtQ = supabase.from('bp_payments').select('id').eq('utr_ref', utr).limit(1)
  if (exclude.payment) pmtQ.neq('id', exclude.payment)

  const [wd, ptx, pmt] = await Promise.all([wdQ, ptxQ, pmtQ])
  if (wd.data?.length)  return { table: 'withdrawal',         id: wd.data[0].id }
  if (ptx.data?.length) return { table: 'payout_transaction', id: ptx.data[0].id }
  if (pmt.data?.length) return { table: 'payment',            id: pmt.data[0].id }
  return null
}

export function utrConflictMessage(c: UtrConflict): string {
  const where =
    c.table === 'withdrawal'         ? 'an existing withdrawal'
    : c.table === 'payout_transaction' ? 'a broker payout transaction'
    : 'a customer payment'
  return `UTR already used in ${where}. Please re-check the reference number.`
}
