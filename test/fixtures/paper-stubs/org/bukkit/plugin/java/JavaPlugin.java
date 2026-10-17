package org.bukkit.plugin.java;
import org.bukkit.Server;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.plugin.Plugin;
public abstract class JavaPlugin implements Plugin, CommandExecutor {
  public void onEnable() {}
  public void onDisable() {}
  public boolean onCommand(CommandSender sender, Command command, String label, String[] args) { return false; }
  public void saveDefaultConfig() {}
  public void reloadConfig() {}
  public FileConfiguration getConfig() { return null; }
  public Server getServer() { return null; }
  public java.util.logging.Logger getLogger() { return null; }
}
