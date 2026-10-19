package dev.forgecenter.compactor.test.mixin;

import dev.forgecenter.compactor.test.FrameStats;
import net.minecraft.client.MinecraftClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Counts frames straight from the game loop, independent of Fabric's world render events. */
@Mixin(MinecraftClient.class)
public abstract class MinecraftClientMixin {
    @Inject(method = "render(Z)V", at = @At("HEAD"))
    private void entitycompactortest$countFrame(boolean tick, CallbackInfo ci) {
        FrameStats.frames++;
    }
}
