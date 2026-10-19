package dev.forgecenter.compactor.test;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.forgecenter.compactor.Compactor;
import dev.forgecenter.compactor.Settings;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.fabricmc.fabric.api.client.gametest.v1.screenshot.TestScreenshotOptions;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.SharedConstants;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.InactivityFpsLimit;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import org.lwjgl.opengl.GL11;
import org.spongepowered.asm.mixin.MixinEnvironment;

/**
 * Starts a real singleplayer world, piles up a farm's worth of items, mobs and XP orbs in front of
 * the player, and measures frames with Entity Compactor off and on. Prints one EC_RESULT line and
 * fails if the mod hides something it must not, or doesn't hide the pile.
 */
@SuppressWarnings("UnstableApiUsage")
public class CompactorClientGameTest implements FabricClientGameTest {
    private static final String[] SETUP = {
        "gamerule maxEntityCramming 0", // hundreds of mobs in one spot would otherwise crush each other
        "gamerule doMobLoot false",
        "kill @e[type=!player]",        // clear the animals the superflat world starts with
        "time set noon",
        "weather clear",
        "gamemode spectator @a",        // spectators don't pull XP orbs in
        FarmPile.PLAYER_TP,
    };

    private final List<String> failures = new ArrayList<>();

    @Override
    public void runTest(ClientGameTestContext context) {
        // Apply every mixin now, so a broken one shows up in the log even if nothing touched its target yet.
        MixinEnvironment.getCurrentEnvironment().audit();
        JsonObject result = new JsonObject();

        try (TestSingleplayerContext game = context.worldBuilder().create()) {
            game.getClientWorld().waitForChunksRender();
            for (String command : SETUP) game.getServer().runCommand(command);
            UUID zombieId = game.getServer().computeOnServer(FarmPile::spawn);

            FarmPile.Counts counts = waitForPile(context, zombieId);
            context.waitFor(client -> client.player.isSpectator()
                && client.player.squaredDistanceTo(FarmPile.PLAYER.x, FarmPile.PLAYER.y, FarmPile.PLAYER.z) < 0.01);
            game.getClientWorld().waitForChunksRender();
            context.runOnClient(client -> {
                client.options.getEnableVsync().setValue(false);
                client.options.getMaxFps().setValue(260); // 260 = unlimited
                // The default limit drops to 30 FPS after a minute without input, which this test is.
                client.options.getInactivityFpsLimit().setValue(InactivityFpsLimit.MINIMIZED);
            });
            describeGame(context, result, counts);

            // Warm up the JIT first, then alternate off/on twice so drift can't favour one side.
            FrameMeter.waitFrames(context, 100);
            FrameMeter.Window off1 = FrameMeter.measure(context, false);
            Path offShot = context.takeScreenshot(TestScreenshotOptions.of("ec1214-off").disableCounterPrefix());
            FrameMeter.Window on1 = FrameMeter.measure(context, true);
            Path onShot = context.takeScreenshot(TestScreenshotOptions.of("ec1214-on").disableCounterPrefix());
            FrameMeter.Window off2 = FrameMeter.measure(context, false);
            FrameMeter.Window on2 = FrameMeter.measure(context, true);
            List<FrameMeter.Window> windows = List.of(off1, on1, off2, on2);

            // The mod is on again here. Players and named mobs must never be hidden.
            JsonObject checks = context.computeOnClient(client -> neverHiddenChecks(client, zombieId));
            FarmPile.Counts after = context.computeOnClient(client -> FarmPile.count(client.world, zombieId));

            report(result, counts, after, windows, checks, offShot, onShot);
        }

        result.addProperty("pass", failures.isEmpty());
        JsonArray failed = new JsonArray();
        failures.forEach(failed::add);
        result.add("failures", failed);
        String json = new Gson().toJson(result);
        System.out.println("EC_RESULT " + json);
        try {
            Files.writeString(FabricLoader.getInstance().getGameDir().resolve("ec_result.json"), json);
        } catch (IOException e) {
            failures.add("could not write ec_result.json: " + e);
        }
        if (!failures.isEmpty()) throw new AssertionError("Entity Compactor in-game test failed: " + failures);
    }

