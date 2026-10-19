package dev.forgecenter.compactor.mixin;

import dev.forgecenter.compactor.Compactor;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Starts a fresh count once per frame, before the world is drawn. */
@Mixin(GameRenderer.class)
public abstract class LevelRendererMixin {
    @Inject(method = "renderLevel", at = @At("HEAD"))
    private void entitycompactor$newFrame(CallbackInfo ci) {
        Compactor.startFrame();
    }
}
