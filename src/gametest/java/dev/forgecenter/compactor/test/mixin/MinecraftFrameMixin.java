package dev.forgecenter.compactor.test.mixin;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import dev.forgecenter.compactor.test.FrameProbe;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;

/** Times each whole rendered frame: world, entities, HUD and the buffer swap. */
@Mixin(Minecraft.class)
abstract class MinecraftFrameMixin {
    @WrapMethod(method = "renderFrame")
    private void entitycompactortest$timeFrame(boolean renderLevel, Operation<Void> original) {
        long start = System.nanoTime();
        FrameProbe.frameStarted(start);
        original.call(renderLevel);
        FrameProbe.frameFinished(start, System.nanoTime());
    }
}
