# Nakshakar

_Formerly GharNirman._

Design a house by typing real dimensions or drawing with a mouse or finger, walk through it in 3D, check Vastu, print measured plans, and get a construction estimate as a minimum, most likely and maximum range.

It runs offline: no login, no cloud, no analytics. Projects stay on the device.

**Try it:** [nakshakarapp-hue.github.io/nakshakar](https://nakshakarapp-hue.github.io/nakshakar/) has **Open site** and **Install app** buttons.

**New users:** start with the illustrated guide, [docs/Nakshakar-User-Guide.pptx](docs/Nakshakar-User-Guide.pptx).

**Send a house to someone:** use Share as a file. It saves a `.nakshakar` file to send however you like. The other person chooses Open a shared file on their Home screen, then looks through the house or keeps a copy.

## Run it

### In a browser

Open the website and press **Open site**. After the first visit it also works with no internet. Projects are saved in that browser on that device, so use **Export** on the home screen for backups or to move a project. Clearing the browser's site data deletes projects saved there.

To run it from this source on a laptop instead, double-click **`Start Nakshakar Website.bat`**, which needs [Node.js](https://nodejs.org) and opens http://localhost:4173.

### On Windows

Download `Nakshakar-Setup.exe` from [the website](https://nakshakarapp-hue.github.io/nakshakar/#downloads). The installer is not code-signed, so Windows SmartScreen warns about an unknown publisher: choose **More info**, then **Run anyway**.

### On an Android phone or tablet

Download `Nakshakar.apk` from [the website](https://nakshakarapp-hue.github.io/nakshakar/#downloads) and allow installing from your browser. It has no internet permission at all, and it opens with airplane mode on.

### On iPhone or iPad

Open the website in Safari, tap **Share**, then **Add to Home Screen**. This installs the web app, which works offline once opened.

A real App Store or `.ipa` build is not available: it needs a Mac and a paid Apple developer account. The Xcode project is in `ios/` for when those are available (`npx cap sync ios`, then `npx cap open ios`). It has never been built.

## Build it

Requirements: Node 20 or newer. For Android, also JDK 17 and the Android SDK with platform 35.

```bash
npm install
npm run verify             # type-check, lint, unit tests, production build
npx playwright test        # browser tests, using `npm run preview`
npm run test:coverage      # enforces 100% coverage on src/core/units
bash scripts/android-apk.sh   # builds release/Nakshakar-release.apk and -debug.apk
npm run desktop:exe        # builds release/desktop/Nakshakar-Setup.exe
node e2e/electron-smoke.mjs   # drives the packaged Windows app
```

Pushing to `main` or publishing a release deploys the website through `.github/workflows/pages.yml`: `site/`, the app at `/app/`, and the installers of the last 5 releases at `/downloads/`, so visitors never leave the site. The installers are uploaded to a GitHub Release by hand, because the Android signing key must stay off GitHub.

`scripts/android-apk.sh` creates a signing key on its first run.

> **Back up `android/gharnirman-release.jks` and `android/keystore.properties`.** Both are git-ignored. If they are lost, updates can no longer be installed over the existing app, because Android requires the same key.

Other helpers: `scripts/make-icons.mjs` regenerates launcher icons from `public/icon.svg`, and `scripts/capture-manual.mjs` retakes the guide's screenshots while the site is running.

To rename the app, change `APP_NAME` in `src/core/model/defaults.ts`, then `appName` and `appId` in `capacitor.config.ts`.

## How the code is organised

| Folder | Contents |
|---|---|
| `src/core/model` | Types, defaults, schema migrations. All lengths are millimetres |
| `src/core/units` | Parsing, formatting and conversion of lengths, areas, volumes, weights |
| `src/core/geometry` | Polygons, triangulation, wall junctions, room detection |
| `src/core/history` | Undo and redo as named Immer patches |
| `src/core/storage` | IndexedDB, filesystem safety copy, autosave |
| `src/editor2d` | Plan drawing, gestures, tools, snapping, edit commands |
| `src/viewer3d` | Merged-mesh house builder, walking physics, third-person character, world, catalogue pictures, orbit, walk, Explore, 360° and VR |
| `src/catalog` | Objects, doors, windows, stairs, plants, elevation styles, the sample house |
| `src/vastu` | Rules and scoring |
| `src/estimate` | Quantities, rates, schedule, curing |
| `src/print` | Vector PDF and SVG output, sharing |
| `src/ui`, `src/app` | Screens, dialogs, store, translations, theme |
| `e2e` | Playwright browser tests |
| `electron` | The Windows app's window |
| `site` | The landing page with Open site and Install app |

The plan is reduced to one list of drawing primitives (`src/editor2d/drawing.ts`). The canvas, the PDF and the print view all draw from it, so printed plans match the screen and stay true vectors.

See [DECISIONS.md](DECISIONS.md) for choices and known limits, and [PROGRESS.md](PROGRESS.md) for what has and has not been verified.

## Important limits

Nakshakar is a planning tool. It does not do structural design: a licensed engineer must design footings, columns, beams and slabs. Estimates are planning figures, and the starting prices in the app are placeholders that users should replace with local rates. Vastu is traditional guidance, and rules can be excluded from the score.
