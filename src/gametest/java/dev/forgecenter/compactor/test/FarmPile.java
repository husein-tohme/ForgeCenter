package dev.forgecenter.compactor.test;

import com.google.gson.JsonObject;
import java.util.Random;
import java.util.UUID;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.ExperienceOrbEntity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.SpawnReason;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.mob.ZombieEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;

/**
 * The farm-like pile the test looks at: hundreds of items, mobs and XP orbs packed into about
 * 3x3x2 blocks, plus one name-tagged zombie in the middle of it.
 */
final class FarmPile {
    // The player floats (spectator) 3 blocks above the superflat surface (y = -60), facing south
    // (+z) and looking down at the middle of the pile, about 6 blocks away.
    static final String PLAYER_TP = "tp @a 0.5 -57 1.5 0 36";
    static final Vec3d PLAYER = new Vec3d(0.5, -57, 1.5);

    static final Box PILE = new Box(-1, -60, 5, 2, -58, 8);
    private static final Box MOB_FEET = new Box(-1, -60, 5, 2, -59, 8);
    private static final Vec3d MIDDLE = new Vec3d(0.5, -60, 6.5);
    // A small group of cows straight behind the player: off screen, so the game never draws them
    // and they must not count as hidden either.
    static final Box BEHIND = new Box(0, -60, -6, 2, -59, -4);

    static final int ITEMS = 600, COWS = 84, PIGS = 83, ZOMBIES = 83, ORBS = 100, BEHIND_COWS = 30;
    private static final Item[] ITEM_TYPES = {
        Items.COBBLESTONE, Items.OAK_LOG, Items.IRON_INGOT, Items.ROTTEN_FLESH, Items.BONE, Items.WHEAT
    };

    private FarmPile() {}

    /** Spawns everything on the server; returns the named zombie's id. */
    static UUID spawn(MinecraftServer server) {
        ServerWorld world = server.getOverworld();
        Random random = new Random(1214);

        for (int i = 0; i < ITEMS; i++) {
            Vec3d p = pointIn(PILE, random);
            // Full stacks never merge, and they stay put: no gravity, never picked up or despawned.
            ItemEntity item = new ItemEntity(world, p.x, p.y, p.z, new ItemStack(ITEM_TYPES[i % ITEM_TYPES.length], 64), 0, 0, 0);
            item.setPickupDelayInfinite();
            item.setNeverDespawn();
            item.setNoGravity(true);
            world.spawnEntity(item);
        }
        for (int i = 0; i < ORBS; i++) {
            Vec3d p = pointIn(PILE, random);
            // Orbs only merge with orbs of the same value, so each one gets its own value.
            ExperienceOrbEntity orb = new ExperienceOrbEntity(world, p.x, p.y, p.z, i + 1);
            orb.setVelocity(Vec3d.ZERO);
            orb.setNoGravity(true);
            world.spawnEntity(orb);
        }
        for (int i = 0; i < COWS; i++) world.spawnEntity(mob(world, EntityType.COW, pointIn(MOB_FEET, random)));
        for (int i = 0; i < PIGS; i++) world.spawnEntity(mob(world, EntityType.PIG, pointIn(MOB_FEET, random)));
        for (int i = 0; i < ZOMBIES; i++) world.spawnEntity(mob(world, EntityType.ZOMBIE, pointIn(MOB_FEET, random)));
        for (int i = 0; i < BEHIND_COWS; i++) world.spawnEntity(mob(world, EntityType.COW, pointIn(BEHIND, random)));

        ZombieEntity named = mob(world, EntityType.ZOMBIE, MIDDLE);
        named.setCustomName(Text.literal("Named Zombie"));
        named.setCustomNameVisible(true);
        world.spawnEntity(named);
        return named.getUuid();
    }

    private static <T extends MobEntity> T mob(ServerWorld world, EntityType<T> type, Vec3d p) {
        T mob = type.create(world, SpawnReason.COMMAND);
        mob.refreshPositionAndAngles(p.x, p.y, p.z, 180, 0); // facing the player
        mob.setHeadYaw(180);
        mob.setBodyYaw(180);
        mob.setAiDisabled(true);
        mob.setSilent(true);
        mob.setPersistent();
        mob.setNoGravity(true);
        // A mob head keeps zombies from burning in daylight (it can't wear out like a helmet).
        if (mob instanceof ZombieEntity) mob.equipStack(EquipmentSlot.HEAD, new ItemStack(Items.ZOMBIE_HEAD));
        return mob;
    }

    private static Vec3d pointIn(Box box, Random random) {
        return new Vec3d(
            box.minX + random.nextDouble() * (box.maxX - box.minX),
            box.minY + random.nextDouble() * (box.maxY - box.minY),
            box.minZ + random.nextDouble() * (box.maxZ - box.minZ));
    }

    /** What the client has received so far. */
    record Counts(int items, int orbs, int cows, int pigs, int zombies, int namedZombies, int behind, int world) {
        int pile() {
            return items + orbs + cows + pigs + zombies + namedZombies;
        }

        int mobs() {
            return cows + pigs + zombies;
        }

        boolean complete() {
            return items == ITEMS && orbs == ORBS && cows == COWS && pigs == PIGS && zombies == ZOMBIES
                && namedZombies == 1 && behind == BEHIND_COWS;
        }

        JsonObject toJson() {
            JsonObject json = new JsonObject();
            json.addProperty("items", items);
            json.addProperty("mobs", mobs());
            json.addProperty("cows", cows);
            json.addProperty("pigs", pigs);
            json.addProperty("zombies", zombies);
            json.addProperty("orbs", orbs);
            json.addProperty("namedZombie", namedZombies);
            json.addProperty("pileTotal", pile());
            json.addProperty("behindCamera", behind);
            json.addProperty("worldTotal", world);
            return json;
        }
    }

    static Counts count(ClientWorld world, UUID namedId) {
        Box pile = PILE.expand(0.5);
        Box behind = BEHIND.expand(0.5);
        int items = 0, orbs = 0, cows = 0, pigs = 0, zombies = 0, named = 0, behindCows = 0;
        for (Entity entity : world.getEntities()) {
            Vec3d pos = entity.getPos();
            if (entity.getUuid().equals(namedId)) {
                named++;
            } else if (pile.contains(pos)) {
                if (entity instanceof ItemEntity) items++;
                else if (entity instanceof ExperienceOrbEntity) orbs++;
                else if (entity.getType() == EntityType.COW) cows++;
                else if (entity.getType() == EntityType.PIG) pigs++;
                else if (entity.getType() == EntityType.ZOMBIE) zombies++;
            } else if (behind.contains(pos) && entity.getType() == EntityType.COW) {
                behindCows++;
            }
        }
        return new Counts(items, orbs, cows, pigs, zombies, named, behindCows, world.getRegularEntityCount());
    }

    static Entity find(ClientWorld world, UUID id) {
        for (Entity entity : world.getEntities()) {
            if (entity.getUuid().equals(id)) return entity;
        }
        return null;
    }
}
