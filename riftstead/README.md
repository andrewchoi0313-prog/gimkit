# Riftstead 🧱

A 3D building and adventure game that runs in the browser. Build a home out of blocks on the Stead, step through portals to three other worlds, win weapons from the monsters there, and topple the Stone Giant in its fortress.

## Play

Open `index.html` in a browser. No install or build step is needed. Your world, including everything you build, is saved in the browser as you go.

| Action | Keyboard and mouse | Touch screen |
| --- | --- | --- |
| Move | `W` `A` `S` `D` (`↑` `↓` also walk) | Left thumb stick |
| Look around | Drag the mouse, or `←` `→` | Drag on the scene |
| Jump / run | `Space` / hold `Shift` | **Jump** / drag the stick well past its edge |
| Fight | `F`, `J` or a click | **Swing** (or **Shoot**) |
| Switch between fighting and building | `B` | **Build** / **Fight** |
| Pick a weapon or block | `1`–`7`, or `Q` for the next one | Tap it in the bar |
| Place a block | Click where the outline shows | Tap the spot |
| Remove a block | Right-click it, or `X` then click | **Remove**, then tap it |
| Talk, read, open doors | `E` or `Enter` | **Use** |
| Zoom / pause / sound | Mouse wheel / `P` or `Esc` / `M` | **Pause** / **Sound on** |

## Building

Press `B` and the bar turns into blocks: planks, logs, stone, brick, glass, roof tiles and a door. You never run out. A block has to rest on the ground or touch another block, and you can only reach about ten blocks away. Blocks are solid: you can stand on them, and monsters cannot get through them. Doors open and shut with `E`. The homestead plot by the campfire is perfectly flat, so walls sit flush there, but you can build anywhere except right next to a portal or the fortress.

## The world

The Stead is a large island with six kinds of country: meadow, forest, desert, snowy hills, swamp and the blighted land around the fortress. A full day and night takes about seven minutes. More monsters come out after dark, including wisps that fly, so walls and a roof are worth having.

Talk to Wren by the campfire first. Wren marks three portals on your map. Each leads to a world with a rift crystal:

| Portal | World | Getting the crystal |
| --- | --- | --- |
| Eastern desert | **Ember Deep**: rock and rivers of lava under a red sky | Hop the stepping stones, or build a bridge, across the lava ring. Lava costs a heart. |
| Snowy hills in the north | **Frost Hollow**: a blizzard and a slippery frozen lake | Jump up the ice steps, or stack blocks, to the top of the pillar. |
| Windy Tor in the western forest | **Cloud Garden**: floating islands and low gravity | Leap from island to island to the last one. A fall just carries you back. |

A crystal warden guards each one. With all three crystals the seal on the fortress breaks.

## Monsters and weapons

You start with a stick. Monsters drop the rest:

| Weapon | Damage (level 1 to 3) | What it is like |
| --- | --- | --- |
| Stick | 1 | What you start with |
| Sword | 2, 3, 4 | Fast |
| Axe | 4, 5, 7 | Slow and heavy, with a wide swing and a big knock-back |
| Blaster | 3, 4, 5 | Rare. Shoots bolts at the nearest monster in front of you |

Picking up a weapon you already have makes it one level stronger. The first sword and axe are promised after a few fights; the blaster is a rare roll (about 2 in 100 on the Stead, better in the other worlds). Monsters also drop hearts, and hearts come back slowly when nothing has hit you for a while. Blobs hop at you, brutes walk up and slam the ground, and wisps fly and dive.

## The Stone Giant

The giant waits in the fortress in the north-east. It swipes when you are close, stomps to send a shockwave across the floor (jump over it), and calls shades when it is hurt. If you are knocked out it gets only a little health back, so each try gets further. Walk out of the arena and it recovers completely.

## Develop

```sh
npm test   # from the repository root: runs the tests with Node's built-in test runner
```

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | Page layout, the screens and the on-screen display |
| `src/zones.js` | The shape of every zone: height maps, biomes, portals, plants, monster dens, the monster list (no DOM) |
| `src/rules.js` | Hearts, weapons and drops, crystals, the day and night clock, what Wren says, saving (no DOM) |
| `src/blocks.js` | Where blocks are, where one may go, and finding the cell being pointed at (no DOM) |
| `src/physics.js` | What a body stands on and bumps into: land, fixed solids and blocks (no DOM) |
| `src/world.js` | Builds the 3D scenery: sky, ground, plants, portals, the fortress, lava, ice and islands |
| `src/actors.js` | The builder, Wren, the three kinds of monster, the giant, weapons and pickups |
| `src/builder.js` | Draws the placed blocks and the outline for the next one |
| `src/monsters.js`, `src/boss.js` | How monsters and the giant behave |
| `src/gfx.js`, `src/sound.js`, `src/input.js`, `src/ui.js` | Drawing helpers and block textures, sound effects, controls, and the on-screen display |
| `src/main.js` | The game loop: movement, fighting, building, portals, the camera and saving |
| `vendor/three.min.js` | [three.js](https://threejs.org) r149, MIT licence (see `vendor/THREE-LICENSE`) |

The world is generated from fixed seeds, so it is the same every time. To reshape it, edit the zone definitions in `src/zones.js`; `test/zones.test.js` checks that landmarks stay on dry land and every jump on the way to a crystal can still be made. Weapon numbers, drop chances and the length of the day are at the top of `src/rules.js`, monster stats are in `SPECIES` in `src/zones.js`, and the block list is `PALETTE` in `src/blocks.js` (a new block also needs a texture in `paintBlock` in `src/gfx.js`).

On a slow device the game first renders fewer pixels and then turns shadows off. `RS.debug` in the browser console gives access to the player and the game state, with `teleport(x, z)` and `travel('ember')` helpers for testing.
