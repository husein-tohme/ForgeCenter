// /roles panel: a panel of buttons members press to give themselves roles.
import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import { finishRolePanel, startRolePanel, toggleRole } from "../features/reactionRoles.js";
import { requireBotPermissions } from "../features/moderation.js";

const data = new SlashCommandBuilder()
  .setName("roles")
  .setDescription("Self-assignable roles")
  .setDefaultMemberPermissions(P.ManageRoles)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s.setName("panel").setDescription("Post a panel where members pick their own roles (up to 25)")
      .addStringOption((o) => o.setName("title").setDescription("Panel title").setMaxLength(256))
      .addStringOption((o) => o.setName("description").setDescription("Panel text").setMaxLength(1000)),
  );

async function execute(interaction) {
  requireBotPermissions(interaction, [P.ViewChannel, P.SendMessages, P.EmbedLinks]);
  await startRolePanel(interaction, {
    title: interaction.options.getString("title") ?? "Pick your roles",
    description: interaction.options.getString("description") ?? "Choose the roles you want:",
  });
}

export default {
  category: "Roles",
  data,
  execute,
  components: { roles: finishRolePanel, rr: toggleRole },
};
