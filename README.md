# Entity Compactor

A client-side Fabric mod for Minecraft 26.2 that stops big farms from tanking your FPS.

When hundreds of the same item, XP orb or mob are piled in one spot, your game draws every
single one. Entity Compactor draws only a few per spot (2 items of each kind per block, 4 mobs
of each kind per 2×2×2 blocks by default) and skips the rest. Players and name-tagged mobs are
always drawn.

It's visual only: nothing changes on the server, and the entities still exist and work.

## Install
1. Install Fabric Loader for 26.2 (fabricmc.net) and Fabric API.
2. Put `entity-compactor-1.0.1+26.2.jar` in `.minecraft/mods`.
3. Press **K** (or type **/compactor** in chat) to turn it on or off. You can change the key in
   Options > Controls > Key Binds, under "Entity Compactor".

Settings: `.minecraft/config/entitycompactor.properties` (restart after editing).

Works great alongside Sodium, Entity Culling and ImmediatelyFast.

## What's new in 1.0.1
- Piles at the edge of the screen, or partly behind you, no longer disappear. Only entities
  the game would actually draw count toward a pile now.
- Hitboxes (F3+B) work with piles. The game asks about each entity twice when they're on, and
  the second answer used to hide every pile entity's hitbox.
- New **K** key to toggle the mod.

## Tested in the real game
Every build starts Minecraft 26.2 with the mod in CI, both from the build and from the exact
jar that gets released. It builds a farm pile in a superflat world (600 item stacks, 252 mobs,
100 XP orbs and a name-tagged zombie) and compares frame times with the mod off and on. It also
checks that some of every pile is still drawn, that players and named mobs are never hidden,
that piles cut by the screen edge still show, that hitboxes still work, and that /compactor and
K toggle the mod. A release is only published when all of that passes.

On GitHub's GPU-less runners (Mesa software OpenGL), frames took about 2.2 to 2.3 times less
time with the mod on in that test. Your numbers will depend on your PC and your farm.
