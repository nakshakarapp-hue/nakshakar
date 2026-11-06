# Progress

A box is ticked only after it was verified. Evidence is noted as:

- **unit:** Vitest
- **web:** Playwright with real pointer, touch and keyboard input
- **Android:** driven on an Android 14 x86_64 emulator with the signed APK, in airplane mode unless noted
- **visual:** a screenshot or rendered page was inspected

## Definition of done (Part 0.2)

- [x] Installs from the APK and opens without a network (Android, emulator only)
- [x] Vastu, estimate and floor plan PDF generate offline (web offline; PDF made on Android)
- [x] Force-close loses at most 2 seconds (web and Android; saved within about a second)
- [x] Unit tests pass, the production build passes, APKs produced
- [ ] **A two-storey house drawn in under 10 minutes.** Not timed with a real person
- [ ] **30 fps or better on a 2 GB mid-range phone, 3 storeys.** **Not measured.** No physical phone was available, and the software-rendered emulator cannot show this. Resolution adapts automatically on slow phones, and View options shows an fps counter for checking on a real device. Shadows and the world add load that needs checking on a real phone
- [ ] A clean physical Android device. Emulator only so far

## Rules (Part 0.1)

- [x] No login, accounts, cloud, analytics, ads or keyed SDKs
- [x] No network at runtime (web: no foreign requests; Android: no INTERNET permission)
- [x] Autosave; data survives force-stop (Android) and page kill (web)
- [x] Safety copy restores a project after IndexedDB is wiped (Android, debug build, visual)
- [x] Items resizable and recolourable
- [x] Money, quantities and days always shown as minimum, likely and maximum (unit, web)

## Units (Part 3)

- [x] All listed length, area, volume and weight forms (unit)
- [x] 100% coverage enforced, well over 150 cases (unit)
- [x] Fractions, friendly errors, secondary-unit preview (unit, web)
- [x] Unit converter including Indian land units (web)
- [x] Display precision choice

## 2D editor (Part 4)

- [x] Pan and zoom canvas with adaptive grid, rulers, mini-map, compass (visual)
- [x] One-finger drawing, two-finger pinch and pan, long press, double tap (web touch)
- [x] Wheel zoom, right-drag and Space-drag pan, Shift constrain, keyboard shortcuts (web)
- [ ] Stylus palm rejection. Written but not tried on real stylus hardware
- [x] Numeric wall entry, drag drawing, room wizard with all shapes, perimeter table, trace plot (web)
- [x] Rectangle, polygon, arc, offset and split tools, plus measure and label (web)
- [x] Typed length change with connected walls following; start, end or both (unit, web)
- [x] Mitre, T and cross junctions with no gaps or overlaps (unit)
- [x] Wall height per wall, floor or all; gable tops (unit for gable geometry)
- [x] Lasso, box select, tap to add; move, rotate, mirror, copy, paste to another floor, delete (web)
- [x] Lock, hide and layer controls
- [x] Snapping with toggles and smart guides (unit)
- [ ] Haptic tick on snap. Calls the plugin (seen in Android logs), but vibration cannot be felt on an emulator
- [x] Typed constraints: parallel, perpendicular, equal (unit)
- [x] Close-loop assistant (web)
- [x] Automatic chain dimensions, manual dimensions, room labels, text never overprints (unit, visual)
- [x] Undo and redo with named steps; last 200 steps after relaunch (unit, web)
- [x] Automatic and named versions; restore, compare, duplicate (web; 10-minute timer not waited for)
- [x] Polygon operations, triangulation with holes (unit, 3,000-case stress run during development)
- [x] Room detection: rectangle, L, courtyard, T, overlaps, tiny and curved walls (unit)

## 3D

- [x] House builder: walls, openings, stairs, slabs, roofs, furniture, plants (unit, visual)
- [x] Orbit, cutaway, night, doors open or shut, sky, shadows and surroundings (web, visual)
- [x] Orbit and walk mode open and render on Android (visual). The emulator showed 20 fps in software rendering, which says nothing either way about a real phone
- [x] Walking: wall collision, door gaps, climbing and descending stairs (unit, visual)
- [x] Stereo VR view renders (visual)
- [ ] VR and 360° head tracking with a real motion sensor. No sensor on the laptop or in this test; the app shows a message when none reports

## Game, painting and easier editing

