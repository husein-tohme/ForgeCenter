package org.bukkit.configuration.file;
import java.util.List;
public abstract class FileConfiguration {
  public String getString(String path) { return null; }
  public String getString(String path, String def) { return def; }
  public List<String> getStringList(String path) { return null; }
  public long getLong(String path, long def) { return def; }
}
