// Is this the packaged Android build, or a browser?
//
// Checked through the global rather than by importing @capacitor/core, so the web bundle
// never pulls the native runtime in just to answer a yes/no question.  Capacitor injects
// this object only inside the app shell; in a browser it is simply absent.
export function isNativeApp(): boolean {
  try {
    return !!(window as any)?.Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}
