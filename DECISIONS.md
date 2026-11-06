# Decisions

The brief said to decide rather than ask. Each entry is one choice and its reason.

## The brief itself

- **The pasted brief ended at Part 4.7.** Parts 0 and 1 still require 3D, Vastu, estimates and PDF, so those were designed from what those parts say. If the original had Parts 5 onward, compare them with this build, because details may differ.
- **Build location is `gharnirman/`,** matching the repository layout in Part 1.1.

## Added at the owner's later request

- **Runs as a website on a laptop, with mouse drawing.** `Start Nakshakar Website.bat` serves the build locally, so the "no network" rule still holds.
- **Usability changes for mouse users:** welcome card, grouped tools that fit a laptop screen, hover previews, right-click menu, zoom buttons, keyboard shortcuts, a Saved indicator, and "More options" folding away rarely used fields.

## Platform

- **compileSdk 35, targetSdk 34.** Platform 35 is what is installed. Target 34 avoids Android 15's forced edge-to-edge layout. Google Play now expects a newer target, so raise it and test before any store release.
- **The INTERNET permission is removed from the Android manifest.** The app never needs it, and this enforces the offline rule rather than merely promising it. Verified on an Android 14 emulator.
- **A locally generated release key,** because the brief asks for a signed APK and no key was supplied. It is git-ignored and must be backed up.
- **`allowMixedContent: false`,** since all content is local.

## Storage

- **IndexedDB first, JSON file second.** The file copy is written to a temporary name and then renamed, so a kill mid-write leaves the previous copy whole.
- **Save within 300 ms of the last edit, 1 second at most during continuous editing.** This stays within the 2-second loss limit.
- **The filesystem copy is written at most every 5 seconds,** and whenever the app goes to the background, to limit wear. A project wiped from IndexedDB could lose up to that much, and it loses undo history, which is only in IndexedDB.
- **Android WebView has no `window.print`,** so on a device Print goes through the PDF and the system share sheet.

## Geometry and 3D

- **Walls are split at crossings and T-junctions, then mitred at each node,** so footprints tile with no gaps or overlaps. Tests compare the sum of footprint areas with their union.
- **Arcs are drawn as 15° chords, but all lengths use the true arc length.** The chord path alone would be about 0.3% short.
- **All geometry is merged into one mesh per texture, using vertex colours.** The sample house draws about 7,000 triangles in about 8 draw calls, which is what should keep phones smooth.
- **Sloped roofs cover the bounding rectangle of the top floor,** so an L-shaped house gets a simple roof over its whole rectangle.
- **Walking collides with walls but not furniture,** so a person cannot get trapped by a sofa.
- **Stereo VR is split-screen with no lens correction,** and WebXR is not used, so it works offline with simple phone headsets.

## PDF

- **Indic text in PDFs is an image.** jsPDF cannot shape Devanagari or Telugu and would break conjuncts and vowel signs, so such text is laid out by the browser with the bundled Noto fonts and embedded at high resolution. This differs from the brief's "fonts embedded", but it is the way to get correct text. Latin text and all plan lines remain vector.
- **Rupee amounts print as "Rs"** because the PDF's built-in Latin font has no ₹ sign.
- **Overlapping plan labels are dropped, not overprinted.** Room names win, then outer-wall dimensions. Anything dropped shows at a larger paper size or when zoomed in on screen.

## Estimates

- **Starting rates are planning placeholders written for this app,** not market data. The estimate screen warns about them until they are replaced.
- **Structural quantities use thumb rules,** and every line states its assumption.
- **Curing and prop periods follow IS 456:2000 clauses 13.5 and 11.3.1 as minimums.** These were written from knowledge of the standard and should be checked against a current copy before being relied on.
- **Ranges combine quantity allowances with a -8% to +12% rate spread.**

## Vastu

- **Compass zones use a 3 x 3 grid over the floor's extents, aligned to true north.** Rules follow commonly published guidance, schools differ, and every rule can be excluded.

## Languages

- **English, Hindi and Telugu cover all interface keys and generated report sentences,** enforced by tests. The translations have not had a native-speaker review. The Hindi and Telugu translations were not reviewed by a native speaker, and should be before release.
- **Tamil, Kannada, Malayalam, Marathi, Gujarati and Bengali have about 27 common words each,** and fall back to English, as the brief allows.

## Design

- **The app looks like a working tool, not a game.** Line icons replace emoji, one muted blue is the only accent, surfaces are flat, and the website is plain. The pink outfit stays because it was asked for.
- **Walls join corner after corner until Done.** Version 1.2 ended a wall after two points, at the user's request; in 2.0 they asked for the opposite with a clear way to stop, so drawing goes on until the big Done button at the top of the plan, Enter, Esc, a double tap, or closing the room. One wall at a time is a switch (C). Rectangles, slabs and the other two-point tools still finish by themselves.
- **Keyboard shortcuts use the physical key,** not the letter it types, so they work with a Hindi or Telugu layout switched on.
- **Moving a floor swaps it with its neighbour.** Standard names follow the position, so the bottom floor is always Ground Floor; a name the user typed stays with the floor. Stairs and wall heights are not adjusted automatically when floors of different heights swap.

