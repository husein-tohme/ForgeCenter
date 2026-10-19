package dev.forgecenter.compactor.test;

/**
 * Frame counters filled in by the test mixins on the render thread and read by the test thread.
 * They don't depend on the mod, so they can check the mod's own per-frame reset.
 */
public final class FrameStats {
    /** Calls to MinecraftClient.render: one per frame the window shows. */
    public static volatile long frames;
    /** Calls to GameRenderer.render and the time spent in them (drawing, before the buffer swap). */
    public static volatile long draws;
    public static volatile long drawNanos;

    private FrameStats() {}
}
