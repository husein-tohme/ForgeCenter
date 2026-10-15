// /roll: roll dice like "d20" or "2d6+3".
import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { DICE_LIMITS, parseDice, rollDice } from "../lib/games.js";
import { UserError } from "../lib/errors.js";

const data = new SlashCommandBuilder()
  .setName("roll")
  .setDescription("Roll dice")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName("dice").setDescription('Like "d20", "2d6" or "3d8+2" (default 1d6)').setMaxLength(20));

async function execute(interaction) {
  const input = interaction.options.getString("dice") ?? "1d6";
  const dice = parseDice(input);
  if (!dice) {
    throw new UserError(
      `I can't read "${input}". Try something like \`d20\`, \`2d6\` or \`3d8+2\` ` +
        `(up to ${DICE_LIMITS.maxCount} dice with up to ${DICE_LIMITS.maxSides} sides).`,
    );
  }
  const { rolls, total } = rollDice(dice);
  // Show each die when there are a few, e.g. "(3 + 5) + 2".
  let detail = "";
  if (rolls.length > 1 || dice.modifier) {
    detail = rolls.length <= 20 ? `(${rolls.join(" + ")})` : `(${rolls.length} dice)`;
    if (dice.modifier) detail += ` ${dice.modifier > 0 ? "+" : "-"} ${Math.abs(dice.modifier)}`;
    detail = ` ${detail}`;
  }
  await interaction.reply({
    content: `🎲 ${interaction.user} rolled **${input}** and got **${total}**${detail}`,
    allowedMentions: { parse: [] },
  });
}

export default { category: "Fun", data, execute };
