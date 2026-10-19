package dev.forgecenter.compactor.test;

import com.google.gson.JsonObject;
import dev.forgecenter.compactor.Compactor;
import dev.forgecenter.compactor.Settings;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;

/**
 * Measures frames while the game renders freely. The test thread only steps ticks, so between
 * ticks the client draws as many frames as it can; wall-clock time over the frame count is the
 * real time per frame, the same thing an FPS counter shows.
 */
final class FrameMeter {
    static final int WARMUP_FRAMES = 60;
    static final int MIN_FRAMES = 200;
    static final int MIN_TICKS = 100; // at least 5 seconds per window
    static final int MAX_TICKS = 2400;
    private static final Pattern RENDERED = Pattern.compile("E: (\\d+)/(\\d+)");

    private FrameMeter() {}

    /** One measuring window with the mod on or off. */
    record Window(boolean enabled, long frames, long startEvents, long ticks, double frameMs, double drawMs,
                  int hiddenMin, int hiddenMax, int hiddenLast, int rendered, String debug) {
        JsonObject toJson() {
            JsonObject json = new JsonObject();
            json.addProperty("mod", enabled ? "on" : "off");
            json.addProperty("frames", frames);
            json.addProperty("worldRenderStartEvents", startEvents);
            json.addProperty("ticks", ticks);
            json.addProperty("frameMs", round(frameMs));
            json.addProperty("fps", round(1000 / frameMs));
            json.addProperty("drawMs", round(drawMs));
            json.addProperty("hiddenMin", hiddenMin);
            json.addProperty("hiddenMax", hiddenMax);
            json.addProperty("hiddenLastFrame", hiddenLast);
            json.addProperty("rendered", rendered);
            json.addProperty("debug", debug);
            return json;
        }
    }

    static Window measure(ClientGameTestContext context, boolean enabled) {
        context.runOnClient(client -> Settings.enabled = enabled);
        waitFrames(context, WARMUP_FRAMES);

        long frames0 = FrameStats.frames, starts0 = Compactor.frames;
        long draws0 = FrameStats.draws, drawNanos0 = FrameStats.drawNanos;
        int hiddenMin = Integer.MAX_VALUE, hiddenMax = Integer.MIN_VALUE, ticks = 0;
        long start = System.nanoTime();
        while ((FrameStats.frames - frames0 < MIN_FRAMES || ticks < MIN_TICKS) && ticks < MAX_TICKS) {
            context.waitTick();
            ticks++;
            int hidden = Compactor.hiddenLastFrame;
            hiddenMin = Math.min(hiddenMin, hidden);
            hiddenMax = Math.max(hiddenMax, hidden);
        }
        long elapsed = System.nanoTime() - start;
        long frames = FrameStats.frames - frames0;
        long draws = FrameStats.draws - draws0;
        double drawMs = draws == 0 ? 0 : (FrameStats.drawNanos - drawNanos0) / 1e6 / draws;

        String debug = context.computeOnClient(client -> client.worldRenderer.getEntitiesDebugString());
        Matcher m = RENDERED.matcher(debug);
        int rendered = m.find() ? Integer.parseInt(m.group(1)) : -1;
        return new Window(enabled, frames, Compactor.frames - starts0, ticks, elapsed / 1e6 / Math.max(1, frames),
            drawMs, hiddenMin, hiddenMax, Compactor.hiddenLastFrame, rendered, debug);
    }

    static void waitFrames(ClientGameTestContext context, int count) {
        long target = FrameStats.frames + count;
        for (int ticks = 0; FrameStats.frames < target && ticks < MAX_TICKS; ticks++) context.waitTick();
    }

    static double round(double value) {
        return Math.round(value * 1000) / 1000.0;
    }
}
