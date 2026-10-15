package org.bukkit.command;
public interface CommandSender extends net.kyori.adventure.audience.Audience { String getName(); void sendMessage(String message); }
