// Which drawer did the money go through?
//
// Cash, bank transfer and cheque are three different control problems: cash has to be
// counted against a signed voucher, a transfer leaves its own trail at the bank, and a
// cheque is not money at all until it clears.  The Expenses page split spend this way, and
// the Day Book needs the same split for collections and payouts — so the rule lives here
// once rather than being re-decided per page and drifting apart.

export type ModeBucket = 'cash' | 'bank' | 'cheque'

const BANK_MODES = ['neft', 'rtgs', 'imps', 'upi', 'bank', 'online', 'dd', 'transfer']

export function modeBucket(mode: string | null | undefined): ModeBucket {
  const m = (mode || '').trim().toLowerCase()
  if (m === 'cheque' || m === 'check') return 'cheque'
  if (BANK_MODES.includes(m)) return 'bank'
  // Anything unrecognised or blank counts as cash.  Unlabelled money is far more likely to
  // have gone through the drawer, and over-reporting cash is the safer error: it makes
  // someone look for a voucher, rather than letting cash slip by as "probably a transfer".
  return 'cash'
}

export function isCashMode(mode: string | null | undefined): boolean {
  return modeBucket(mode) === 'cash'
}

export const BUCKET_LABEL: Record<ModeBucket, string> = {
  cash:   'Cash',
  bank:   'Bank / UPI',
  cheque: 'Cheque',
}
