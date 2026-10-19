package dev.forgecenter.compactor.test;

import dev.forgecenter.compactor.Compactor;
import dev.forgecenter.compactor.Settings;
import it.unimi.dsi.fastutil.ints.IntIterator;
import it.unimi.dsi.fastutil.ints.IntOpenHashSet;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;

/**
 * Compares one frame of the current view with the mod off and on. With the mod on, every pile
 * must draw as many of its on-screen members as its limit allows, the mod may only hide
 * (never add), and its hidden count must match what was really hidden.
 */
final class ViewCheck {
    /** splitPiles: piles the screen edge cuts through. shortPiles: piles drawing fewer than they should. */
    record Result(int visibleOff, int drawnOn, int hiddenReported, int repeatsOn, int splitPiles, int shortPiles,
                  int extraDrawn, String firstShort) {
        /** What's wrong with this view, if anything. */
        List<String> problems(String view) {
            List<String> problems = new ArrayList<>();
            if (shortPiles > 0) {
                problems.add(view + ": " + shortPiles + " piles drew fewer on-screen entities than their limit, e.g. " + firstShort);
            }
            if (extraDrawn > 0) problems.add(view + ": mod on drew " + extraDrawn + " entities the game itself culled");
            if (hiddenReported != visibleOff - drawnOn) {
                problems.add(view + ": hiddenLastFrame says " + hiddenReported + " but " + (visibleOff - drawnOn) + " were hidden");
            }
            return problems;
        }
    }

    private ViewCheck() {}

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
        // Read right after the captured frame, so this is that frame's count.
        return new Result(visible.size(), drawn.size(), Compactor.hiddenLastFrame, FrameProbe.capturedRepeats(),
            split, shortPiles, extra, firstShort);
    }
}
