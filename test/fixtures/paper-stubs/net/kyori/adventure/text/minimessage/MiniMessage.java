package net.kyori.adventure.text.minimessage;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.tag.resolver.TagResolver;
public interface MiniMessage {
  static MiniMessage miniMessage() { return null; }
  Component deserialize(String input);
  Component deserialize(String input, TagResolver... tagResolvers);
}
