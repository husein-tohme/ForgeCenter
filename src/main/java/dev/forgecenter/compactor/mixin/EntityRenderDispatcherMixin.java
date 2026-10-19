package dev.forgecenter.compactor.mixin;

import dev.forgecenter.compactor.Compactor;
import net.minecraft.client.renderer.culling.Frustum;
import net.minecraft.client.renderer.entity.EntityRenderDispatcher;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * The game asks this before drawing each entity; extra copies in a pile get "no". It runs
 * after the game's own answer, so only entities that would really be drawn take a pile's
 * slots: otherwise copies behind you or just off-screen used them up and the visible part
 * of a pile vanished.
 */
@Mixin(EntityRenderDispatcher.class)
public abstract class EntityRenderDispatcherMixin {
    @Inject(method = "shouldRender", at = @At("RETURN"), cancellable = true)
    private <E extends Entity> void entitycompactor$skipPiles(E entity, Frustum frustum, double x, double y, double z, CallbackInfoReturnable<Boolean> cir) {
        if (cir.getReturnValueZ() && Compactor.shouldHide(entity)) cir.setReturnValue(false);
    }
}
