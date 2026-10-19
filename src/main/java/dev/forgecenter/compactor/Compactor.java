package dev.forgecenter.compactor;

import java.util.HashMap;
import java.util.Map;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.ExperienceOrb;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;

/**
 * Decides which entities get drawn. Entities are grouped by kind and by a small cube of
 * space; only the first few in each group are drawn each frame. A farm with 500 dropped
 * items of the same kind on a hopper line ends up drawing a handful instead of 500.
 * Only drawing is skipped: the entities still exist and still tick.
 */
public final class Compactor {
    private static final Map<Long, Integer> drawn = new HashMap<>();

    private Compactor() {}

    public static void startFrame() {
        drawn.clear();
    }

    /** True if this entity should be skipped this frame. */
    public static boolean shouldHide(Entity entity) {
        if (!Settings.enabled || entity instanceof Player) return false;
        // Named mobs (pets, nametagged villagers) are always drawn.
        if (entity instanceof LivingEntity && entity.hasCustomName()) return false;

        int limit;
        int cell;
        int kind;
        if (entity instanceof ItemEntity item) {
            limit = Settings.itemsPerSpot;
            cell = Settings.itemCellSize;
            kind = BuiltInRegistries.ITEM.getId(item.getItem().getItem()) * 31 + 1;
        } else if (entity instanceof ExperienceOrb) {
            limit = Settings.orbsPerSpot;
            cell = Settings.itemCellSize;
            kind = 2;
        } else if (entity instanceof LivingEntity) {
            limit = Settings.mobsPerSpot;
            cell = Settings.mobCellSize;
            kind = BuiltInRegistries.ENTITY_TYPE.getId(entity.getType()) * 31 + 3;
        } else {
            return false;
        }

        long x = Math.floorDiv((int) Math.floor(entity.getX()), cell);
        long y = Math.floorDiv((int) Math.floor(entity.getY()), cell);
        long z = Math.floorDiv((int) Math.floor(entity.getZ()), cell);
        long key = ((x & 0x1FFFFF) << 42) ^ ((z & 0x1FFFFF) << 21) ^ (y & 0x1FFFFF) ^ ((long) kind << 50);

        int count = drawn.merge(key, 1, Integer::sum);
        return count > limit;
    }
}
