package dev.forgecenter.compactor;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** Sets up the toggle key and resets the per-frame counts before each frame is drawn. */
public final class EntityCompactor implements ClientModInitializer {
    private static KeyBinding toggleKey;

    @Override
    public void onInitializeClient() {
        Settings.load();
        toggleKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "key.entitycompactor.toggle", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_K, "category.entitycompactor"));

        WorldRenderEvents.START.register(context -> Compactor.startFrame());

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (toggleKey.wasPressed()) {
                Settings.enabled = !Settings.enabled;
                Settings.save();
                if (client.player != null) {
                    client.player.sendMessage(Text.translatable(Settings.enabled ? "entitycompactor.on" : "entitycompactor.off"), true);
                }
            }
        });
    }
}
