// Privacy lock — the broker numbers start hidden, and a PIN shows them.
//
// Admin: "agar 15 min se system nahi use hua ... broker ne kya kamaya or broker ka number
// blur ho jae ... ek pin dalne ka option aye to blur hat jae ... normal employee galti se
// data na chura le laptop se."
//
// And then: "pehli baar automatically pin dalne k option aaye or vo hide bhi kr sake jo
// blur wala kaam krna chahe vo kr sake or jo unblur wala krna chahe".
//
// SO IT STARTS HIDDEN.  Every time the app opens, the numbers are blurred and the PIN box
// is already on screen.  Two honest choices, and both are one click:
//
//   * type the PIN  -> numbers show, until fifteen minutes of stillness hides them again
//   * close the bar -> carry on working with them hidden, nothing is blocked
//
// This is the opposite of what I built first, which opened unlocked and only hid things
// after fifteen idle minutes.  That was the wrong default: it meant a laptop that was
// logged in and then left alone for ten minutes showed every broker's earnings to anyone
// walking past, and the protection only arrived after the damage could already be done.
// Hidden-by-default costs one click when you want the numbers and nothing at all when you
// do not.
//
// AND THERE IS NO OFF SWITCH, ON PURPOSE.  I had put a "Hide numbers when idle" checkbox
// in the sidebar.  Any employee could untick it and never see a blur again, which made the
// whole thing look like protection while being a preference.  The choice admin asked for —
// work blurred, or type the PIN — is kept; the choice to switch the lock off is not one an
// employee should have.
//
// WHAT IT IS, HONESTLY.  This blurs pixels.  It is not encryption and it does not stop
// anyone who opens the browser's dev tools or calls the API directly — the data is still
// in the page.  What it stops is the thing that actually happens: a laptop left open at
// lunch, somebody walking past, a phone photo of the broker list and what each one earns.
// For an affiliate network that list is the business, so a screen that hides itself is
// worth having, as long as nobody mistakes it for a vault.
//
// WHAT IS NOT LOCKED.  Everyday work carries on while the screen is blurred — adding a
// booking, a broker, a plot, an expense, picking a broker for a withdrawal.  The lock
// covers what is worth stealing (what a broker earned, and the phone numbers you would
// poach them with), not what the office has to get done.  Locking the whole app would just
// teach everyone to share the PIN.
//
// THE PIN lives in the database and is checked by verify_privacy_pin() — see migration
// 20261011b.  It is deliberately NOT in this file: a PIN written into the JavaScript is
// readable by exactly the person it is meant to stop.
//
// It is stored as plain text, on purpose, so the owner can read his own PIN in Supabase
// and see in app_security_log if anyone changed it.  That is not the lapse it looks like:
// the PIN guards a blur, and every number the blur hides already sits in the same database
// in plain text, so a hash would have protected nothing while costing the owner sight of
// it.  What keeps staff out is the table, not the storage — RLS on with no policies and
// every grant revoked, so the API cannot read it at all.  The browser only ever sends a
// guess and gets back true or false.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { setPrivacyLockedFlag } from '@/lib/privacyState'

/** How long the laptop may sit untouched before the numbers hide themselves again. */
const IDLE_MS = 15 * 60 * 1000

type Ctx = {
  /** Numbers are blurred right now. */
  locked: boolean
  /** The PIN bar is on screen.  Closing it keeps the blur; it returns on the next lock. */
  barOpen: boolean
  /** Close the bar and carry on working with the numbers hidden. */
  keepHidden: () => void
  /** Bring the PIN bar back, for someone who closed it and now wants the numbers. */
  askForPin: () => void
  /** Hide immediately, without waiting out the fifteen minutes. */
  lockNow: () => void
  /** Returns an error message, or null when the PIN was right. */
  unlock: (pin: string) => Promise<string | null>
  /**
   * Whether the PIN box should take the caret.  False on the first load — the person has
   * just arrived and may want to search a broker, not type a PIN — and true when the
   * screen locks later, because then they were mid-task and want back in.
   */
  focusPin: boolean
  /** Milliseconds of stillness before hiding — surfaced so the UI can say it. */
  idleMs: number
}

const PrivacyCtx = createContext<Ctx | null>(null)

