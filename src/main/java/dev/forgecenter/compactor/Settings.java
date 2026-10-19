package dev.forgecenter.compactor;

import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import net.fabricmc.loader.api.FabricLoader;

/** Settings in config/entitycompactor.properties. Edit the file and restart to change them. */
public final class Settings {
    public static boolean enabled = true;
    public static int itemsPerSpot = 2;
    public static int orbsPerSpot = 2;
    public static int mobsPerSpot = 4;
    public static int itemCellSize = 1;
    public static int mobCellSize = 2;

    private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("entitycompactor.properties");

    private Settings() {}

    static void load() {
        Properties p = new Properties();
        if (Files.exists(FILE)) {
            try (Reader r = Files.newBufferedReader(FILE)) { p.load(r); } catch (Exception ignored) {}
        }
        enabled = Boolean.parseBoolean(p.getProperty("enabled", "true"));
        itemsPerSpot = number(p, "itemsPerSpot", 2, 1, 64);
        orbsPerSpot = number(p, "orbsPerSpot", 2, 1, 64);
        mobsPerSpot = number(p, "mobsPerSpot", 4, 1, 64);
        itemCellSize = number(p, "itemCellSize", 1, 1, 8);
        mobCellSize = number(p, "mobCellSize", 2, 1, 8);
        save();
    }

    static void save() {
        Properties p = new Properties();
        p.setProperty("enabled", String.valueOf(enabled));
        p.setProperty("itemsPerSpot", String.valueOf(itemsPerSpot));
        p.setProperty("orbsPerSpot", String.valueOf(orbsPerSpot));
        p.setProperty("mobsPerSpot", String.valueOf(mobsPerSpot));
        p.setProperty("itemCellSize", String.valueOf(itemCellSize));
        p.setProperty("mobCellSize", String.valueOf(mobCellSize));
        try (Writer w = Files.newBufferedWriter(FILE)) {
            p.store(w, "Entity Compactor: how many of each item/orb/mob to draw per spot, and how big a spot is (in blocks)");
        } catch (Exception ignored) {}
    }

    private static int number(Properties p, String key, int fallback, int min, int max) {
        try { return Math.max(min, Math.min(max, Integer.parseInt(p.getProperty(key, "").trim()))); }
        catch (NumberFormatException e) { return fallback; }
    }
}