- [x] Rooms added one after another from one panel, joining up with shared walls (unit, web phone, visual)
- [x] Doors and furniture go in automatically, with nothing in a door's swing (unit)
- [x] Room resized by typing; room dragged with its walls; room deleted while keeping a neighbour's wall (unit)
- [x] Phone layout: bottom navigation and a More sheet (web phone, visual)
- [x] Separate library sections with a real picture of every door, window, stair, wall, pillar, plant and object (web: checked that none are blank)
- [x] Painting on the plan and in 3D (web)
- [x] Plants and furniture placed by tapping in 3D (web)
- [x] Explore page starts 50 m from the house (unit, web, visual)
- [x] Third-person character with walk, run and jump; stick for the body, swipe for the view (web, visual)
- [x] Doors open and close, and shut doors block the way (unit, web)
- [ ] Windows opening was tested as moving parts in unit tests, but not by hand on every window style
- [ ] How the game feels with fingers on a real phone. Touch was simulated in a browser

- [x] Wall, rectangle, polygon, arc, beam and measure tools finish and return to Select (web)
- [x] Keyboard: numbers, Enter, Delete, arrows, letters and shortcuts screen (web)
- [x] W A S D from Orbit and with a non-English layout (web, simulated layout)
- [x] Floors moved up and down, keeping levels and heights in order (unit, web)

## Version 1.3.0: floors, stairs, sizes and sharing

- [x] Undo and Redo stay on the current floor; a floor can be moved without breaking them; History still goes back in overall order (unit, web)
- [x] Stairs face four directions before and after placing, turn left or right, and turn about their middle (unit, web, visual in plan and 3D for straight, L, U and spiral)
- [x] Slab drawn with two corners, stays a rectangle, width and length typed (unit, web, visual)
- [x] Size beside every selected item; typing a number opens the sizes; corner and round handles drag on the plan (unit, web, phone size)
- [x] Done on every panel and dialog (web)
- [x] Recent is the first tab of the library, and survives a reload (web)
- [x] A black frame when a slow device lowered its sharpness is gone: 36 brightness checks over 6 runs (web)
- [x] Share file: made in one browser and opened in another with nothing saved; read-only view; own copy; bad file refused; a harmful colour value neutralised (unit, web)
- [x] Android 14 emulator in airplane mode with the signed APK: Open a shared file through the picker, Save to my projects, read-only view, share sheet shows the file, tapping the file in the Files app opens the app, a bad file is refused (Android, visual)
- [x] Windows unpacked app started with a shared file as its argument shows the card and read-only view (automated)
- [ ] Double-clicking a `.gharnirman` file on Windows. The association is set by the installer, and the installer wizard was not clicked through
- [ ] Sending and opening through real WhatsApp, between two real phones. The share sheet and a Files app link were tested on an emulator with no WhatsApp installed
- [ ] Opening a shared file on iPhone. Only the in-page picker exists there, and iOS has never been run
- [ ] The character's look is a judgement call: proportions were checked in screenshots against a 2.1 m door, not by anyone but the developer

## Installers and website

- [x] Windows installer builds; the unpacked app was driven with no network requests (automated). The installer wizard itself was not clicked through
- [x] Signed APK builds
- [x] Signed APK 1.3.0 installed on the Android 14 emulator in airplane mode, version and no INTERNET permission checked
- [x] Signed APK 1.2.0 on the Android 14 emulator: installed in airplane mode, no INTERNET permission, sample and Rooms panel opened, Explore started and the stick walked the character from 50 m to 38 m (Android, visual)
- [x] Version 1.3.0 live: both downloads match the local builds by SHA-256, offline reload works, and a house was shared between two browsers on the live site with no outside requests (automated browser against the live site)
- [x] Website live on GitHub Pages: Open site opens a new tab, works offline after the first visit, and both downloads match the local builds (automated browser against the live site)

## Other features

- [x] Vastu rules, score, suggestions, excluding rules (unit, web, visual)
- [x] Estimate: quantities, rates, materials, schedule, curing, assumptions (unit, web, visual)
- [x] PDF: vector plans, schedules, Vastu, estimate (web; vector paths counted; visual)
- [x] Hindi PDF with correct shaping (visual)
- [x] PDF written to device storage on Android
- [x] Android share sheet opens with the PDF (Android, visual)
- [x] Hindi and Telugu interface complete (unit); other six partial with English fallback (unit)
- [ ] Native-speaker review of translations
- [x] Generated report sentences in Hindi and Telugu (unit: every sentence the estimate, Vastu and history can produce)
- [x] Light, dark and outdoor themes (web, visual)
- [x] 44 px touch targets (web, phone size)

## Platforms

- [x] Laptop browser (web)
- [x] Android phone size (emulator)
- [ ] Android tablet. Layout tested at tablet size in a browser only
- [ ] iPhone and iPad. Project generated, but it has **never been built or run**: this needs a Mac

## Not implemented or partial

See "Known gaps in the model" in [DECISIONS.md](DECISIONS.md).
