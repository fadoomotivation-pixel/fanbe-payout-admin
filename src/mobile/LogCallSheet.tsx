import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/utils'
import { todayISO, type CallTarget } from './useCollection'
import toast from 'react-hot-toast'

// What the customer said, written down in the seconds after hanging up.
//
// Everything except the outcome is optional on purpose.  A caller working a list of forty
// will abandon a form that argues with them, and a call logged with one tap is worth more
// than a perfect record that never gets entered.

const OUTCOMES = [
  { value: 'Connected',     label: 'Talked' },
  { value: 'Not Connected', label: 'No answer' },
  { value: 'Busy',          label: 'Busy' },
  { value: 'Voicemail',     label: 'Switched off' },
] as const

// The reasons that actually come back on these calls.  Tapping one beats typing it, and
// because they are a fixed list they can be counted later — free text cannot.
const OBJECTIONS = [
  'Will pay soon', 'Money problem', 'Salary delayed', 'Out of town',
  'Wants to meet', 'Disputes amount', 'Wants to cancel', 'Wrong number',
]

const addDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function LogCallSheet({
  target, open, onClose,
}: { target: CallTarget | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<string>('Connected')
  const [objection, setObjection] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [promisedAmount, setPromisedAmount] = useState('')
  const [promisedDate, setPromisedDate] = useState('')
  const [followUp, setFollowUp] = useState('')

  useEffect(() => {
    if (!open || !target) return
    setStatus('Connected'); setObjection(''); setNotes('')
    setPromisedAmount(''); setPromisedDate('')
    // No answer usually means try again tomorrow; a conversation usually sets its own date.
    setFollowUp(addDays(3))
  }, [open, target?.bookingId])

  const save = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('No customer selected')
      // calls.employee_id is NOT NULL — every call belongs to the person who made it, which
      // is the point of the table. Checked here so a lapsed session gives a plain message
      // instead of a raw not-null violation after the caller has typed everything out.
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user?.id) throw new Error('Your session has expired. Sign in again to save this call.')

      const { error } = await supabase.from('calls').insert({
        booking_id:  target.bookingId,
        customer_id: target.customerId,
        employee_id: user.id,
        employee_name: user.email || null,
        lead_name:   target.name,
        project_name: target.projectName,
        phone:       target.phone,
        call_type:   'Outgoing',
        status,
        call_date:   todayISO(),
        call_time:   new Date().toTimeString().slice(0, 8),
        notes:       notes.trim() || null,
        feedback:    notes.trim() || null,
        major_objection: objection || null,
        promised_amount: promisedAmount !== '' ? Number(promisedAmount) : null,
        promised_date:   promisedDate || null,
        next_followup_date: followUp || null,
        followup_status: followUp ? 'pending' : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['m_call_queue'] })
      qc.invalidateQueries({ queryKey: ['m_call_history'] })
      toast.success('Call saved')
      onClose()
    },
    onError: (e: any) => toast.error(e.message || 'Could not save the call.'),
  })

  if (!open || !target) return null

  const talked = status === 'Connected'

  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet" role="dialog" aria-label="Log call">
        <div className="m-grabber"/>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>{target.name}</div>
          <div style={{ fontSize: 13, color: 'var(--m-ink-2)', marginTop: 2 }}>
            {target.bookingNo}
            {target.overdueAmount > 0 && <> · <b style={{ color: 'var(--m-red)' }}>{formatINR(target.overdueAmount)} overdue</b></>}
          </div>
        </div>

        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 650 }}>What happened?</div>
        <div className="m-seg" style={{ marginBottom: 18 }}>
          {OUTCOMES.map(o => (
            <button key={o.value} data-on={status === o.value} onClick={() => setStatus(o.value)}>
              {o.label}
            </button>
          ))}
        </div>

        {talked && (
          <>
            <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 650 }}>What did they say?</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
              {OBJECTIONS.map(o => (
                <button key={o} onClick={() => setObjection(objection === o ? '' : o)}
                  className="m-press"
                  style={{
                    padding: '9px 13px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                    border: '1px solid var(--m-line)',
                    background: objection === o ? 'var(--m-ink)' : 'var(--m-surface)',
                    color: objection === o ? '#fff' : 'var(--m-ink-2)',
                  }}>
                  {o}
                </button>
              ))}
            </div>

            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              className="m-field" rows={3} placeholder="Anything else in their words…"
              style={{ marginBottom: 18, resize: 'none' }}/>

            <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 650 }}>Did they promise to pay?</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <input value={promisedAmount} onChange={e => setPromisedAmount(e.target.value)}
                className="m-field" type="number" inputMode="numeric" placeholder="Amount"/>
              <input value={promisedDate} onChange={e => setPromisedDate(e.target.value)}
                className="m-field" type="date"/>
            </div>
            {promisedDate && (
              <button onClick={() => setFollowUp(promisedDate)} className="m-press"
                style={{ fontSize: 12, color: 'var(--m-blue)', background: 'none', border: 0, padding: '2px 0', marginBottom: 14 }}>
                Also remind me on that day
              </button>
            )}
          </>
        )}

        <div style={{ marginBottom: 8, marginTop: talked ? 4 : 0, fontSize: 13, fontWeight: 650 }}>Call again on</div>
        <div style={{ display: 'flex', gap: 7, marginBottom: 10, flexWrap: 'wrap' }}>
          {[['Tomorrow', addDays(1)], ['3 days', addDays(3)], ['1 week', addDays(7)]].map(([lbl, val]) => (
            <button key={lbl} onClick={() => setFollowUp(val)} className="m-press"
              style={{
                padding: '9px 13px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                border: '1px solid var(--m-line)',
                background: followUp === val ? 'var(--m-ink)' : 'var(--m-surface)',
                color: followUp === val ? '#fff' : 'var(--m-ink-2)',
              }}>
              {lbl}
            </button>
          ))}
        </div>
        <input value={followUp} onChange={e => setFollowUp(e.target.value)}
          className="m-field" type="date" style={{ marginBottom: 20 }}/>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="m-cta m-cta-log m-press" style={{ flex: 1 }}>Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="m-cta m-press"
            style={{ flex: 2, background: 'var(--m-blue)', color: '#fff', opacity: save.isPending ? 0.6 : 1 }}>
            {save.isPending ? 'Saving…' : 'Save call'}
          </button>
        </div>
      </div>
    </>
  )
}