    /** Waits until the client has every entity of the pile (up to a minute). */
    private FarmPile.Counts waitForPile(ClientGameTestContext context, UUID zombieId) {
        FarmPile.Counts counts = null;
        for (int tick = 0; tick < 1200; tick++) {
            counts = context.computeOnClient(client -> FarmPile.count(client.world, zombieId));
            if (counts.complete()) return counts;
            context.waitTick();
        }
        failures.add("the client never received the whole pile: " + counts);
        return counts;
    }

    private static void describeGame(ClientGameTestContext context, JsonObject result, FarmPile.Counts counts) {
        result.addProperty("mc", SharedConstants.getGameVersion().getName());
        result.addProperty("loader", version("fabricloader"));
        result.addProperty("fabricApi", version("fabric-api"));
        result.addProperty("mod", version("entitycompactor"));
        context.runOnClient(client -> {
            result.addProperty("renderer", GL11.glGetString(GL11.GL_RENDERER));
            result.addProperty("glVersion", GL11.glGetString(GL11.GL_VERSION));
            result.addProperty("window", client.getWindow().getFramebufferWidth() + "x" + client.getWindow().getFramebufferHeight());
            result.addProperty("vsync", client.options.getEnableVsync().getValue());
            result.addProperty("maxFps", client.options.getMaxFps().getValue());
        });
        result.add("entitiesOnClient", counts.toJson());
    }

    private static String version(String modId) {
        return FabricLoader.getInstance().getModContainer(modId)
            .map(mod -> mod.getMetadata().getVersion().getFriendlyString()).orElse("missing");
    }

    /**
     * Asks the mod directly about the named zombie and the player. Then, as a control, asks about the
     * unnamed zombies in the named one's 2x2x2 spot: that spot is over its limit, so they must be
     * hidden, which shows the named zombie really would have been hidden without its name.
     */
    private static JsonObject neverHiddenChecks(MinecraftClient client, UUID zombieId) {
        JsonObject json = new JsonObject();
        Entity zombie = FarmPile.find(client.world, zombieId);
        json.addProperty("namedZombieFound", zombie != null);
        json.addProperty("namedZombieHidden", zombie == null || Compactor.shouldHide(zombie));
        json.addProperty("playerHidden", Compactor.shouldHide(client.player));
        int control = 0, controlHidden = 0;
        if (zombie != null) {
            for (Entity entity : client.world.getEntities()) {
                if (entity.getType() == EntityType.ZOMBIE && entity != zombie && sameMobSpot(entity, zombie)) {
                    control++;
                    if (Compactor.shouldHide(entity)) controlHidden++;
                }
            }
        }
        json.addProperty("controlZombiesInSpot", control);
        json.addProperty("controlZombiesHidden", controlHidden);
        return json;
    }

    private static boolean sameMobSpot(Entity a, Entity b) {
        int cell = Settings.mobCellSize;
        return Math.floorDiv((int) Math.floor(a.getX()), cell) == Math.floorDiv((int) Math.floor(b.getX()), cell)
            && Math.floorDiv((int) Math.floor(a.getY()), cell) == Math.floorDiv((int) Math.floor(b.getY()), cell)
            && Math.floorDiv((int) Math.floor(a.getZ()), cell) == Math.floorDiv((int) Math.floor(b.getZ()), cell);
    }

