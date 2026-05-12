# Android APK build

The admin dashboard is packaged as an Android APK using
[Capacitor](https://capacitorjs.com). The React web bundle is shipped inside
the APK, and Supabase Realtime keeps the data live from the server.

## Build via GitHub Actions (recommended)

1. In the repo, go to **Settings -> Secrets and variables -> Actions** and add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. Push to `claude/apk-realtime-updates-dr8Cl` (or `main`), or trigger
   **Actions -> Build Android APK -> Run workflow**.
3. When the run finishes, download the `fanbe-payout-admin-apk` artifact from
   the run summary. Unzip it and install `fanbe-payout-admin-debug.apk` on
   any Android device (enable *Install from unknown sources*).

## Build locally

Requires Node 20, JDK 17, and Android SDK with build-tools.

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run build
npx cap add android    # only the first time
npx cap sync android
cd android && ./gradlew assembleDebug
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Realtime updates

The app uses the same Supabase client as the web build, so any table that has
Realtime enabled (bookings, payouts, withdrawals, KYC, etc.) will stream
live into the APK over a WebSocket — no manual refresh needed.

## Notes

- The current workflow produces an **unsigned debug** APK suitable for
  internal testing. For Play Store / signed release builds, add a keystore
  (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) and
  switch the gradle task to `assembleRelease`.
- App id: `com.fanbegroup.admin`. Change in `capacitor.config.ts` if needed.
