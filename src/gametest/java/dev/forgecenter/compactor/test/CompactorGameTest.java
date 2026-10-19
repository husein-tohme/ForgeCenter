package dev.forgecenter.compactor.test;

import com.google.gson.JsonObject;
import dev.forgecenter.compactor.Compactor;
import dev.forgecenter.compactor.Settings;
import java.lang.reflect.RecordComponent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestServerContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.InactivityFpsLimit;
import net.minecraft.util.Mth;
import net.minecraft.world.level.levelgen.Heightmap;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL11;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Plays the real game with the mod: builds a farm pile in a superflat world, then measures
 * frames with the mod off and on (twice each, so warm-up or drift can't favour one side),
 * checks what was hidden, and writes one EC_RESULT line. Fails on any correctness problem.
 */
public final class CompactorGameTest implements FabricClientGameTest {
    private static final Logger LOGGER = LoggerFactory.getLogger("entitycompactor-test");
    private static final int WARMUP_FRAMES = 60;
    private static final int MEASURED_FRAMES = 250;
    private static final int TIMEOUT_TICKS = 20 * 60 * 10;
    // Facing +Z the pile is dead ahead; at yaw 50 it sits on the left edge of the 854x480 view
    // (default FOV 70 gives a half-width of about 51 degrees). Pitch looks down at the pile's middle.
    private static final float EDGE_YAW = 50f;
    private static final float EDGE_PITCH = 6f;

    @Override
    public void runTest(ClientGameTestContext context) {
        context.runOnClient(mc -> {
            mc.options.enableVsync().set(false);
            mc.options.framerateLimit().set(260); // the top of the slider means unlimited
            mc.options.inactivityFpsLimit().set(InactivityFpsLimit.MINIMIZED); // no 30 fps cap after a minute idle
        });

        try (TestSingleplayerContext world = context.worldBuilder().create()) {
            world.getConnection().waitForChunksRender();
            TestServerContext server = world.getServer();
            int ground = server.computeOnServer(s -> s.overworld().getHeight(Heightmap.Types.MOTION_BLOCKING, 0, 6));

            // Frozen ticks keep the pile exactly still (no merging, no cramming); it is still drawn every frame.
            server.runCommand("tick freeze");
            server.runCommand(String.format(Locale.ROOT, "tp @a 0.5 %d 0.5 facing %.1f %d %.1f",
                ground, FarmPile.CENTER_X, ground + 1, FarmPile.CENTER_Z));
            FarmPile.spawn(server, ground);
            int arrivalTicks = context.waitFor(mc -> FarmPile.census(mc).complete(), 20 * 60);
            FarmPile.Census census = context.computeOnClient(FarmPile::census);
            context.runOnClient(mc -> FrameProbe.namedZombieId = census.namedZombieId());
            context.waitFor(mc -> mc.player != null && Math.abs(mc.player.getZ() - 0.5) < 0.01, 20 * 10);
            context.waitTicks(20);
            String renderer = context.computeOnClient(mc -> glString(GL11.GL_RENDERER) + " | " + glString(GL11.GL_VERSION));

            List<FrameProbe.Round> rounds = new ArrayList<>();
            rounds.add(measure(context, false));
            Path offShot = context.takeScreenshot("entitycompactor-off");
            rounds.add(measure(context, true));
            Path onShot = context.takeScreenshot("entitycompactor-on");
            rounds.add(measure(context, false));
            rounds.add(measure(context, true));

            // Still on: the player and the named zombie must never be hidden.
            context.runOnClient(mc -> Settings.enabled = true);
            boolean playerHidden = context.computeOnClient(mc -> Compactor.shouldHide(mc.player));
            boolean namedHidden = context.computeOnClient(mc -> Compactor.shouldHide(mc.level.getEntity(census.namedZombieId())));

            // Turn right until the pile sits on the left edge of the screen, cut in half.
            server.runCommand(String.format(Locale.ROOT, "tp @a 0.5 %d 0.5 %.1f %.1f", ground, EDGE_YAW, EDGE_PITCH));
            context.waitFor(mc -> Math.abs(Mth.wrapDegrees(mc.player.getYRot() - EDGE_YAW)) < 0.5f, 20 * 10);
            ViewCheck.Result edge = ViewCheck.run(context);
            Path edgeShot = context.takeScreenshot("entitycompactor-edge-on");

            // Back to the pile, with hitboxes on (F3+B): the game then asks about each entity twice a frame.
            server.runCommand(String.format(Locale.ROOT, "tp @a 0.5 %d 0.5 facing %.1f %d %.1f",
                ground, FarmPile.CENTER_X, ground + 1, FarmPile.CENTER_Z));
            context.waitFor(mc -> Math.abs(Mth.wrapDegrees(mc.player.getYRot())) < 0.5f, 20 * 10);
            toggleHitboxes(context);
            ViewCheck.Result hitboxes = ViewCheck.run(context);
            Path hitboxShot = context.takeScreenshot("entitycompactor-hitboxes-on");
            toggleHitboxes(context);

            // /compactor and K must each flip the mod; each is used twice to end where it started.
            boolean commandWorks = flips(context, () -> context.runOnClient(mc -> mc.getConnection().sendCommand("compactor")));
            boolean keyWorks = flips(context, () -> context.getInput().pressKey(GLFW.GLFW_KEY_K));

            JsonObject shots = new JsonObject();
            shots.addProperty("off", "screenshots/" + offShot.getFileName());
            shots.addProperty("on", "screenshots/" + onShot.getFileName());
            shots.addProperty("edgeOn", "screenshots/" + edgeShot.getFileName());
            shots.addProperty("hitboxesOn", "screenshots/" + hitboxShot.getFileName());
            JsonObject result = report(census, rounds, edge, hitboxes, renderer, ground, arrivalTicks, playerHidden,
                namedHidden, commandWorks, keyWorks, shots);
            write(FabricLoader.getInstance().getGameDir().resolve("ec-result.json"), result.toString());
            LOGGER.info("EC_RESULT {}", result);

            List<String> failures = check(census, rounds, edge, hitboxes, playerHidden, namedHidden, commandWorks, keyWorks);
            if (!failures.isEmpty()) throw new AssertionError("Entity Compactor test failed: " + String.join("; ", failures));
        }
    }

    /** Switches the mod, lets it warm up, then times MEASURED_FRAMES frames. */
    private static FrameProbe.Round measure(ClientGameTestContext context, boolean modOn) {
        context.runOnClient(mc -> {
            Settings.enabled = modOn;
            FrameProbe.reset();
        });
        context.waitFor(mc -> FrameProbe.framesSinceReset() >= WARMUP_FRAMES, TIMEOUT_TICKS);
        context.runOnClient(mc -> FrameProbe.startRecording());
        context.waitFor(mc -> FrameProbe.recordedFrames() >= MEASURED_FRAMES, TIMEOUT_TICKS);
        FrameProbe.Round round = context.computeOnClient(mc -> FrameProbe.stopRecording(modOn));
        LOGGER.info("Round (mod {}): {}", modOn ? "on" : "off", round);
        return round;
    }

    /** Presses F3+B, which shows or hides entity hitboxes. */
    private static void toggleHitboxes(ClientGameTestContext context) {
        context.getInput().holdKey(GLFW.GLFW_KEY_F3);
        context.getInput().pressKey(GLFW.GLFW_KEY_B);
        context.getInput().releaseKey(GLFW.GLFW_KEY_F3);
        context.waitTicks(2);
    }

    /** True if the action flips the mod, and doing it again flips it back. */
    private static boolean flips(ClientGameTestContext context, Runnable action) {
        boolean before = context.computeOnClient(mc -> Settings.enabled);
        action.run();
        context.waitTicks(2);
        boolean flipped = context.computeOnClient(mc -> Settings.enabled) != before;
        action.run();
        context.waitTicks(2);
        return flipped && context.computeOnClient(mc -> Settings.enabled) == before;
    }

    private static List<String> check(FarmPile.Census census, List<FrameProbe.Round> rounds, ViewCheck.Result edge,
                                      ViewCheck.Result hitboxes, boolean playerHidden, boolean namedHidden,
                                      boolean commandWorks, boolean keyWorks) {
        List<String> failures = new ArrayList<>();
        if (!census.complete()) failures.add("the client did not get the whole pile: " + census);
        for (FrameProbe.Round r : rounds) {
            String mode = r.modOn() ? "on" : "off";
            if (r.levelFrames() <= 0) failures.add("Compactor.startFrame never ran (mod " + mode + ")");
            if (!r.modOn() && r.hiddenMax() != 0) failures.add("mod off but " + r.hiddenMax() + " entities hidden");
            if (r.modOn() && r.hiddenMin() < FarmPile.TOTAL / 2) failures.add("mod on but only " + r.hiddenMin() + " hidden in some frame");
            if (r.modOn() && (r.drawnItemsMin() == 0 || r.drawnMobsMin() == 0 || r.drawnOrbsMin() == 0)) {
                failures.add("mod on and a whole kind vanished in some frame: " + r);
            }
            if (r.modOn() && r.namedDrawnFrames() != r.namedSeenFrames()) failures.add("the named zombie was hidden in some frames");
        }
        if (edge.splitPiles() == 0) failures.add("the edge view did not cut through any pile: " + edge);
        failures.addAll(edge.problems("pile on the screen edge"));
        if (hitboxes.repeatsOn() == 0) failures.add("F3+B did not turn on hitboxes (no repeated questions): " + hitboxes);
        failures.addAll(hitboxes.problems("hitboxes on (F3+B)"));
        if (playerHidden) failures.add("the player would be hidden");
        if (namedHidden) failures.add("the named zombie would be hidden");
        if (!commandWorks) failures.add("/compactor did not toggle the mod");
        if (!keyWorks) failures.add("the K key did not toggle the mod");
        return failures;
    }

    private static JsonObject report(FarmPile.Census census, List<FrameProbe.Round> rounds, ViewCheck.Result edge,
                                     ViewCheck.Result hitboxes, String renderer, int ground, int arrivalTicks, boolean playerHidden, boolean namedHidden,
                                     boolean commandWorks, boolean keyWorks, JsonObject shots) {
        double offMs = 0, onMs = 0;
        int hiddenOn = Integer.MAX_VALUE, hiddenOnMax = 0, hiddenOff = 0, drawnItems = Integer.MAX_VALUE,
            drawnMobs = Integer.MAX_VALUE, drawnOrbs = Integer.MAX_VALUE;
        for (FrameProbe.Round r : rounds) {
            if (r.modOn()) {
                onMs += r.avgFrameMs() / 2;
                hiddenOn = Math.min(hiddenOn, r.hiddenMin());
                hiddenOnMax = Math.max(hiddenOnMax, r.hiddenMax());
                drawnItems = Math.min(drawnItems, r.drawnItemsMin());
                drawnMobs = Math.min(drawnMobs, r.drawnMobsMin());
                drawnOrbs = Math.min(drawnOrbs, r.drawnOrbsMin());
            } else {
                offMs += r.avgFrameMs() / 2;
                hiddenOff = Math.max(hiddenOff, r.hiddenMax());
            }
        }

        JsonObject json = new JsonObject();
        json.addProperty("mc", FabricLoader.getInstance().getModContainer("minecraft")
            .map(m -> m.getMetadata().getVersion().getFriendlyString()).orElse("unknown"));
        json.addProperty("renderer", renderer);
        JsonObject entities = new JsonObject();
        entities.addProperty("items", census.items());
        entities.addProperty("mobs", census.mobs());
        entities.addProperty("xpOrbs", census.orbs());
        entities.addProperty("namedZombie", census.namedZombieId() >= 0);
        entities.addProperty("allOnClient", census.allEntities());
        entities.addProperty("arrivedAfterTicks", arrivalTicks);
        json.add("entitiesOnClient", entities);
        json.addProperty("offFrameMs", round(offMs));
        json.addProperty("onFrameMs", round(onMs));
        json.addProperty("speedup", round(offMs / onMs));
        json.addProperty("hiddenOn", hiddenOn);
        json.addProperty("hiddenOnMax", hiddenOnMax);
        json.addProperty("hiddenOff", hiddenOff);
        json.addProperty("drawnOnMinItems", drawnItems);
        json.addProperty("drawnOnMinMobs", drawnMobs);
        json.addProperty("drawnOnMinOrbs", drawnOrbs);
        json.addProperty("namedZombieHidden", namedHidden || rounds.stream().anyMatch(r -> r.modOn() && r.namedDrawnFrames() != r.namedSeenFrames()));
        json.addProperty("playerHidden", playerHidden);
        json.addProperty("commandToggle", commandWorks);
        json.addProperty("keyToggle", keyWorks);
        json.addProperty("ground", ground);
        json.add("screenshots", shots);
        json.add("edge", toJson(edge));
        json.add("hitboxes", toJson(hitboxes));
        for (int i = 0; i < rounds.size(); i++) json.add("round" + (i + 1), toJson(rounds.get(i)));
        return json;
    }

    private static JsonObject toJson(Record record) {
        JsonObject json = new JsonObject();
        for (RecordComponent c : record.getClass().getRecordComponents()) {
            try {
                Object value = c.getAccessor().invoke(record);
                if (value instanceof Double d) json.addProperty(c.getName(), round(d));
                else if (value instanceof Number n) json.addProperty(c.getName(), n);
                else if (value instanceof Boolean b) json.addProperty(c.getName(), b);
                else if (value instanceof String text) json.addProperty(c.getName(), text);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }
        return json;
    }

    private static String glString(int name) {
        try {
            return String.valueOf(GL11.glGetString(name));
        } catch (Throwable e) {
            return "unavailable (" + e.getClass().getSimpleName() + ")";
        }
    }

    private static double round(double v) {
        return Math.round(v * 100) / 100.0;
    }

    private static void write(Path file, String text) {
        try {
            Files.writeString(file, text);
        } catch (Exception e) {
            LOGGER.error("Could not write {}", file, e);
        }
    }
}
