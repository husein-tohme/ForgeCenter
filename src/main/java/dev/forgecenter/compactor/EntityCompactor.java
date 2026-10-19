package dev.forgecenter.compactor;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.minecraft.network.chat.Component;

/** Loads the settings and adds /compactor to turn the mod on and off. */
public final class EntityCompactor implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        Settings.load();
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) ->
            dispatcher.register(ClientCommandManager.literal("compactor").executes(ctx -> {
                Settings.enabled = !Settings.enabled;
                Settings.save();
                ctx.getSource().sendFeedback(Component.literal(Settings.enabled
                    ? "Entity Compactor: ON (hiding piled-up items and mobs)"
                    : "Entity Compactor: OFF (drawing everything)"));
                return 1;
            })));
    }
}
