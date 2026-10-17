// Plugin Forge: generates a Paper server plugin (Gradle project) with custom
// commands, a welcome message and timed announcements. Messages live in
// config.yml, so server owners can change them without rebuilding.

// Paper versions offered, with the Java version each needs.
export const PAPER_VERSIONS = { "1.21.8": 21, "1.21.4": 21, "1.21.1": 21, "1.20.6": 21, "1.20.4": 17 };
const MAX_COMMANDS = 10;

const JAVA_KEYWORDS = new Set(("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null record var yield sealed permits").split(" "));
// Names the generated class imports or gets from java.lang; a plugin can't share them.
const TAKEN_CLASS_NAMES = new Set(("List MiniMessage Placeholder Bukkit Command CommandSender Player EventHandler Listener PlayerJoinEvent JavaPlugin BukkitTask String Object Override Math System Integer Long Boolean Character Byte Short Float Double Number Thread Runnable Exception Error Class Enum Record Void Iterable Comparable Process Runtime Module Package").split(" "));
const safeSegment = s => (JAVA_KEYWORDS.has(s) ? `${s}plugin` : s);

const words = s => String(s).replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
const pascal = s => words(s).map(w => w[0].toUpperCase() + w.slice(1)).join("");
// YAML accepts JSON strings, which also takes care of quotes, colons and newlines.
const yaml = s => JSON.stringify(String(s));
// Users write {player}; MiniMessage needs <player>.
const message = s => String(s).trim().slice(0, 256).replace(/\{player\}/g, "<player>");

