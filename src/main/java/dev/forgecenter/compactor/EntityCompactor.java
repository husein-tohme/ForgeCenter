package dev.forgecenter.compactor;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommands;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.minecraft.client.KeyMapping;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import org.lwjgl.glfw.GLFW;

/** Loads the settings and adds two ways to turn the mod on and off: /compactor and the K key. */
public final class EntityCompactor implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        Settings.load();

        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) ->
            dispatcher.register(ClientCommands.literal("compactor").executes(ctx -> {
                ctx.getSource().sendFeedback(toggle());
                return 1;
            })));

        // Rebindable in Options > Controls, under "Entity Compactor".
        KeyMapping.Category category = KeyMapping.Category.register(Identifier.fromNamespaceAndPath("entitycompactor", "main"));
        KeyMapping toggleKey = KeyMappingHelper.registerKeyMapping(
            new KeyMapping("key.entitycompactor.toggle", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_K, category));
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (toggleKey.consumeClick()) {
                Component message = toggle();
                if (client.player != null) client.player.sendSystemMessage(message);
            }
        });
    }

    /** Flips the mod on or off, saves that, and returns the message to show. */
    static Component toggle() {
        Settings.enabled = !Settings.enabled;
        Settings.save();
        return Component.translatable(Settings.enabled ? "entitycompactor.on" : "entitycompactor.off");
    }
}
