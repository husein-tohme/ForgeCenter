package dev.forgecenter.compactor.mixin;

import dev.forgecenter.compactor.Compactor;
import net.minecraft.client.render.Frustum;
import net.minecraft.client.render.entity.EntityRenderDispatcher;
import net.minecraft.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** The game asks this before drawing each entity; extra copies in a pile get "no". */
@Mixin(EntityRenderDispatcher.class)
public abstract class EntityRenderDispatcherMixin {
    // At RETURN, after the game's own off-screen and distance checks: only entities it was really
    // about to draw take up a pile's slots. Otherwise copies off screen could use them up and hide
    // the ones in view.
    @Inject(method = "shouldRender", at = @At("RETURN"), cancellable = true)
    private <E extends Entity> void entitycompactor$skipPiles(E entity, Frustum frustum, double x, double y, double z, CallbackInfoReturnable<Boolean> cir) {
        if (cir.getReturnValueZ() && Compactor.shouldHide(entity)) cir.setReturnValue(false);
    }
}
