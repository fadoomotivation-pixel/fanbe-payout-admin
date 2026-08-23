import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { AlertTriangle, Trash2, ShieldAlert } from 'lucide-react'
import { checkBookingDeletable, bookingDeleteImpact, type DeleteBlock } from '@/lib/deleteBooking'

// Shared by the Bookings page and the Customer Pipeline so both explain a refusal the same
// way.  It states what will actually be removed before the admin commits, because the
// database cascades this delete silently.
export default function DeleteBookingModal({
  booking, open, onClose, onConfirm, deleting,
}: {
  booking: any
  open: boolean
  onClose: () => void
  onConfirm: () => void
  deleting?: boolean
}) {
  const [blocks, setBlocks] = useState<DeleteBlock[] | null>(null)
  const [impact, setImpact] = useState<any>(null)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!open || !booking?.id) return
    setBlocks(null); setImpact(null); setTyped('')
    let cancelled = false
    ;(async () => {
      const [b, i] = await Promise.all([
        checkBookingDeletable(booking),
        bookingDeleteImpact(booking.id),
      ])
      if (cancelled) return
      setBlocks(b); setImpact(i)
    })()
    return () => { cancelled = true }
  }, [open, booking?.id])

  if (!booking) return null

  const checking = blocks === null
  const blocked  = !checking && blocks.length > 0
  const label    = booking.booking_no || 'this booking'
  // Typing the booking number is asked for only when the delete is allowed — it is the
  // last thing between a mis-tap and a booking disappearing.
  const confirmed = typed.trim().toUpperCase() === String(label).trim().toUpperCase()

  return (
    <Modal open={open} onClose={onClose} title={`Delete booking · ${label}`} size="sm">
      {checking && <div className="py-6 text-center text-sm text-gray-400">Checking what depends on this booking…</div>}

      {blocked && (
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
            <ShieldAlert size={16} className="text-rose-600 mt-0.5 shrink-0"/>
            <div className="text-[13px] text-rose-900 font-semibold">
              This booking can't be deleted.
            </div>
          </div>
          {blocks!.map((b, i) => (
            <div key={i} className="rounded-lg border border-gray-200 px-3 py-2">
              <div className="text-[13px] font-semibold text-gray-900">{b.reason}</div>
              <div className="text-[12px] text-gray-600 mt-0.5">{b.detail}</div>
            </div>
          ))}
          {blocks!.some(b => b.suggestCancel) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <b>Cancel the booking instead.</b> Cancelling keeps the receipts and the history,
              reverses the broker commission and puts the plot back on the available list.
            </div>
          )}
        </div>
      )}

      {!checking && !blocked && (
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0"/>
            <div className="text-[12px] text-amber-900">
              Nothing has been received against this booking, so it can be removed. This cannot be undone.
            </div>
          </div>

          <div className="text-[13px] text-gray-700">
            <div className="font-semibold text-gray-900 mb-1">What will be removed</div>
            <ul className="space-y-0.5 text-[12px] text-gray-600">
              <li>· The booking {label}{booking.bp_customers?.name ? ` (${booking.bp_customers.name})` : ''}</li>
              {impact?.unverifiedPayments > 0 && <li>· {impact.unverifiedPayments} unverified payment entr{impact.unverifiedPayments === 1 ? 'y' : 'ies'}</li>}
              {impact?.cheques > 0 && <li>· {impact.cheques} post-dated cheque{impact.cheques === 1 ? '' : 's'} on file</li>}
              {impact?.emiSchedules > 0 && <li>· its EMI plan</li>}
              {impact?.commissionRows > 0 && <li>· {impact.commissionRows} unpaid commission row{impact.commissionRows === 1 ? '' : 's'}</li>}
              {impact?.plotIds?.length > 0 && <li>· {impact.plotIds.length} plot{impact.plotIds.length === 1 ? '' : 's'} will go back to <b>Available</b></li>}
            </ul>
          </div>

          <div>
            <label className="text-[12px] text-gray-700">Type <b className="font-mono">{label}</b> to confirm</label>
            <input value={typed} onChange={e => setTyped(e.target.value)} autoFocus
              placeholder={String(label)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-rose-500"/>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>{blocked ? 'Close' : 'Cancel'}</Button>
        {!checking && !blocked && (
          <Button variant="danger" disabled={!confirmed} loading={deleting} onClick={onConfirm}>
            <Trash2 size={14}/>Delete booking
          </Button>
        )}
      </div>
    </Modal>
  )
}
