// Building a wa.me link looks trivial until the phone number isn't.  Numbers in this
// database arrive as "9876543210", "+91 98765 43210", "091-9876543210" and worse, and
// wa.me accepts only digits with a country code.  Written once so every page that offers a
// reminder normalises the same way — the alternative is one screen quietly opening an
// empty chat while another works.

/** Digits only, with India's country code applied to bare 10-digit numbers. */
export function normalisePhone(raw: string | null | undefined): string | null {
  const digits = String(raw || '').replace(/[^\d]/g, '')
  if (!digits) return null
  // 0XXXXXXXXXX — the trunk prefix used when dialling domestically
  const noTrunk = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits
  if (noTrunk.length === 10) return '91' + noTrunk          // bare mobile number
  if (noTrunk.length === 12 && noTrunk.startsWith('91')) return noTrunk
  if (noTrunk.length > 12 && noTrunk.startsWith('0')) return noTrunk.replace(/^0+/, '')
  // Anything else already carries some country code — leave it as the operator gave it.
  return noTrunk.length >= 10 ? noTrunk : null
}

/** wa.me URL with the message pre-filled, or null when the number is unusable. */
export function waLink(phone: string | null | undefined, message: string): string | null {
  const num = normalisePhone(phone)
  if (!num) return null
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`
}
