# Beacon Isle 🗼

A 3D adventure game that runs in the browser. A storm has shattered the lighthouse lens and flung it across the island. Explore the isle, find the five lens shards, and relight the beacon before the ships sail home in the dark.

## Play

Open `index.html` in a browser. No install or build step is needed. The game saves your progress in the browser as you go.

| Action | Keyboard and mouse | Touch screen |
| --- | --- | --- |
| Move | `W` `A` `S` `D` (`↑` `↓` also walk) | Left thumb stick |
| Look around | Drag the mouse, or `←` `→` | Drag on the scene |
| Jump | `Space` | **Jump** |
| Run | Hold `Shift` | Drag the stick well past its edge |
| Swing the lantern staff | `F`, `J` or a click | **Swing** |
| Talk, read, open | `E` or `Enter` | **Use** |
| Zoom | Mouse wheel | |
| Pause / sound | `P` or `Esc` / `M` | **Pause** / **Sound on** |

## The quest

Talk to Odell the keeper at the lighthouse first. He marks the five shards on your map.

| Shard | Where | What stands in the way |
| --- | --- | --- |
| Whisperwood | The grove in the western forest | Four gloomlings seal it in gloom. Scatter them with your staff. |
| Mount Kestrel | The spire on the mountain top | A spiral of stone steps to jump up. |
| The Old Vault | The ruin in the east | A locked gate. The key is in a sea chest on the islet, across the stepping stones. |
| The Stone Ring | The middle of the isle | Three rune stones to wake in the right order. The tablet holds the riddle. |
| Pip the trader | The camp west of the crossroads | Pip wants 20 coins. |

Gloomlings cost you a heart when they touch you. Two swings of the staff scatter one, and it drops coins. Red hearts refill two of yours. If you run out, you wake up at the nearest safe place with nothing lost. With all five shards, go to the lighthouse door.

## Develop

```sh
npm test   # from the repository root: runs the rule and island tests with Node's built-in test runner
```

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | Page layout, the screens and the on-screen display |
| `src/island.js` | The island's shape: height map, named places, paths, and where trees, coins and gloomlings go (no DOM) |
| `src/rules.js` | Quest rules: hearts, coins, shards, the rune puzzle, the gate, the trade, what each islander says, saving (no DOM) |
| `src/world.js` | Builds the 3D scene: ground, sea, sky, plants, the lighthouse, vault, ring and spire |
| `src/actors.js` | The explorer, the islanders, gloomlings, pickups and sparkles |
| `src/gfx.js` | Small drawing helpers shared by the world and the actors |
| `src/input.js` | Keyboard, mouse and touch controls |
| `src/sound.js` | Sound effects made with the Web Audio API |
| `src/ui.js` | Hearts, counters, the map, speech and the title, pause and win screens |
| `src/main.js` | The game loop: movement, collisions, gloomlings, the camera and the quest |
| `vendor/three.min.js` | [three.js](https://threejs.org) r149, MIT licence (see `vendor/THREE-LICENSE`) |

The island is generated from a fixed seed, so it is the same every time. To reshape it, edit `PLACES`, `FLATS` and `PATHS` in `src/island.js`; `test/island.test.js` checks that everything is still on dry land and every jump can still be made. To retune the quest, edit the constants at the top of `src/rules.js` (`SHARD_PRICE`, `MAX_HEARTS`, `RUNE_ORDER`). Movement speeds and jump strength are at the top of `src/main.js`.

On a slow device the game first renders fewer pixels and then turns shadows off. `BI.debug` in the browser console gives access to the player, the game state and a `teleport(x, z)` helper for testing.
