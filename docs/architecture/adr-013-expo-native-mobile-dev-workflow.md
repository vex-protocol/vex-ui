# ADR-013: Expo-Native Mobile Development Workflow

**Status:** Proposed
**Date:** 2026-05-22
**Deciders:** @dream
**Supersedes:** None

---

## Context

The mobile app uses Expo Prebuild and Continuous Native Generation (CNG).
`apps/mobile/android/` and `apps/mobile/ios/` are generated native projects,
while `app.config.js`, `app.json`, config plugins, and EAS profiles own the
durable native configuration.

The local Android workflow grew a parallel orchestration layer around that
model:

- `android-dev.sh` selects the development flavor, validates Firebase config,
  runs a clean Android prebuild, verifies the generated application ID, and
  then delegates to another Android script.
- `android-run.sh` checks Java and Android SDK state, starts an emulator when
  needed, picks React Native architectures from attached devices, and finally
  calls `expo run:android`.
- `android-with-logs.sh` builds a debug APK with Gradle, installs it on every
  attached device, starts Metro, configures `adb reverse`, and tails logs.
- Additional scripts build or install production APKs, reset Android app data,
  launch an emulator, and install iOS release builds.

Those scripts solved real problems while the Android workflow was settling.
They also made the default workflow harder to reason about:

1. The default `pnpm -F mobile android` command hides the Expo build/install
   command behind several shell layers.
2. Flavor selection is split between package scripts, shell exports,
   `app.config.js`, and EAS profile names.
3. Wrapper behavior such as emulator boot, multi-device install, and log
   streaming is mixed with the ordinary "build a local development client"
   path.
4. New contributors can confuse Prebuild, native compilation, app install, and
   Metro startup because the custom scripts do several of those at once.

## Expo Guidance

Expo's development-build workflow separates these responsibilities:

- A development build is a debug app that includes `expo-dev-client`.
- Local native compilation and install use `expo run:android` or
  `expo run:ios`.
- Once a development build is installed, daily JavaScript development starts
  Metro with `expo start`.
- With CNG, generated native directories should stay generated. `expo run:*`
  can prebuild a missing platform once; after native dependencies, app config,
  or config plugins change, `expo prebuild --clean` regenerates native projects
  before rebuilding.
- Multiple installed app variants are selected from dynamic app config using a
  profile environment variable. Expo's examples set that variable in both the
  development server script and the EAS development profile.

This repo already has the core Expo variant shape: `app.config.js` switches the
development app name and native identifiers from `VEX_APP_ENV=development`.
The custom Android wrappers still support the older
`VEX_ENABLE_DEV_BUILD=1` plus `EAS_BUILD_PROFILE=development` convention while
they remain in use.

## Decision

Make the Expo-native development-build flow the primary mobile workflow.

### Primary commands

The mobile package scripts will mean:

| Command | Responsibility |
| --- | --- |
| `pnpm -F mobile dev` | Start Metro for the Vex Developer variant. |
| `pnpm -F mobile android` | Build and install a local Android development build with Expo CLI. |
| `pnpm -F mobile ios` | Build and install a local iOS development build with Expo CLI. |
| `pnpm -F mobile prebuild` | Regenerate generated development native projects with clean CNG output. |

`dev`, `android`, `ios`, and `prebuild` set `VEX_APP_ENV=development` so local
app-config evaluation selects the same development variant that EAS does.

### EAS development profile

The `development` EAS profile explicitly sets:

- `developmentClient: true`
- `env.VEX_APP_ENV: development`

That makes a development build visibly a development client and gives EAS the
same variant input as the local package scripts.

### Development-client scheme

`app.config.js` configures the `expo-dev-client` plugin so the generated Expo
development URL scheme exists only for the development variant. Production
keeps its explicit app scheme without being a target for development-client
launcher URLs.

### Environment files

`.env.local` is for per-machine overrides, especially
`EXPO_PUBLIC_SERVER_URL` when a device should talk to local Spire over the iOS
simulator, Android port reversal, LAN, or Tailscale. The committed
`.env.example` documents those overrides.

The default development variant should not require a copied env file. Its
variant metadata already selects the development API; production keeps its
compiled production API default.

### Phased wrapper retirement

This change does not delete the Android shell workflows. Phase 1 moves the
default path to Expo and preserves wrapper access:

- `legacy:android` keeps the prior Android wrapper chain available.
- Existing specialized scripts such as `android:dev`, `android:multi`,
  `android:prod`, `android:emulator`, `android:reset-db`, and release install
  helpers stay available.
- Legacy scripts may still perform Firebase validation, multi-device APK
  install, Gradle release builds, emulator bootstrapping, log fanout, or SDK
  setup that Expo CLI does not attempt to own.

Phase 2 should measure which specialized behaviors are still used. Each
remaining need should either become a narrow utility around Expo commands or be
removed once EAS, Android Studio, Expo CLI, and documented device setup cover
it well enough.

## Consequences

### Positive

- **Expo concepts map to commands.** Metro startup, local native build/install,
  and native regeneration have separate package scripts.
- **Variant selection has one primary input.** Local scripts and EAS
  development builds use `VEX_APP_ENV=development`.
- **CNG stays legible.** Generated native projects remain disposable outputs of
  Expo config and config plugins.
- **Migration is reversible.** Existing Android specialists can keep using the
  old wrappers while the default path gets simpler.

### Negative

- **Primary Android commands do less orchestration.** Expo CLI will not
  automatically tail every device log, choose custom ABI sets, validate every
  Firebase file, or install a release APK on every attached device.
- **Two paths exist temporarily.** During the transition, docs and support need
  to distinguish the Expo-native default path from legacy wrapper behavior.
- **Native changes still require rebuilds.** `expo start` updates JavaScript,
  not native code. Native dependency or config changes still need a regenerated
  and rebuilt development client.

## References

- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Use a development build](https://docs.expo.dev/develop/development-builds/use-development-builds/)
- [Install app variants on the same device](https://docs.expo.dev/build-reference/variants/)
- [Configure EAS Build with eas.json](https://docs.expo.dev/build/eas-json/)
- [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/)
