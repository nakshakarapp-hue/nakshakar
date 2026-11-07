# Changelog

## 2.0.3

- Walking: walls and shut doors always stop you, even on a slow phone. Before, a slow frame could carry you straight through the front door and out the back

## 2.0.2

- Android: tapping Update again after closing the install prompt now starts a fresh download instead of waiting forever
- The website counts visits and download clicks, with no cookies and no personal data. The app itself counts nothing

## 2.0.1

- The Home screen fits small phones: the heading, name box and buttons no longer run off the right edge
- Downloads come straight from the release files, so the website loads faster

## 2.0.0

GharNirman is now **Nakshakar**.

- New name, on the website, the apps and the installers. Houses saved before keep working, and `.gharnirman` files still open
- Your first house is taught step by step: the button to press lights up, and the guide waits for you to tap it. Replay it from the menu
- An update notice with the new version's number, date and changes. On Android, Update downloads and installs it; on Windows it opens the download page
- The website and downloads moved to their own home: nakshakarapp-hue.github.io/nakshakar
- Built for Android 16, with a privacy policy page on the website
- Walls keep joining corner after corner until you press Done
- Draw stairs by dragging, at any angle. Type an exact angle, or Flip them
- Add to your house lists the frame first: pillars, beams and slabs, then walls, doors and windows
- Turn the plan with two fingers on a touchscreen; tap the compass to put north up
- Explore starts right in front of the house, with the camera swooping down behind the character
- The character is 5 ft 7 in, and walks with weight shift, heel strike and a natural idle
- A new Home screen and a clearer Estimate, with the cost range and each stage as a bar
- Fixed: a size dragged on the plan could jump back to the old number when a size box was open
- Fixed: each floor's Undo only takes back that floor. A second Undo no longer removes a floor you just added


## 1.3.0

Send a house to a friend, and change anything after adding it.

- Share a house as a `.gharnirman` file. Whoever opens it can look through the house, or keep a copy in their own projects
- Undo and Redo work floor by floor: undoing on the Ground Floor leaves your work on the First Floor alone. The History list still goes back through everything, in order
- Stairs: face any of four directions before placing (R key or the Rotate button) or afterwards, turn left or right, and turn by dragging a handle. A stair now turns about its middle, and mirrors correctly
- Stair handrails follow the shape of the stair, in plan and in 3D
- Slabs: draw one with two corners, type its width and length, drag its corners; it stays a rectangle
- Sizes: every selected item shows its size on the plan. Tap it, or just start typing, to change it. Drag handles on objects, pillars, plants, stairs, slabs, beams, doors and windows
- A Done button on every panel and dialog, with a note that changes are saved
- Add panel opens on Recent, with whatever you last used
- A wall's height and thickness can be typed where its length is
- The character is 1.63 m tall, with more natural proportions and a camera over the shoulder
- Fixed: on a slow device the 3D view could flash black when it lowered its sharpness
- Fixed: the welcome card could stay on top of items placed on a floor with no walls

## 1.2.0

A more serious look, and fewer steps.

- Website: downloads for Windows, Android and iPhone in one section, with every version, served from the site itself; and a gallery of 42 screens

- New design on every screen: calm colours, line icons instead of emoji, a plan that reads like an architect's drawing, and a plainer website
- One clean toolbar: the row of menu items moved into a grouped Menu, and less common tools into All items
- Selected items show a row of icon actions, and Home, Vastu, Estimate and Print are clearer
- Dialogs fill the phone screen
- A wall ends after two points and the tool returns to Select. Add another draws the next one, and connected walls can be switched on
- The same for rectangles, polygons, arcs, beams and measurements
- Keyboard: type a number to set a size, Enter, Delete, arrow keys to nudge, letters for every main tool, Page Up and Page Down for floors, and ? for the full list
- W A S D now works from the 3D button as well, and with any keyboard layout. Shift runs, arrow keys turn the view, F switches to first person
- Rooms panel shows a dashed preview on the plan before adding, and Enter adds
- Best fit keeps the house compact instead of one long line
- Floors: a stack on the plan to switch and add, clearer choices when adding, and arrows to move a floor up or down
- Library search
- Quieter surroundings in 3D: softer sky and clouds, rounded trees, gentle hills

## 1.1.0

Easier on phones, and the house becomes a place to walk around in.

- Add rooms one after another from one panel: type, size, side, then Add. Doors, windows and furniture go in automatically
- New phone layout with bottom navigation; everything else is under More
- Library with separate sections and a real picture of each item; 124 objects, 20 doors, 15 windows, 26 plants
- Paint walls, floors, ceilings, roofs and items, on the plan or in 3D, from a 24-colour chart or any colour
- Explore page: start 50 metres from the house and walk to it with an original third-person character
- One stick moves the body and a swipe turns the view; run, jump and a first-person view
- Open and close doors and windows; shut doors block the way
- Sky, sun shadows, road, trees and hills around the house; add plants and furniture from inside 3D
- Type a room's size, drag a room with its walls, delete a room
- Reports fully translated into Hindi and Telugu
- Windows installer, offline website, and a landing page with Open site and Install app

## 1.0.0

First complete build.

- 2D plan editor with typed sizes, mouse and touch drawing, room wizard, perimeter table and plot tracing
- Automatic room detection, smart wall junctions, snapping, undo history and saved versions
- 3D orbit, walkthrough, 360° and split-screen VR
- Vastu report, and an estimate with cost, materials, schedule and curing, always as ranges
- PDF plans and reports; Android share sheet; browser printing
- Autosave with a filesystem safety copy; fully offline
- English, Hindi and Telugu interface, with six more languages partially translated
- Website launcher for laptops, plus signed and debug Android APKs
