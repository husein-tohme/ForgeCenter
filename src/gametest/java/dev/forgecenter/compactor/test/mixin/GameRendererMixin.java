package dev.forgecenter.compactor.test.mixin;

import dev.forgecenter.compactor.test.FrameStats;
import net.minecraft.client.render.GameRenderer;
import net.minecraft.client.render.RenderTickCounter;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Times the drawing part of each frame (world, entities and HUD, before the buffer swap). */
@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {
    @Unique
    private long entitycompactortest$start;

    @Inject(method = "render(Lnet/minecraft/client/render/RenderTickCounter;Z)V", at = @At("HEAD"))
    private void entitycompactortest$startDraw(RenderTickCounter tickCounter, boolean tick, CallbackInfo ci) {
        entitycompactortest$start = System.nanoTime();
    }

    @Inject(method = "render(Lnet/minecraft/client/render/RenderTickCounter;Z)V", at = @At("RETURN"))
    private void entitycompactortest$endDraw(RenderTickCounter tickCounter, boolean tick, CallbackInfo ci) {
        FrameStats.drawNanos += System.nanoTime() - entitycompactortest$start;
        FrameStats.draws++;
    }
}