## Version 2.0

- **Renamed to Nakshakar.** The old name was already taken. Storage keys inside the app (the database and settings names) keep the old name, so nobody's saved houses disappear; the user never sees them. Files shared as `.gharnirman` still open.
- **Two Android builds from one project.** The Google Play copy (`play`) is updated only by Google Play, because Play's policy forbids apps from installing their own updates; its update notice opens the Play Store. The website copy (`direct`) downloads the new APK from the website and hands it to Android's installer, which checks it is signed with the same key. Only the website copy has the install-packages permission.
- **The code is private; the website, downloads and a public copy live on a separate account.** The personal repository is private. The public repository `nakshakarapp-hue/nakshakar` hosts the website through GitHub Pages and holds the releases, so every address people see belongs to the app, not a person. Its history is published as one commit per release, authored as Nakshakar.
- **The website address still contains github.io.** Every mention was removed from the pages, the app and the installer, but the address itself can only change with a domain the user buys. The address lives in one constant in `src/app/update.ts`, in `electron/main.cjs` and in `AppUpdaterPlugin.java`.
- **The first run is a guided tour, not a card of choices.** It lights one control at a time and waits for a tap on it, as games teach. Everything else is blocked until it moves on, Skip is always there, and it runs once; the menu brings it back.
- **The plan can be turned with two fingers.** Text stays upright, the rulers hide while it is turned (they read along the screen edges), and the compass puts north back up. Rotation is part of the view only, never the drawing.
- **A stair is drawn by dragging from its bottom step to where it should reach.** The direction can be any angle, snapping square near the walls; the drag length sets the tread between 220 and 400 mm, since the number of steps follows the floor height.
- **Explore starts 7 m in front of the front door,** with a short camera swoop, instead of 50 m across a field, which the user found slow.
- **A box only saves what was typed in it.** A length box left focused while the item was dragged on the plan used to write its old number back when it lost focus; that was the "it goes back to the old length" bug.

## Undo, sizes and sharing

- **Undo belongs to the floor you are looking at.** Each floor keeps its own order of steps. A step across several floors, or one that adds, removes or reorders floors, is a barrier: it can only be undone once everything after it has been, because earlier work may depend on it. The History list keeps the single overall order, so nothing becomes unreachable.
- **A shared file is one readable JSON file, not an encrypted one.** It holds the whole design, so people should send it only to whoever they would show the drawings to. It carries no undo history, so a friend cannot see what was tried and removed.
- **A file from someone else is not trusted.** Colours and images must be exactly that or are replaced, keys that could reach an object's prototype are dropped, walls without valid points are removed, and files over 64 MB are refused. Opening one starts read-only; nothing is stored until the person chooses to keep a copy, and the copy gets its own identity, so it can never overwrite one of their projects.
- **On Android the app offers to open any file the phone cannot identify.** Files apps and WhatsApp hand over links with no file name in them, and Android does not know this file type, so matching on `.gharnirman` alone leaves nothing to tap. The cost is that Nakshakar appears in the Open with list for other unknown files; it refuses them with a message.
- **Sharing happens through whatever the person already uses.** The app writes a file and the phone's share sheet or the browser's download takes over. There is still no server and no account.

## The game and the website

- **The character is built from code, 1.70 m (5 ft 7 in) tall.** No rigged model with a licence we could check was reachable (the network blocks the free model sites), and a game's own model cannot be reused. It moves with weight shift, heel strike and an idle that breathes and looks round, but it still reads as a stylised person, not a game-studio character.
- **The player is an original character in a pink tracksuit, not a lookalike.** The user asked for Alok from Free Fire, then for something that looks exactly like him under another name. Alok is based on a real person and owned by Garena; copying his face and build is a likeness and copyright problem whatever it is called, and a takedown would hit the Play Store listing. So the character is original.
- **"Everything Adobe and Autodesk do" is not the goal.** The listed needs are covered: drawing, pictured catalogue, painting, plants, opening doors and windows, walking the house. Photo editing, BIM data exchange and similar are not.
- **Doors and windows open only for this session in the game.** Their open or shut state is not saved in the design, because it is a way of looking at a house rather than part of it.
- **A compound wall with no gate does not block the player.** Otherwise a wall drawn all the way round would lock them out. Trace plot adds a 3 m gate, and once a compound wall has a gate it does block.
- **The apps make exactly one network request: the public `version.json` file announcing new versions.** Everything else still works offline and nothing is sent. The Windows window refuses every other request; Android needs the INTERNET permission for it. This changes the original "no network at runtime" rule because the user asked for an update notice.
- **The repository is public** because GitHub Pages on a free account requires it. The Android signing key is git-ignored and is not in it.
- **The Windows installer is not code-signed,** because a certificate costs money. SmartScreen warns about it, and the install dialog on the website says so.
- **iPhone gets the Home Screen web app,** because an installable `.ipa` needs a Mac and a paid Apple developer account.

## Known gaps in the model

These fields are stored and editable but have limited effect so far:

- Site slope feeds the Vastu check, but the 3D ground stays flat.
- Polyline walls work in the geometry engine, but no tool draws one; chains are separate joined walls.
- Version comparison shows counts and area side by side, not a visual difference.
