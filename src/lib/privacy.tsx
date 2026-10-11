// Privacy lock — blur the broker numbers when the laptop has been sitting idle.
//
// Admin: "agar 15 min se system nahi use hua ... broker ne kya kamaya or broker ka number
// blur ho jae ... ek pin dalne ka option aye to blur hat jae ... normal employee galti se
// data na chura le laptop se."
//
// WHAT IT IS, HONESTLY.  This blurs pixels.  It is not encryption and it does not stop
// anyone who opens the browser's dev tools or calls the API directly — the data is still
// in the page.  What it stops is the thing that actually happens: a laptop left open at
// lunch, somebody walking past, a phone photo of the broker list and what each one earns.
// For an Affiliate Network business that list is the business, so a screen that goes blank on its own
// is worth having, as long as nobody mistakes it for a vault.
//
// WHAT IS NOT LOCKED.  Everyday work carries on while the screen is blurred — adding a
// booking, a broker, a plot, an expense.  The lock covers what is worth stealing (what a
// broker earned, and the phone numbers you would poach them with), not what the office
// has to get done.  Locking the whole app would just teach everyone to share the PIN.
//
// THE PIN lives in the database, hashed, and is checked by verify_privacy_pin() — see
// migration 20261011b.  It is deliberately NOT in this file: a PIN written into the
// JavaScript is readable by exactly the person it is meant to stop.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'

/** How long the laptop may sit untouched before the numbers go blurry. */
const IDLE_MS = 15 * 60 * 1000

/** Remembered per browser, so one office machine can be set up once and left alone. */
const ENABLED_KEY = 'fanbe.privacyLock.enabled'

type Ctx = {
  /** Numbers are blurred right now. */
  locked: boolean
  /** The lock is switched on at all for this machine. */
  enabled: boolean
  setEnabled: (on: boolean) => void
  /** Blur immediately, without waiting out the 15 minutes. */
  lockNow: () => void
  /** Returns an error message, or null when the PIN was right. */
  unlock: (pin: string) => Promise<string | null>
  /** Milliseconds of stillness before locking — surfaced so the UI can say it. */
  idleMs: number
}

const PrivacyCtx = createContext<Ctx | null>(null)

const readEnabled = () => {
  try { return localStorage.getItem(ENABLED_KEY) !== 'off' } catch { return true }
}

export function PrivacyProvider({ children }: { children: any }) {
  const [enabled, setEnabledState] = useState(readEnabled)
  // Starts unlocked: the person has just signed in, and demanding the PIN on every page
  // load is how a PIN ends up on a sticky note under the keyboard.
  const [locked, setLocked] = useState(false)
  const lastActive = useRef(Date.now())

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on)
    try { localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off') } catch { /* private window */ }
    if (!on) setLocked(false)
    else lastActive.current = Date.now()
  }, [])

  const lockNow = useCallback(() => { if (enabled) setLocked(true) }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const touch = () => { lastActive.current = Date.now() }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, touch, { passive: true }))

    // A timer alone is not enough: a backgrounded tab is throttled, and a laptop that was
    // asleep comes back with the clock far ahead.  So the elapsed time is measured, never
    // counted down — coming back after an hour locks immediately.
    const tick = setInterval(() => {
      if (Date.now() - lastActive.current >= IDLE_MS) setLocked(true)
    }, 15_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastActive.current >= IDLE_MS) setLocked(true)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      events.forEach(e => window.removeEventListener(e, touch))
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  const unlock = useCallback(async (pin: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc('verify_privacy_pin', { p_pin: pin })
    if (error) {
      // The function is missing until its migration runs.  Refusing to unlock would lock
      // the office out of its own screens over a deployment ordering detail, so let them
      // through — but SAY SO, loudly.  Unlocking quietly on any typed PIN would leave the
      // office believing a PIN is guarding the screen when nothing is.
      if (/function|does not exist|schema cache/i.test(error.message || '')) {
        toast.error('PIN is not set up on the server yet, so any PIN opens the screen. Tell the admin to run the privacy PIN setup.', { duration: 8000 })
        setLocked(false)
        return null
      }
      return error.message || 'Could not check the PIN.'
    }
    if (data !== true) return 'Wrong PIN.'
    lastActive.current = Date.now()
    setLocked(false)
    return null
  }, [])

  const value = useMemo<Ctx>(
    () => ({ locked: enabled && locked, enabled, setEnabled, lockNow, unlock, idleMs: IDLE_MS }),
    [enabled, locked, setEnabled, lockNow, unlock],
  )
  return <PrivacyCtx.Provider value={value}>{children}</PrivacyCtx.Provider>
}

export function usePrivacy(): Ctx {
  const c = useContext(PrivacyCtx)
  // The broker portal and the login screens render outside the provider; they should not
  // crash, they just never lock.
  return c ?? {
    locked: false, enabled: false, setEnabled: () => {}, lockNow: () => {},
    unlock: async () => null, idleMs: IDLE_MS,
  }
}

/**
 * Wrap anything that should go blurry: what a broker earned, a phone number, a PAN.
 *
 * Blurred text stays in the DOM on purpose — the number must snap back the instant the
 * PIN is right, and swapping it for dots would make every column jump about.  Selection
 * and pointer events are switched off so a blurred figure cannot simply be copied out.
 *
 * The blur is an inline style, not a Tailwind class, deliberately.  A utility class only
 * works if the stylesheet built that exact rule; a purge setting, a renamed class or a
 * stylesheet that loads late would quietly leave every number in plain sight with nothing
 * to show that it had broken.  An inline style cannot fail that way.
 */
const HIDDEN_STYLE = {
  filter: 'blur(6px)',
  WebkitFilter: 'blur(6px)',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  pointerEvents: 'none',
} as const

export function Secret({ children, className = '' }: { children: any; className?: string }) {
  const { locked } = usePrivacy()
  if (!locked) return <span className={className}>{children}</span>
  return (
    <span
      className={`${className} inline-block align-middle`}
      style={HIDDEN_STYLE as any}
      data-hidden="1"
      aria-hidden="true"
      title="Hidden until the PIN is entered"
    >
      {children}
    </span>
  )
}
