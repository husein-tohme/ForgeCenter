# Entity Compactor

A client-side Fabric mod for Minecraft 26.2 that stops big farms from tanking your FPS.

When hundreds of the same item, XP orb or mob are piled in one spot, your game draws every
single one. Entity Compactor draws only a few per spot (2 items of each kind per block, 4 mobs
of each kind per 2×2×2 blocks by default) and skips the rest. Players and name-tagged mobs are
always drawn.

It's visual only: nothing changes on the server, and the entities still exist and work.

## Install
1. Install Fabric Loader for 26.2 (fabricmc.net) and Fabric API.
2. Put `entity-compactor-1.0.0+26.2.jar` in `.minecraft/mods`.
3. Type **/compactor** in chat to turn it on or off.

Settings: `.minecraft/config/entitycompactor.properties` (restart after editing).

Works great alongside Sodium, Entity Culling and ImmediatelyFast.
