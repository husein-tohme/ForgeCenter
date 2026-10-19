package dev.forgecenter.compactor.test.mixin;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import dev.forgecenter.compactor.test.FrameProbe;
import net.minecraft.client.renderer.culling.Frustum;
import net.minecraft.client.renderer.entity.EntityRenderDispatcher;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;

/** Sees every "should this entity be drawn?" answer, including the ones the mod changed. */
@Mixin(EntityRenderDispatcher.class)
abstract class EntityRenderDispatcherProbeMixin {
    @WrapMethod(method = "shouldRender")
    private boolean entitycompactortest$record(Entity entity, Frustum frustum, double camX, double camY, double camZ, Operation<Boolean> original) {
        boolean drawn = original.call(entity, frustum, camX, camY, camZ);
        FrameProbe.onShouldRender(entity, drawn);
        return drawn;
    }
}