    private void report(JsonObject result, FarmPile.Counts counts, FarmPile.Counts after, List<FrameMeter.Window> windows,
                        JsonObject checks, Path offShot, Path onShot) {
        double offMs = 0, onMs = 0, offDraw = 0, onDraw = 0;
        int hiddenOff = 0, hiddenOn = Integer.MAX_VALUE, renderedOff = 0, renderedOn = 0, offCount = 0, onCount = 0;
        JsonArray windowJson = new JsonArray();
        for (FrameMeter.Window w : windows) {
            windowJson.add(w.toJson());
            if (w.enabled()) {
                onMs += w.frameMs();
                onDraw += w.drawMs();
                onCount++;
                hiddenOn = Math.min(hiddenOn, w.hiddenMin());
                renderedOn = w.rendered();
            } else {
                offMs += w.frameMs();
                offDraw += w.drawMs();
                offCount++;
                hiddenOff = Math.max(hiddenOff, w.hiddenMax());
                renderedOff = w.rendered();
            }
            // Fabric's WorldRenderEvents.START resets the mod's counts; it must fire once per frame.
            if (Math.abs(w.startEvents() - w.frames()) > 1) {
                failures.add("WorldRenderEvents.START fired " + w.startEvents() + " times in " + w.frames() + " frames");
            }
            if (w.frames() < FrameMeter.MIN_FRAMES) failures.add("only " + w.frames() + " frames in a window");
        }
        offMs /= offCount;
        onMs /= onCount;
        int pile = counts.pile();
        FrameMeter.Window lastOn = windows.get(3);

        result.addProperty("offFrameMs", FrameMeter.round(offMs));
        result.addProperty("onFrameMs", FrameMeter.round(onMs));
        result.addProperty("speedup", FrameMeter.round(offMs / onMs));
        result.addProperty("offFps", FrameMeter.round(1000 / offMs));
        result.addProperty("onFps", FrameMeter.round(1000 / onMs));
        result.addProperty("offDrawMs", FrameMeter.round(offDraw / offCount));
        result.addProperty("onDrawMs", FrameMeter.round(onDraw / onCount));
        result.addProperty("hiddenOn", lastOn.hiddenLast());
        result.addProperty("hiddenOnMin", hiddenOn);
        result.addProperty("hiddenOff", hiddenOff);
        result.addProperty("renderedOff", renderedOff);
        result.addProperty("renderedOn", renderedOn);
        result.addProperty("namedZombieHidden", checks.get("namedZombieHidden").getAsBoolean());
        result.addProperty("playerHidden", checks.get("playerHidden").getAsBoolean());
        result.add("checks", checks);
        result.add("entitiesAfter", after.toJson());
        result.add("windows", windowJson);

        JsonObject shots = new JsonObject();
        shots.addProperty("off", offShot.toString());
        shots.addProperty("on", onShot.toString());
        String urlBase = System.getenv("EC_SCREENSHOT_URL_BASE");
        if (urlBase != null && !urlBase.isBlank()) {
            shots.addProperty("offUrl", urlBase + offShot.getFileName());
            shots.addProperty("onUrl", urlBase + onShot.getFileName());
        }
        result.add("screenshots", shots);

        // Correctness: nothing hidden when off, most of the pile hidden when on, but never all of it.
        if (hiddenOff != 0) failures.add("hid " + hiddenOff + " entities with the mod off");
        if (hiddenOn < pile / 2) failures.add("only hid " + hiddenOn + " of " + pile + " piled entities with the mod on");
        if (lastOn.hiddenLast() >= pile) failures.add("hid the whole pile");
        if (renderedOn <= 0 || renderedOn >= renderedOff) {
            failures.add("expected some but fewer entities drawn when on: off " + renderedOff + ", on " + renderedOn);
        }
        // Only entities the game was about to draw may count as hidden: the cows behind the
        // player are off screen, so drawn(off) - drawn(on) must equal hidden(on).
        int skipped = renderedOff - renderedOn;
        if (Math.abs(skipped - lastOn.hiddenLast()) > 2) {
            failures.add("hidden count " + lastOn.hiddenLast() + " doesn't match the " + skipped + " fewer entities drawn");
        }
        if (!checks.get("namedZombieFound").getAsBoolean()) failures.add("the named zombie is missing on the client");
        if (checks.get("namedZombieHidden").getAsBoolean()) failures.add("the named zombie was hidden");
        if (checks.get("playerHidden").getAsBoolean()) failures.add("the player was hidden");
        if (checks.get("controlZombiesHidden").getAsInt() == 0) failures.add("control zombies next to the named one weren't hidden");
        if (after.pile() != counts.pile() || after.behind() != counts.behind()) failures.add("the pile changed while measuring: " + after);
    }
}
