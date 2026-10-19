package dev.forgecenter.compactor.test;

import java.util.Locale;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestServerContext;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.ExperienceOrb;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.item.ItemEntity;

/**
 * A mob-farm style pile about 6 blocks in front of the player, packed into roughly 3x3x2
 * blocks: full stacks that can't merge, mobs that never move, XP orbs, and one name-tagged
 * zombie in the middle that must always stay visible.
 */
final class FarmPile {
    static final String[] ITEMS = {"diamond", "iron_ingot", "cobblestone", "oak_log", "wheat", "bone"};
    static final int ITEMS_EACH = 100;
    static final String[] MOBS = {"cow", "pig", "sheep"};
    static final int MOBS_EACH = 84;
    static final int ORBS = 100;
    static final int TOTAL = ITEMS.length * ITEMS_EACH + MOBS.length * MOBS_EACH + ORBS + 1;

    // The pile fills x -1..2 and z 5..8, from the ground up two blocks.
    private static final double MIN_X = -1, MIN_Z = 5;
    static final double CENTER_X = 0.5, CENTER_Z = 6.5;

    /** What the client can see of the pile. */
    record Census(int items, int mobs, int orbs, int namedZombieId, int allEntities) {
        boolean complete() {
            return items >= ITEMS.length * ITEMS_EACH && mobs >= MOBS.length * MOBS_EACH && orbs >= ORBS && namedZombieId >= 0;
        }
    }

    private FarmPile() {}

    static void spawn(TestServerContext server, int ground) {
        int n = 0;
        // Full stacks with an endless pickup delay can't merge or be picked up; Age -32768 never despawns.
        for (String item : ITEMS) {
            for (int i = 0; i < ITEMS_EACH; i++) {
                server.runCommand("summon item " + spot(n++, ground, 0.05, 1.85)
                    + " {Item:{id:\"minecraft:" + item + "\",count:64},PickupDelay:32767,Age:-32768,NoGravity:1b}");
            }
        }
        for (String mob : MOBS) {
            for (int i = 0; i < MOBS_EACH; i++) {
                server.runCommand("summon " + mob + " " + spot(n++, ground, 0, 0)
                    + " {NoAI:1b,Silent:1b,PersistenceRequired:1b,Invulnerable:1b}");
            }
        }
        for (int i = 0; i < ORBS; i++) {
            server.runCommand("summon experience_orb " + spot(n++, ground, 0.1, 1.7) + " {Value:3,NoGravity:1b}");
        }
        server.runCommand(String.format(Locale.ROOT,
            "summon zombie %.1f %d %.1f {NoAI:1b,Silent:1b,PersistenceRequired:1b,Invulnerable:1b,CustomName:\"Named Zed\",CustomNameVisible:1b}",
            CENTER_X, ground, CENTER_Z));
    }

    /** Counts the pile in the client's world (run on the render thread). */
    static Census census(Minecraft mc) {
        int items = 0, mobs = 0, orbs = 0, named = -1, all = 0;
        for (Entity entity : mc.level.entitiesForRendering()) {
            all++;
            if (entity instanceof ItemEntity) items++;
            else if (entity instanceof ExperienceOrb) orbs++;
            else if (entity.getType() == EntityType.ZOMBIE && entity.hasCustomName()) named = entity.getId();
            else if (entity instanceof Mob) mobs++;
        }
        return new Census(items, mobs, orbs, named, all);
    }

    /** A fixed spot inside the pile for the n-th entity, spread evenly (golden-ratio steps). */
    private static String spot(int n, int ground, double minY, double rangeY) {
        double x = MIN_X + 0.15 + 2.7 * frac(n * 0.6180339887);
        double z = MIN_Z + 0.15 + 2.7 * frac(n * 0.7548776662);
        double y = ground + minY + rangeY * frac(n * 0.5698402910);
        return String.format(Locale.ROOT, "%.3f %.3f %.3f", x, y, z);
    }

    private static double frac(double v) {
        return v - Math.floor(v);
    }
}
