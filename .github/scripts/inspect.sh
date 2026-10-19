#!/usr/bin/env bash
# Prints the real signatures of the game and Fabric API code the mod and its test use, so
# the build log shows they exist in 26.2 (and what to fix if they don't).
set -u
MC=$(find ~/.gradle/caches/fabric-loom -name 'minecraft-merged*26.2*.jar' -size +5M | grep -v sources | head -1)
jar_of() { find ~/.gradle/caches/modules-2 -name "$1-*.jar" ! -name '*sources*' | head -1; }
CP="$MC:$(jar_of fabric-client-gametest-api-v1):$(jar_of fabric-key-mapping-api-v1):$(jar_of fabric-lifecycle-events-v1)"
echo "classpath: $CP"

show() { # class [grep pattern]
  echo "== $1"
  if [ $# -gt 1 ]; then javap -cp "$CP" "$1" | grep -E "$2"; else javap -cp "$CP" "$1"; fi
}
show net.minecraft.client.renderer.entity.EntityRenderDispatcher 'shouldRender'
show net.minecraft.client.renderer.GameRenderer ' render|renderLevel|extract|update\('
show net.minecraft.client.Minecraft 'renderFrame|runTick| level;| player;| options;|getConnection|gameRenderer;'
show net.minecraft.client.Options 'enableVsync|framerateLimit|inactivityFpsLimit|hideGui|preferredGraphicsBackend'
show net.minecraft.client.InactivityFpsLimit
show net.minecraft.client.multiplayer.ClientLevel 'entitiesForRendering|getEntity\(int'
show net.minecraft.client.multiplayer.ClientPacketListener 'sendCommand'
show net.minecraft.client.KeyMapping 'KeyMapping\(|consumeClick'
show 'net.minecraft.client.KeyMapping$Category' 'register|label|id\('
echo "-- KeyMapping\$Category strings:"; javap -c -p -cp "$CP" 'net.minecraft.client.KeyMapping$Category' | grep -o 'String [a-z.]*' | sort -u
show net.minecraft.world.level.levelgen.Heightmap\$Types 'MOTION_BLOCKING'
show net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper
show net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents 'END_CLIENT_TICK'
show net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext
show net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext
show net.fabricmc.fabric.api.client.gametest.v1.context.TestServerContext
show net.fabricmc.fabric.api.client.gametest.v1.context.TestServerConnection 'waitForChunksRender'
show net.fabricmc.fabric.api.client.gametest.v1.TestInput 'pressKey'

# Who asks EntityRenderDispatcher.shouldRender (once per entity per frame, plus the F3+B
# hitbox view), and what a frame calls in order (extract, then render, then present).
work=$(mktemp -d)
(cd "$work" && unzip -q -o "$MC" 'net/minecraft/client/renderer/*' 'net/minecraft/client/Minecraft.class')
echo "== callers of EntityRenderDispatcher.shouldRender"
for f in $(grep -rl --include='*.class' 'shouldRender' "$work/net"); do
  cls=$(echo "${f#$work/}" | sed 's/\.class$//; s#/#.#g')
  javap -c -p -cp "$MC" "$cls" | awk -v c="$cls" '/^  [^ ].*\(/ {m=$0} /EntityRenderDispatcher.shouldRender/ {print c ":" m}' | sort -u
done
calls_in() { # class method-name-regex
  echo "== calls made by $1 $2"
  javap -c -p -cp "$MC" "$1" | awk -v pat="$2" '/^  [^ ].*\(/ {on = ($0 ~ pat)} on && /invoke/ {sub(/^ *[0-9]+: /, ""); print "   " $0}' | grep -vE 'java/lang|Profiler|ProfilerFiller' | head -80
}
calls_in net.minecraft.client.Minecraft ' renderFrame[(]'
calls_in net.minecraft.client.renderer.GameRenderer ' extract[(]net'
echo "== callers of LevelExtractor.isEntityVisible"
for f in $(grep -rl --include='*.class' 'isEntityVisible' "$work/net"); do
  cls=$(echo "${f#$work/}" | sed 's/\.class$//; s#/#.#g')
  javap -c -p -cp "$MC" "$cls" | awk -v c="$cls" '/^  [^ ].*[(]/ {m=$0} /isEntityVisible/ {print c ":" m}' | sort -u
done
calls_in net.minecraft.client.renderer.extract.LevelExtractor 'ntit'
