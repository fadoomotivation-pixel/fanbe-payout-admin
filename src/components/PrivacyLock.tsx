// The bar that offers the PIN, and the small control that hides the numbers again.
//
// Deliberately a bar and not a full-screen blocker: the lock hides what is worth stealing,
// it does not stop the work.  Someone can still add a booking, a broker, a plot or an
// expense with the numbers blurred — so nobody has a reason to pass the PIN around.
//
// The bar is on screen the moment the app opens, and it closes two ways: the right PIN,
// or "Keep hidden" for whoever is happy to work blurred.  Closing it leaves every number
// blurred; only the PIN shows them.
import { useEffect, useRef, useState } from 'react'
import { usePrivacy } from '@/lib/privacy'
import { supabase } from '@/lib/supabase'
import { Lock, Unlock, Eye, ShieldCheck, X } from 'lucide-react'
import toast from 'react-hot-toast'

export function PrivacyLockBar() {
  const { locked, barOpen, keepHidden, unlock, focusPin } = usePrivacy()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [changing, setChanging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const showing = locked && barOpen

  useEffect(() => {
    if (!showing) return
    setPin(''); setErr('')
    // Only takes the caret when the screen locked while the person was working.  On the
    // first load it stays out of the way, so someone who wants to search a broker can.
    if (focusPin) setTimeout(() => inputRef.current?.focus(), 50)
  }, [showing, focusPin])

  if (!showing) return null

  const submit = async (e?: any) => {
    e?.preventDefault?.()
    if (busy || !pin) return
    setBusy(true); setErr('')
    const problem = await unlock(pin)
    setBusy(false)
    if (problem) { setErr(problem); setPin(''); inputRef.current?.focus() }
  }

  return (
    <>
      <div className="sticky top-0 z-40 bg-amber-500 text-white shadow" data-testid="pin-bar">
        <div className="max-w-6xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <Lock size={15}/>
            Broker earnings and phone numbers are hidden. Enter the PIN to show them.
          </span>
          <form onSubmit={submit} className="flex items-center gap-2 ml-auto">
            <input
              ref={inputRef}
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setErr('') }}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="PIN"
              aria-label="Unlock PIN"
              className="w-24 px-2.5 py-1.5 rounded-lg text-sm text-gray-900 tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-white"
            />
            <button type="submit" disabled={busy || !pin}
              className="inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 rounded-lg bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-50">
              <Unlock size={14}/>{busy ? 'Checking…' : 'Show'}
            </button>
            <button type="button" onClick={() => setChanging(true)}
              className="text-xs underline/50 hover:underline opacity-90">Change PIN</button>
            {/* Closes the bar, keeps the blur.  For whoever is happy to work hidden. */}
            <button type="button" onClick={keepHidden} title="Keep them hidden and carry on"
              aria-label="Keep hidden"
              className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg hover:bg-white/20">
              Keep hidden <X size={13}/>
            </button>
          </form>
          {err && <div className="w-full text-xs bg-white/15 rounded px-2 py-1">{err}</div>}
        </div>
      </div>
      {changing && <ChangePinModal onClose={() => setChanging(false)}/>}
    </>
  )
}

/** The switch in the sidebar: hide the numbers now, or ask for the PIN again. */
export function PrivacyLockControl() {
  const { locked, barOpen, lockNow, askForPin, idleMs } = usePrivacy()
  const mins = Math.round(idleMs / 60000)
  return (
    <div className="px-3 py-2 border-t border-white/10 text-[11px] text-white/70 space-y-1.5">
      {locked ? (
        <>
          <div className="inline-flex items-center gap-1.5 text-white/90">
            <Lock size={11}/><span className="font-medium">Numbers are hidden</span>
          </div>
          {!barOpen && (
            <button type="button" onClick={askForPin}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/90">
              <Eye size={11}/>Show numbers
            </button>
          )}
        </>
      ) : (
        <>
          <div>Numbers hide themselves after {mins} minutes untouched.</div>
          <button type="button" onClick={lockNow}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/90">
            <Lock size={11}/>Hide now
          </button>
        </>
      )}
    </div>
  )
}

/**
 * One PIN box.  It lives out here, and not inside ChangePinModal, because a component
 * declared inside another is a brand new component type on every render: React throws the
 * old input away and mounts a fresh one, the caret goes with it, and the person can only
 * ever type a single digit before focus is lost.
 */
function PinField(
  { label, value, set, auto }: { label: string; value: string; set: (v: string) => void; auto?: boolean },
) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
      <input
        value={value}
        onChange={e => set(e.target.value.replace(/\D/g, '').slice(0, 8))}
        type="password" inputMode="numeric" autoComplete="off" autoFocus={auto}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </label>
  )
}

function ChangePinModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async (e?: any) => {
    e?.preventDefault?.()
    setErr('')
    if (!/^\d{4,8}$/.test(next)) { setErr('The new PIN must be 4 to 8 digits.'); return }
    if (next !== again) { setErr('The two new PINs do not match.'); return }
    setBusy(true)
    const { error } = await supabase.rpc('set_privacy_pin', { p_current: current, p_new: next })
    setBusy(false)
    if (error) { setErr(error.message || 'Could not change the PIN.'); return }
    toast.success('PIN changed')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={e => e.stopPropagation()}
        data-testid="change-pin"
        className="bg-white rounded-xl shadow-xl w-full max-w-sm p-4 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 inline-flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-600"/>Change the PIN</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16}/></button>
        </div>
        <p className="text-[11px] text-gray-500">
          One PIN for the whole office. It is stored on the server, not in the app, and the current
          one is required so an unattended screen cannot be used to change it. Every change is
          recorded, so the admin can see who changed it and when.
        </p>
        <PinField label="Current PIN"  value={current} set={setCurrent} auto />
        <PinField label="New PIN (4-8 digits)" value={next} set={setNext} />
        <PinField label="New PIN again" value={again} set={setAgain} />
        {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-200">Cancel</button>
          <button type="submit" disabled={busy}
            className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Change PIN'}
          </button>
        </div>
      </form>
    </div>
  )
}
