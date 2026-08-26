import { isNativeApp } from '@/lib/platform'

// The things that make a wrapped app read as "a website in a box", and what is done about
// each.  None of them are cosmetic: they are the specific behaviours a person's thumb
// notices in the first ten seconds.
//
//   no haptics            -> taps feel dead, like clicking a link
//   back button exits     -> the single loudest tell; every Android user hits back first
//   browser status bar    -> a light strip over a coloured header
//   keyboard covers input -> the page scrolls instead of the view resizing
//   overscroll glow       -> the blue rubber-band at the end of a list
//
// Every call is guarded, so the same code runs unchanged in a browser where these plugins
// do not exist.

let backHandler: (() => boolean) | null = null

/** Registers what the hardware back button should do. Return true if handled. */
export function setBackHandler(fn: (() => boolean) | null) {
  backHandler = fn
}

export async function initNativeShell() {
  if (!isNativeApp()) return

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // The app draws its own header, so the status bar sits on the app's colour rather
    // than on a browser-grey strip.
    await StatusBar.setStyle({ style: Style.Light })
    await StatusBar.setBackgroundColor({ color: '#F5F5F7' })
    await StatusBar.setOverlaysWebView({ overlay: false })
  } catch { /* browser, or the plugin is unavailable */ }

  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard')
    // Resize the webview instead of scrolling the document — otherwise the field being
    // typed into slides under the keyboard, which no native app does.
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native })
    await Keyboard.setScroll({ isDisabled: true })
  } catch { /* not available */ }

  try {
    const { App } = await import('@capacitor/app')
    App.addListener('backButton', ({ canGoBack }) => {
      // Screens register their own back behaviour; only exit when nothing wants it and
      // there is genuinely nowhere to go.
      if (backHandler && backHandler()) return
      if (canGoBack) window.history.back()
      else App.exitApp()
    })
  } catch { /* not available */ }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch { /* not available */ }
}

type Weight = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'

/**
 * A short tap of feedback.  Fire-and-forget on purpose: feedback that waits on a promise
 * arrives after the finger has already lifted, which is worse than none at all.
 */
export function tap(weight: Weight = 'light') {
  if (!isNativeApp()) return
  import('@capacitor/haptics').then(({ Haptics, ImpactStyle, NotificationType }) => {
    try {
      if (weight === 'success') Haptics.notification({ type: NotificationType.Success })
      else if (weight === 'warning') Haptics.notification({ type: NotificationType.Warning })
      else if (weight === 'error') Haptics.notification({ type: NotificationType.Error })
      else Haptics.impact({
        style: weight === 'heavy' ? ImpactStyle.Heavy
             : weight === 'medium' ? ImpactStyle.Medium
             : ImpactStyle.Light,
      })
    } catch { /* device without a vibrator */ }
  }).catch(() => { /* browser */ })
}
