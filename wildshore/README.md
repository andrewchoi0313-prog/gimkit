# Wildshore ⛵

A free-roaming 3D adventure that runs in the browser. You wake in a two-storey house on Hearth Isle with a fire in the hearth, a boat at the dock and six more islands across the water. Hunt for meat by day, fight or sleep through the monsters at night, and sail out to find every island's treasure chest. There is no building in this one and no portals: just a big world to explore.

## Play

Open `index.html` in a browser. No install or build step is needed. Progress is saved in the browser as you go.

| Action | Keyboard and mouse | Touch screen |
| --- | --- | --- |
| Move, or row the boat | `W` `A` `S` `D` (`↑` `↓` also work) | Left thumb stick |
| Look around | Drag the mouse, or `←` `→` | Drag on the scene |
| Jump / run (or row faster) | `Space` / hold `Shift` | **Jump** / drag the stick well past its edge |
| Swim up / dive | Hold `Space` / hold `Shift` | Hold **Up** / hold **Dive** (the Jump and Swing buttons change in the water) |
| Fight | `F`, `J` or a click | **Swing** (or **Shoot**) |
| Pick a weapon | `1`–`4`, or `Q` for the next one | Tap it in the bar |
| Eat a piece of meat | `R` | **Eat** |
| Doors, the note, the bed, the boat, chests | `E` or `Enter` | **Use** |
| Zoom / pause / sound | Mouse wheel / `P` or `Esc` / `M` | **Pause** / **Sound on** |

## The world

Seven islands, with about ten times the land of Riftstead:

| Island | Where | What it is like |
| --- | --- | --- |
| Hearth Isle | The middle | Meadows and western woods. Your house and the dock are on its south shore. A path runs north to Stillwater, a lake with lily pads and reeds, and up Lookout Hill. |
| Petal Cay | South | Blossom trees. The shortest trip from the dock. |
| Mirefen | South-west | Swamp |
| Pinewatch | North-west | Thick forest |
| Winterholm | North | Snowy hills under a tall summit. Its chest is high on the mountain. |
| Cinder Rock | North-east | Blighted crags round a volcano with a glowing crater |
| Sunscar | South-east | Desert |

Each of the six far islands hides a chest at its heart, on a small level terrace, marked in gold on the map. The chests hold swords, axes and, on Winterholm and Cinder Rock, a blaster.

**The house** has two floors joined by stairs, a fireplace, a table with a note, a bookshelf, and a bed upstairs. Monsters cannot get through its walls. Sleeping in the bed at night skips to morning and refills your hearts.

**The boat** is tied up at the dock south of the front door. Press `E` to board, row with the movement keys, and press `E` again close to land to step ashore. If you are knocked out you wake at home, and the boat is back at the dock.

## Swimming

Walk into deep water and you float with your head above the surface. Hold `Shift` to dive and `Space` to come back up; let go and you drift up by yourself. Under water there are reefs of coral and weed round every island, with bright fish swimming over them.

You can hold your breath for ten seconds. After that you lose a heart every two seconds until you surface. The **snorkel mask** on the table in the house (press `E` beside it) lets you stay under for as long as you like.

Sharks patrol the deep water away from the shores, by day and by night. They chase swimmers and bite, but they will not follow into the shallows and they ignore the boat. The lake is fresh water: fish live in it, but no coral and no sharks.

## Animals and monsters

Sheep, cows, pigs, deer and chickens live wild on the islands, and fish swim in the shallows. They never attack, they run when hurt, and each leaves meat (cows and deer leave two pieces). Eating a piece of meat wins back two hearts.

Monsters only come out at night, and every one of them vanishes at sunrise. There are 240 monster dens across the islands, about three times as many as Riftstead had, and the far islands have tougher kinds. Blobs hop at you, brutes walk up and slam the ground, and wisps fly and dive. Monsters drop hearts and weapons: a sword and an axe are promised after a few fights, and a blaster is a rare drop. Finding a weapon you already own makes it one level stronger.

A full day and night takes about seven minutes.

## Develop

```sh
npm test   # from the repository root: runs the tests with Node's built-in test runner
```

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | Page layout, the screens and the on-screen display |
| `src/zones.js` | The islands: height map, the lake, hill, summit and volcano, biomes, plants, monster dens, animals, reefs, sharks, the dock and chests (no DOM) |
| `src/rules.js` | Hearts, meat, breath and the mask, weapons and drops, islands and chests, the clock, saving (no DOM) |
| `src/house.js` | The plan of the house: blocks, stairs and where the furniture stands (no DOM) |
| `src/blocks.js`, `src/physics.js` | The block grid the house is made of, and collisions (no DOM) |
| `src/world.js` | Builds the 3D scenery: sky, ground, sea, plants, the dock, furniture and chests |
| `src/actors.js` | The explorer, monsters, animals, the boat, weapons and pickups |
| `src/monsters.js` | How monsters, animals and fish behave |
| `src/builder.js`, `src/gfx.js`, `src/sound.js`, `src/input.js`, `src/ui.js` | Block drawing, drawing helpers, sound effects, controls, and the on-screen display |
| `src/main.js` | The game loop: walking, fighting, hunting, the boat, the camera and saving |
| `vendor/three.min.js` | [three.js](https://threejs.org) r149, MIT licence (see `vendor/THREE-LICENSE`) |

The world is generated from fixed seeds, so it is the same every time. Islands are listed in `ISLANDS` in `src/zones.js`, creature stats in `SPECIES`, and which creatures live in which kind of country in `MONSTERS` and `ANIMALS`. Chest contents and weapon numbers are at the top of `src/rules.js`.

**How it is drawn.** The land is one smooth surface: triangles share their corners, so light rolls over the hills without facets, and every corner has its own colour, so grass fades into sand, sand into the seabed, meadow into woods, and paths and bare rock are blended in by distance and steepness (`groundColor` in `src/world.js`). Trees, rocks, coral and creatures are built from smooth balls, capsules and cones, painted darker below and lighter on top (`ball`, `soft`, `shadeByHeight` and `mergeSmooth` in `src/gfx.js`). The sea is pale and clear in the shallows and darker with depth, and its swell is gentler near the shore. Trees, rocks, flowers and coral are drawn in patches of land. A patch close to the camera is drawn with its full, round shapes; one further off uses simpler shapes with the same outline; and patches lost in the fog, small things a long way off, and coral that cannot be seen through the water are skipped (`instanced` and `view.cull` in `src/world.js`). That keeps the smooth shapes from costing more than the old blocky ones did.

This game was forked from `riftstead/` and shares its engine. On a slow device it first renders fewer pixels and then turns shadows off. `WS.debug` in the browser console gives access to the player and the game state, with a `teleport(x, z)` helper for testing.
