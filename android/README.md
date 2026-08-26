# Fanbe Collections — Android app

The collection app (`/collect`) packaged as a real Android build. Same code, same login,
same Supabase backend as the web version — the web assets are bundled **into** the APK, so
the shell draws instantly and only the data is fetched.

## Getting an APK without installing anything

GitHub builds it. **Actions → Build Android APK → Run workflow**, then download
`fanbe-collections-debug-apk` from the run's Artifacts. That file installs on any Android
phone (the phone will ask to allow installing from an unknown source, which is expected for
a build distributed outside the Play Store).

It also builds automatically on any push to `main` that touches the app, and on a `v*` tag —
a tagged build attaches the APK to the GitHub Release.

## Building locally

```bash
npm ci
npm run build            # web assets -> dist/
npx cap sync android     # copy dist/ into the Android project
cd android && ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

Needs JDK 21 and the Android SDK (compileSdk 34). `minSdkVersion` is 22, so it runs on
Android 5.1 and later — deliberately low, because the phones doing the calling are cheap
and old.

## Signed release builds

A debug APK is fine for handing to the team, but every rebuild is signed with a throwaway
debug key. For something you install once and update in place, add these repository
secrets and the workflow will also produce a signed release APK:

| Secret | What it is |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | your `.jks` keystore, base64 encoded |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias inside the keystore |
| `ANDROID_KEY_PASSWORD` | password for that key |

Create a keystore once, and keep it safe:

```bash
keytool -genkey -v -keystore fanbe.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias fanbe
base64 -w0 fanbe.jks        # paste into ANDROID_KEYSTORE_BASE64
```

**Keep using the same keystore.** Android refuses to install an update signed by a
different key — every phone would have to uninstall and reinstall, losing the session.

Optionally also set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as secrets. Without
them the build falls back to the values compiled into `src/lib/supabase.ts`, which is why
the workflow is green on a fresh checkout.

## Why the app opens on the collection screen

In a browser, `/` is the admin dashboard. Inside the APK it redirects to `/collect`
(`src/lib/platform.ts` checks for the Capacitor runtime). The APK is for the callers; the
sidebar panel stays a desktop tool.
