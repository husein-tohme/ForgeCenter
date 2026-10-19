package dev.forgecenter.compactor;

import it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.ExperienceOrb;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;

/**
 * Decides which entities get drawn. Entities are grouped by kind (each item type and
 * each mob type separately) and by a small cube of space; only the first few in each
 * group are drawn each frame. A farm with 500 dropped stacks on a hopper line ends up
 * drawing a handful instead of 500. Only drawing is skipped: the entities still exist,
 * still tick, and can still be hit or picked up.
 */
public final class Compactor {
    /** One pile: what it is and which cube of space it's in. A record, so keys never collide. */
    private record Pile(int kind, int x, int y, int z) {}

    private static final Object2IntOpenHashMap<Pile> drawn = new Object2IntOpenHashMap<>();
    private static int hiddenThisFrame;
    /** How many entities were skipped in the last finished frame (for tests and debugging). */
    public static volatile int hiddenLastFrame;
    /** Frames started since the game launched (for tests and debugging). */
    public static volatile long frames;

    private Compactor() {}

    public static void startFrame() {
        drawn.clear();
        hiddenLastFrame = hiddenThisFrame;
        hiddenThisFrame = 0;
        frames++;
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
            kind = 1_000_000 + BuiltInRegistries.ITEM.getId(item.getItem().getItem());
        } else if (entity instanceof ExperienceOrb) {
            limit = Settings.orbsPerSpot;
            cell = Settings.itemCellSize;
            kind = 1;
        } else if (entity instanceof LivingEntity) {
            limit = Settings.mobsPerSpot;
            cell = Settings.mobCellSize;
            kind = 2_000_000 + BuiltInRegistries.ENTITY_TYPE.getId(entity.getType());
        } else {
            return false;
        }

        Pile pile = new Pile(kind,
            Math.floorDiv((int) Math.floor(entity.getX()), cell),
            Math.floorDiv((int) Math.floor(entity.getY()), cell),
            Math.floorDiv((int) Math.floor(entity.getZ()), cell));
        int count = drawn.addTo(pile, 1) + 1;
        if (count <= limit) return false;
        hiddenThisFrame++;
        return true;
    }
}
