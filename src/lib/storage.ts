// Private-bucket file access.
//
// The `documents` bucket holds KYC scans — Aadhaar, PAN, cancelled cheques.  It used to be
// public, which means every one of those was readable by anyone who had (or guessed) the
// URL, with no login at all.  The bucket is private from migration 20261006 onward, so a
// stored URL no longer opens anything: a file has to be signed for, per view, and the link
// it gives back expires.
//
// Rows written before that migration hold a full public URL; rows written after hold the
// storage path.  Both have to keep working, which is what `storagePathFrom` is for.

import { supabase } from '@/lib/supabase'

const BUCKET = 'documents'

/** How long a signed link stays good.  Long enough to open and read a document, short
 *  enough that a link pasted into a chat is dead by the time anyone else clicks it. */
const SIGNED_URL_TTL_SECONDS = 5 * 60

/**
 * The path inside the bucket, given either a path or an old public/signed URL.
 *
 * Old rows look like
 *   https://<project>.supabase.co/storage/v1/object/public/documents/kyc/<id>/pan-123.jpg
 * and everything after `/documents/` is the path.  A value that is already a bare path is
 * handed back untouched.  Returns null for anything that is neither.
 */
export function storagePathFrom(value: string | null | undefined): string | null {
  const v = String(value || '').trim()
  if (!v) return null

  if (!/^https?:\/\//i.test(v)) return v.replace(/^\/+/, '')

  // Both /object/public/<bucket>/ and /object/sign/<bucket>/ appear in old data.
  const m = v.match(new RegExp(`/storage/v1/object/(?:public|sign)/${BUCKET}/(.+?)(?:\\?|$)`))
  if (m?.[1]) {
    try { return decodeURIComponent(m[1]) } catch { return m[1] }
  }
  return null
}

/**
 * A short-lived link that actually opens the file, or null if it cannot be signed.
 *
 * Signing fails when the caller is not allowed to read that object — which is the point:
 * a broker can sign only for files under their own `kyc/<their id>/` folder, the office
 * can sign for any.  Callers show a plain "can't open this" rather than a broken image.
 */
export async function signedDocUrl(value: string | null | undefined): Promise<string | null> {
  const path = storagePathFrom(value)
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

/** Does this file render as an image?  Checked on the stored path, never on the signed
 *  URL — a signed URL ends in `?token=...`, so testing it for an extension never matches. */
export function isImagePath(value: string | null | undefined): boolean {
  const path = storagePathFrom(value) || ''
  return /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(path)
}
