import type { CapacitorConfig } from '@capacitor/cli'

// Wraps the collection app as a real Android build.
//
// The web assets are bundled into the APK (webDir: dist) rather than pointed at the live
// site.  A webview shell over a URL is dead the moment a caller has no signal at the gate
// of a colony, and it also means every screen waits on the network before it draws
// anything.  Bundled, the shell is instant and only the data is fetched.
const config: CapacitorConfig = {
  appId: 'com.fanbegroup.collections',
  appName: 'Fanbe Collections',
  webDir: 'dist',

  android: {
    // The callers' handsets are cheap and old; this keeps text crisp without asking the
    // webview to re-layout at a scale the CSS was not written for.
    allowMixedContent: false,
  },

  server: {
    androidScheme: 'https',
  },

  plugins: {
    // Matches the PWA splash colours so the launch does not flash white.
    SplashScreen: {
      launchShowDuration: 400,
      backgroundColor: '#0071E3',
      showSpinner: false,
    },
  },
}

export default config
