import { supabase } from './supabase'

// Deleting a booking is the most destructive thing this app can do, and the database will
// not stop you: bp_payments, payout_distributions, bp_pdc_cheques and emi_schedules all
// carry ON DELETE CASCADE from bp_bookings.  One click would silently take the receipts,
// the broker's commission rows, the post-dated cheques and the EMI plan with it — no
// error, no warning, and nothing left to reconcile the books against.
//
// So the rule is: a booking that has money against it is never deleted, it is CANCELLED.
// Cancelling keeps every record, reverses the commission and frees the plot, and the
// Bookings page already does it.  Delete is only for a booking entered by mistake —
// nothing received, nothing paid out, nothing registered.
//
// Both the Bookings page and the Customer Pipeline call this, so the guards cannot drift
// apart between the two screens.

export type DeleteBlock = { reason: string; detail: string; suggestCancel: boolean }

/**
 * Everything that makes a booking un-deletable, gathered in one round of queries so the
 * UI can explain the block before the admin commits to it.
 * Returns [] when the booking is safe to remove.
 */
export async function checkBookingDeletable(booking: any): Promise<DeleteBlock[]> {
  const blocks: DeleteBlock[] = []
  const id = booking?.id
  if (!id) return [{ reason: 'Booking not found', detail: 'No booking id was supplied.', suggestCancel: false }]

  // A completed registry is a legal record of a transfer.  It is never deleted from here.
  if (booking.registry_completed_at || booking.registry_date) {
    blocks.push({
      reason: 'Registry is done',
      detail: 'This plot has been registered in the customer\'s name. Remove the registry entry on the Registry page first if that was a mistake.',
      suggestCancel: false,
    })
  }

  const [payRes, distRes, chqRes] = await Promise.all([
    supabase.from('bp_payments').select('id, amount, verification_status').eq('booking_id', id),
    supabase.from('payout_distributions').select('id, cycle_id').eq('booking_id', id),
    supabase.from('bp_pdc_cheques').select('id, status').eq('booking_id', id),
  ])

  const verified = (payRes.data || []).filter((p: any) => p.verification_status === 'verified')
  if (verified.length > 0) {
    const total = verified.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
    blocks.push({
      reason: 'Money has been received',
      detail: `${verified.length} receipt${verified.length === 1 ? '' : 's'} totalling ₹${total.toLocaleString('en-IN')} are recorded against this booking. Deleting it would erase them. Cancel the booking instead — that keeps the record and frees the plot.`,
      suggestCancel: true,
    })
  }

  const inClosedCycle = (distRes.data || []).filter((d: any) => d.cycle_id)
  if (inClosedCycle.length > 0) {
    blocks.push({
      reason: 'Commission is already in a payout cycle',
      detail: `${inClosedCycle.length} commission row${inClosedCycle.length === 1 ? ' is' : 's are'} inside a closed payout cycle. Reopen that cycle on the Payout Cycles page before removing this booking.`,
      suggestCancel: true,
    })
  }

  const clearedCheques = (chqRes.data || []).filter((c: any) => c.status === 'cleared')
  if (clearedCheques.length > 0) {
    blocks.push({
      reason: 'A cheque has been cleared',
      detail: `${clearedCheques.length} cheque${clearedCheques.length === 1 ? ' has' : 's have'} cleared and created a receipt. Bounce or re-enter those on the PDC page first.`,
      suggestCancel: true,
    })
  }

  return blocks
}

/** What will disappear along with the booking, so the confirmation can name it. */
export async function bookingDeleteImpact(bookingId: string) {
  const [payRes, distRes, chqRes, emiRes, plotRes] = await Promise.all([
    supabase.from('bp_payments').select('id', { count: 'exact', head: true }).eq('booking_id', bookingId),
    supabase.from('payout_distributions').select('id', { count: 'exact', head: true }).eq('booking_id', bookingId),
    supabase.from('bp_pdc_cheques').select('id', { count: 'exact', head: true }).eq('booking_id', bookingId),
    supabase.from('emi_schedules').select('id', { count: 'exact', head: true }).eq('booking_id', bookingId),
    supabase.from('bp_booking_plots').select('plot_id').eq('booking_id', bookingId),
  ])
  return {
    unverifiedPayments: payRes.count || 0,
    commissionRows:     distRes.count || 0,
    cheques:            chqRes.count || 0,
    emiSchedules:       emiRes.count || 0,
    plotIds:            (plotRes.data || []).map((r: any) => r.plot_id).filter(Boolean),
  }
}

/**
 * Removes the booking after re-running the guards.
 *
 * The guards run again here rather than trusting the screen: the check and the click are
 * seconds apart, and a receipt entered in that gap must not be cascaded away.
 */
export async function deleteBookingSafely(booking: any): Promise<void> {
  const blocks = await checkBookingDeletable(booking)
  if (blocks.length > 0) {
    throw new Error(blocks[0].reason + ' — ' + blocks[0].detail)
  }

  const impact = await bookingDeleteImpact(booking.id)

  // Free the plots FIRST.  bp_booking_plots is cascaded away with the booking, so once the
  // booking is gone there is nothing left to say which plots belonged to it — they would
  // sit in the inventory as "booked" for a booking that no longer exists, and never come
  // back to available.  registry_done plots are left alone; the guards above mean we never
  // get here with one.
  const plotIds = [...impact.plotIds, booking.plot_id].filter(Boolean)
  if (plotIds.length > 0) {
    const { error: plotErr } = await supabase
      .from('bp_plots').update({ status: 'available' })
      .in('id', plotIds).neq('status', 'registry_done')
    if (plotErr) throw plotErr
  }

  // Commission rows are cascaded too, but they are removed explicitly so the same call the
  // cancel flow uses is the one that runs here.
  await supabase.from('payout_distributions').delete().eq('booking_id', booking.id)

  const { error } = await supabase.from('bp_bookings').delete().eq('id', booking.id)
  if (error) throw error
}
