// /ticket panel: posts the "Open ticket" button. The buttons are handled in features/tickets.js.
import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import { handleTicketButton, ticketPanelMessage } from "../features/tickets.js";
import { requireBotPermissions } from "../features/moderation.js";
import { ephemeral } from "../lib/respond.js";
import { getSettings } from "../lib/settings.js";

const data = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Support tickets")
  .setDefaultMemberPermissions(P.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s.setName("panel").setDescription("Post an \"Open ticket\" button in this channel")
      .addStringOption((o) => o.setName("title").setDescription("Panel title").setMaxLength(256))
      .addStringOption((o) => o.setName("description").setDescription("Panel text").setMaxLength(2000)),
  );

async function execute(interaction, ctx) {
  requireBotPermissions(interaction, [P.ViewChannel, P.SendMessages, P.EmbedLinks]);
  const title = interaction.options.getString("title") ?? "Need help?";
  const description =
    interaction.options.getString("description") ??
    "Press the button below to open a private ticket with our staff team.";
  await interaction.channel.send(ticketPanelMessage({ title, description }));

  const { ticketCategoryId, staffRoleId } = getSettings(ctx.db, interaction.guildId);
  const note = ticketCategoryId && staffRoleId ? "" : "\n⚠️ Run `/setup tickets` before people start using it.";
  await interaction.reply(ephemeral(`✅ Ticket panel posted.${note}`));
}

export default { category: "Tickets", data, execute, components: { ticket: handleTicketButton } };
