package dev.forgecenter.compactor.test;

import dev.forgecenter.compactor.Compactor;
import it.unimi.dsi.fastutil.ints.IntOpenHashSet;
import it.unimi.dsi.fastutil.longs.LongArrayList;
import java.util.Arrays;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.ExperienceOrb;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.item.ItemEntity;

/**
 * Times every rendered frame and counts what the game decided to draw, so the test can
 * compare the mod off and on. Everything here runs on the render thread.
 */
public final class FrameProbe {
    /** One measured stretch of frames. "Drawn" counts are per frame; min is the worst frame. */
    public record Round(boolean modOn, int frames, double avgFrameMs, double medianFrameMs, double avgGapMs,
                        int hiddenMin, int hiddenMax, double callsPerFrame, double entitiesPerFrame, int repeatsMax,
                        int drawnItemsMin, double drawnItemsAvg, int drawnMobsMin, double drawnMobsAvg,
                        int drawnOrbsMin, double drawnOrbsAvg, int namedSeenFrames, int namedDrawnFrames,
                        long levelFrames) {}

    /** The client id of the name-tagged zombie, set by the test once it has arrived. */
    public static int namedZombieId = -1;

    private static long framesSinceReset;
    private static boolean recording;
    private static long lastStart = -1;
    private static long levelFramesAtStart;
    private static final LongArrayList frameNanos = new LongArrayList();
    private static final LongArrayList gapNanos = new LongArrayList();

    // The frame being drawn.
    private static int calls, drawnItems, drawnMobs, drawnOrbs;
    private static boolean namedSeen, namedDrawn;
    private static final IntOpenHashSet seen = new IntOpenHashSet();

    // One frame's drawn entity ids, on request.
    private static boolean captureRequested, capturing;
    private static final IntOpenHashSet drawnIds = new IntOpenHashSet();
    private static IntOpenHashSet captured;
    private static int capturedRepeats;

    // Totals over the recorded frames.
    private static long sumCalls, sumEntities, sumItems, sumMobs, sumOrbs;
    private static int repeatsMax, minItems, minMobs, minOrbs, namedSeenFrames, namedDrawnFrames, hiddenMin, hiddenMax;

    private FrameProbe() {}

    /** Starts counting frames again, e.g. right after switching the mod on or off. */
    public static void reset() {
        framesSinceReset = 0;
    }

    public static long framesSinceReset() {
        return framesSinceReset;
    }

    public static int recordedFrames() {
        return frameNanos.size();
    }

    /** Asks for the ids of every entity drawn in the next whole frame. */
    public static void captureNextFrame() {
        captured = null;
        captureRequested = true;
    }

    /** The ids from {@link #captureNextFrame()}, or null while that frame isn't done yet. */
    public static IntOpenHashSet capturedFrame() {
        return captured;
    }

    /** How many times the captured frame asked about an entity it had already asked about. */
    public static int capturedRepeats() {
        return capturedRepeats;
    }

    public static void startRecording() {
        frameNanos.clear();
        gapNanos.clear();
        sumCalls = sumEntities = sumItems = sumMobs = sumOrbs = 0;
        repeatsMax = namedSeenFrames = namedDrawnFrames = 0;
        minItems = minMobs = minOrbs = hiddenMin = Integer.MAX_VALUE;
        hiddenMax = Integer.MIN_VALUE;
        levelFramesAtStart = Compactor.frames;
        recording = true;
    }

    public static Round stopRecording(boolean modOn) {
        recording = false;
        int n = frameNanos.size();
        long[] sorted = frameNanos.toLongArray();
        Arrays.sort(sorted);
        long gaps = 0;
        for (int i = 0; i < gapNanos.size(); i++) gaps += gapNanos.getLong(i);
        long total = 0;
        for (long t : sorted) total += t;
        return new Round(modOn, n, ms(total) / n, ms(sorted[n / 2]), gapNanos.isEmpty() ? 0 : ms(gaps) / gapNanos.size(),
            hiddenMin, hiddenMax, (double) sumCalls / n, (double) sumEntities / n, repeatsMax,
            minItems, (double) sumItems / n, minMobs, (double) sumMobs / n, minOrbs, (double) sumOrbs / n,
            namedSeenFrames, namedDrawnFrames, Compactor.frames - levelFramesAtStart);
    }

    public static void frameStarted(long now) {
        if (recording && lastStart >= 0) gapNanos.add(now - lastStart);
        lastStart = now;
        calls = drawnItems = drawnMobs = drawnOrbs = 0;
        namedSeen = namedDrawn = false;
        seen.clear();
        capturing = captureRequested;
        drawnIds.clear();
    }

    public static void frameFinished(long start, long end) {
        framesSinceReset++;
        if (capturing) {
            captured = new IntOpenHashSet(drawnIds);
            capturedRepeats = calls - seen.size();
            capturing = captureRequested = false;
        }
        if (!recording) return;
        frameNanos.add(end - start);
        sumCalls += calls;
        sumEntities += seen.size();
        repeatsMax = Math.max(repeatsMax, calls - seen.size());
        sumItems += drawnItems;
        sumMobs += drawnMobs;
        sumOrbs += drawnOrbs;
        minItems = Math.min(minItems, drawnItems);
        minMobs = Math.min(minMobs, drawnMobs);
        minOrbs = Math.min(minOrbs, drawnOrbs);
        if (namedSeen) namedSeenFrames++;
        if (namedDrawn) namedDrawnFrames++;
        int hidden = Compactor.hiddenLastFrame;
        hiddenMin = Math.min(hiddenMin, hidden);
        hiddenMax = Math.max(hiddenMax, hidden);
    }

    public static void onShouldRender(Entity entity, boolean drawn) {
        calls++;
        seen.add(entity.getId());
        if (capturing && drawn) drawnIds.add(entity.getId());
        if (entity.getId() == namedZombieId) {
            namedSeen = true;
            namedDrawn |= drawn;
        } else if (drawn) {
            if (entity instanceof ItemEntity) drawnItems++;
            else if (entity instanceof ExperienceOrb) drawnOrbs++;
            else if (entity instanceof Mob) drawnMobs++;
        }
    }

    private static double ms(long nanos) {
        return nanos / 1_000_000.0;
    }
}
