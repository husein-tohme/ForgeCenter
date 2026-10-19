package dev.forgecenter.compactor.test;

import dev.forgecenter.compactor.Compactor;
import dev.forgecenter.compactor.Settings;
import it.unimi.dsi.fastutil.ints.IntIterator;
import it.unimi.dsi.fastutil.ints.IntOpenHashSet;
import java.util.HashMap;
import java.util.Map;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;

/**
 * Looks at a pile cut in half by the edge of the screen. With the mod on, every pile must
 * still draw as many of its on-screen members as its limit allows: entities the game wasn't
 * going to draw anyway (off-screen) must not use up a pile's slots.
 */
final class EdgeCheck {
    /** splitPiles: piles the screen edge cuts through. shortPiles: piles drawing fewer than they should. */
    record Result(int visibleOff, int drawnOn, int splitPiles, int shortPiles, int extraDrawn, String firstShort) {}

    private EdgeCheck() {}

    static Result run(ClientGameTestContext context) {
        IntOpenHashSet visible = drawnIds(context, false);
        IntOpenHashSet drawn = drawnIds(context, true);
        return context.computeOnClient(mc -> compare(mc, visible, drawn));
    }

    /** The ids of every entity drawn in one frame, with the mod off or on. */
    private static IntOpenHashSet drawnIds(ClientGameTestContext context, boolean modOn) {
        context.runOnClient(mc -> {
            Settings.enabled = modOn;
            FrameProbe.reset();
        });
        context.waitFor(mc -> FrameProbe.framesSinceReset() >= 5, 20 * 60);
        context.runOnClient(mc -> FrameProbe.captureNextFrame());
        context.waitFor(mc -> FrameProbe.capturedFrame() != null, 20 * 60);
        return context.computeOnClient(mc -> FrameProbe.capturedFrame());
    }

    private static Result compare(Minecraft mc, IntOpenHashSet visible, IntOpenHashSet drawn) {
        Map<Compactor.Pile, int[]> piles = new HashMap<>(); // members, on screen with the mod off, drawn with it on
        for (Entity entity : mc.level.entitiesForRendering()) {
            Compactor.Pile pile = Compactor.pileOf(entity);
            if (pile == null) continue;
            int[] c = piles.computeIfAbsent(pile, p -> new int[3]);
            c[0]++;
            if (visible.contains(entity.getId())) c[1]++;
            if (drawn.contains(entity.getId())) c[2]++;
        }
        int split = 0, shortPiles = 0, extra = 0;
        String firstShort = "";
        for (Map.Entry<Compactor.Pile, int[]> entry : piles.entrySet()) {
            int[] c = entry.getValue();
            if (c[1] > 0 && c[1] < c[0]) split++;
            if (c[2] < Math.min(entry.getKey().limit(), c[1])) {
                if (shortPiles++ == 0) firstShort = entry.getKey() + " members=" + c[0] + " onScreen=" + c[1] + " drawn=" + c[2];
            }
        }
        for (IntIterator it = drawn.iterator(); it.hasNext(); ) {
            if (!visible.contains(it.nextInt())) extra++;
        }
        return new Result(visible.size(), drawn.size(), split, shortPiles, extra, firstShort);
    }
}