export function validatePlugin(input) {
  let className = pascal(input.name).replace(/^\d+/, "").slice(0, 32);
  if (!className) throw new Error("Give the plugin a name that starts with a letter.");
  if (TAKEN_CLASS_NAMES.has(className)) className += "Plugin";
  const authorId = safeSegment(words(input.author).join("").toLowerCase().replace(/^\d+/, "").slice(0, 24));
  if (!authorId) throw new Error("Add your name (letters or numbers).");
  const gameVersion = input.gameVersion in PAPER_VERSIONS ? input.gameVersion : null;
  if (!gameVersion) throw new Error("Pick a Minecraft version.");

  const id = safeSegment(className.toLowerCase());
  const reloadCommand = `${id}reload`;
  const commands = (Array.isArray(input.commands) ? input.commands : [])
    .map(c => ({ name: String(c?.name ?? "").trim().replace(/^\//, "").toLowerCase(), reply: message(c?.reply ?? "") }))
    .filter(c => c.name || c.reply);
  if (commands.length > MAX_COMMANDS) throw new Error(`A plugin can have up to ${MAX_COMMANDS} commands.`);
  const seen = new Set([reloadCommand]);
  for (const c of commands) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(c.name)) throw new Error(`"/${c.name}" isn't a valid command. Use letters, numbers, - or _.`);
    if (!c.reply) throw new Error(`Write what /${c.name} should say.`);
    if (seen.has(c.name)) throw new Error(`/${c.name} is in the list twice.`);
    seen.add(c.name);
  }
  const announcements = String(input.announcements ?? "").split(/\r?\n/).map(message).filter(Boolean).slice(0, 20);
  const minutes = Math.min(1440, Math.max(1, Number.parseInt(input.announceEvery, 10) || 10));

  return {
    className, id, reloadCommand, commands, announcements, minutes, gameVersion,
    name: String(input.name).trim().slice(0, 60), author: String(input.author).trim().slice(0, 40),
    description: String(input.description ?? "").trim().slice(0, 200),
    welcome: message(input.welcome ?? ""),
    pkg: `com.${authorId}.${id}`,
  };
}

function pluginYml(p) {
  const lines = [
    `name: ${p.className}`, `version: '1.0.0'`, `main: ${p.pkg}.${p.className}`,
    `api-version: '${p.gameVersion.split(".").slice(0, 2).join(".")}'`,
    `description: ${yaml(p.description || `${p.name}, made with ForgeCenter`)}`, `author: ${yaml(p.author)}`,
    "commands:",
    ...p.commands.flatMap(c => [`  ${c.name}:`, `    description: ${yaml(`Shows the ${c.name} message`)}`]),
    `  ${p.reloadCommand}:`, `    description: "Reloads config.yml"`, `    permission: ${p.id}.reload`,
    "permissions:", `  ${p.id}.reload:`, `    description: "Reload the plugin's messages"`, "    default: op",
  ];
  return `${lines.join("\n")}\n`;
}

function configYml(p) {
  const lines = [
    `# ${p.name} settings. Colours use MiniMessage tags like <green> or <bold>.`,
    "# <player> is replaced with the player's name. After editing, run",
    `# /${p.reloadCommand} or restart the server.`,
    "",
    "# Sent to each player when they join. Leave empty to turn it off.",
    `welcome-message: ${yaml(p.welcome)}`,
    "",
    "# What each command replies.",
    p.commands.length ? "commands:" : "commands: {}",
    ...p.commands.map(c => `  ${c.name}: ${yaml(c.reply)}`),
    "",
    "# Broadcast to everyone, one at a time, in a loop.",
    "announcements:",
    `  every-minutes: ${p.minutes}`,
    p.announcements.length ? "  messages:" : "  messages: []",
    ...p.announcements.map(a => `    - ${yaml(a)}`),
  ];
  return `${lines.join("\n")}\n`;
}

function mainJava(p) {
  return `package ${p.pkg};

import java.util.List;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

public final class ${p.className} extends JavaPlugin implements Listener {
    private final MiniMessage miniMessage = MiniMessage.miniMessage();
    private BukkitTask announcer;
    private int nextAnnouncement = 0;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        getServer().getPluginManager().registerEvents(this, this);
        startAnnouncements();
        getLogger().info("${p.className} is enabled.");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (command.getName().equalsIgnoreCase("${p.reloadCommand}")) {
            reloadConfig();
            startAnnouncements();
            sender.sendMessage(miniMessage.deserialize("<green>${p.className} reloaded."));
            return true;
        }
        String reply = getConfig().getString("commands." + command.getName().toLowerCase());
        if (reply == null || reply.isEmpty()) {
            return false;
        }
        sender.sendMessage(miniMessage.deserialize(reply, Placeholder.unparsed("player", sender.getName())));
        return true;
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        String welcome = getConfig().getString("welcome-message", "");
        if (welcome == null || welcome.isEmpty()) {
            return;
        }
        Player player = event.getPlayer();
        player.sendMessage(miniMessage.deserialize(welcome, Placeholder.unparsed("player", player.getName())));
    }

    private void startAnnouncements() {
        if (announcer != null) {
            announcer.cancel();
            announcer = null;
        }
        List<String> messages = getConfig().getStringList("announcements.messages");
        long minutes = getConfig().getLong("announcements.every-minutes", 10);
        if (messages.isEmpty() || minutes <= 0) {
            return;
        }
        long ticks = minutes * 60 * 20;
        announcer = getServer().getScheduler().runTaskTimer(this, () -> {
            List<String> current = getConfig().getStringList("announcements.messages");
            if (current.isEmpty()) {
                return;
            }
            Bukkit.broadcast(miniMessage.deserialize(current.get(nextAnnouncement++ % current.size())));
        }, ticks, ticks);
    }
}
`;
}

export function pluginFiles(input) {
  const p = validatePlugin(input);
  const java = PAPER_VERSIONS[p.gameVersion];
  const dir = `src/main/java/${p.pkg.replace(/\./g, "/")}`;
  return {
    [`${dir}/${p.className}.java`]: mainJava(p),
    "src/main/resources/plugin.yml": pluginYml(p),
    "src/main/resources/config.yml": configYml(p),
    "settings.gradle.kts": `rootProject.name = "${p.className}"\n`,
    "build.gradle.kts": `plugins {
    java
}

group = "${p.pkg}"
version = "1.0.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:${p.gameVersion}-R0.1-SNAPSHOT")
}

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(${java}))
}
`,
    ".gitignore": "build/\n.gradle/\n.idea/\n*.iml\n",
    "README.md": `# ${p.name}

${p.description || "A Paper plugin made with ForgeCenter Plugin Forge."}

For Paper ${p.gameVersion} (also works on Purpur).

## Build it

1. Install Java ${java} (for example from adoptium.net).
2. Open this folder in IntelliJ IDEA Community and let it load the Gradle project, then run the \`build\` Gradle task.
   Or, with Gradle installed, run \`gradle build\` in this folder.
3. The plugin is at \`build/libs/${p.className}-1.0.0.jar\`.

## Install it

Put the jar in your server's \`plugins\` folder and restart the server.
Edit \`plugins/${p.className}/config.yml\` to change the messages, then run \`/${p.reloadCommand}\`.

## Commands

${[...p.commands.map(c => `- \`/${c.name}\``), `- \`/${p.reloadCommand}\` reloads the messages (operators only)`].join("\n")}
`,
  };
}

// The two files people care about seeing while they fill in the form.
export function pluginPreview(input) {
  const p = validatePlugin(input);
  return { "plugin.yml": pluginYml(p), "config.yml": configYml(p) };
}