export function PrivacyProvider({ children }: { children: any }) {
  // Starts hidden, with the PIN box showing.  See the note at the top of the file.
  const [locked, setLocked] = useState(true)
  const [barOpen, setBarOpen] = useState(true)
  const [focusPin, setFocusPin] = useState(false)

  const lastActive = useRef(Date.now())
  // Read inside the idle timer, so the timer never has to be torn down and rebuilt.
  const lockedRef = useRef(true)
  lockedRef.current = locked

  const lock = useCallback((focus: boolean) => {
    setLocked(true)
    setBarOpen(true)
    setFocusPin(focus)
  }, [])

  const lockNow = useCallback(() => lock(true), [lock])
  const keepHidden = useCallback(() => setBarOpen(false), [])
  const askForPin = useCallback(() => { setBarOpen(true); setFocusPin(true) }, [])

  useEffect(() => {
    const touch = () => { lastActive.current = Date.now() }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, touch, { passive: true }))

    // A timer alone is not enough: a backgrounded tab is throttled, and a laptop that was
    // asleep comes back with the clock far ahead.  So the elapsed time is measured, never
    // counted down — coming back after an hour hides the numbers immediately.
    //
    // Only fires when the screen is currently showing.  Someone who closed the bar to work
    // blurred has already made their choice; re-opening it at them every fifteen minutes
    // would be nagging, and nothing needs hiding that is not already hidden.
    const maybeLock = () => {
      if (!lockedRef.current && Date.now() - lastActive.current >= IDLE_MS) lock(true)
    }
    const tick = setInterval(maybeLock, 15_000)
    const onVisible = () => { if (document.visibilityState === 'visible') maybeLock() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      events.forEach(e => window.removeEventListener(e, touch))
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [lock])

  const unlock = useCallback(async (pin: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc('verify_privacy_pin', { p_pin: pin })
    if (error) {
      // The function is missing until its migration runs.  Refusing to unlock would leave
      // the office stuck behind a blur over a deployment ordering detail, so let them
      // through — but SAY SO, loudly.  Unlocking quietly on any typed PIN would leave the
      // office believing a PIN is guarding the screen when nothing is.
      if (/function|does not exist|schema cache/i.test(error.message || '')) {
        toast.error('PIN is not set up on the server yet, so any PIN opens the screen. Tell the admin to run the privacy PIN setup.', { duration: 8000 })
        setLocked(false); setBarOpen(false); setFocusPin(false)
        return null
      }
      return error.message || 'Could not check the PIN.'
    }
    if (data !== true) return 'Wrong PIN.'
    lastActive.current = Date.now()
    setLocked(false); setBarOpen(false); setFocusPin(false)
    return null
  }, [])

  // Publish the state for the two places that cannot read React context: the CSV
  // downloader and the bulk print templates. Without this the blur would hide the list
  // while the Download button beside it handed the same list over.
  useEffect(() => { setPrivacyLockedFlag(locked) }, [locked])

  const value = useMemo<Ctx>(
    () => ({ locked, barOpen, keepHidden, askForPin, lockNow, unlock, focusPin, idleMs: IDLE_MS }),
    [locked, barOpen, keepHidden, askForPin, lockNow, unlock, focusPin],
  )
  return <PrivacyCtx.Provider value={value}>{children}</PrivacyCtx.Provider>
}

export function usePrivacy(): Ctx {
  const c = useContext(PrivacyCtx)
  // The broker portal and the login screens render outside the provider; they should not
  // crash, they just never hide anything.
  return c ?? {
    locked: false, barOpen: false, keepHidden: () => {}, askForPin: () => {},
    lockNow: () => {}, unlock: async () => null, focusPin: false, idleMs: IDLE_MS,
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

/**
 * For the KPI and stat tiles, which all render a formatted figure and an optional
 * sub-line.  Hides it when it is money and leaves it alone when it is not, so "46
 * bookings" stays readable while the rupees beside it do not.
 *
 * Keying off the rupee sign rather than a prop is deliberate: a tile added next month is
 * covered without anyone remembering to wrap it, and the one failure mode - a money
 * figure formatted without a rupee sign - shows up the moment you look at the screen,
 * which is the right way round for a privacy feature to break.
 */
export function SecretMoney({ children, className = '' }: { children: any; className?: string }) {
  if (typeof children !== 'string' || !children.includes('₹')) return <>{children}</>
  return <Secret className={className}>{children}</Secret>
}

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
