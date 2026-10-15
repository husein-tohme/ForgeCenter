// Trivia: one question, four answer buttons, 20 seconds. Right answers earn coins.
// Open questions are kept in memory; if the bot restarts, old buttons just say "expired".
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, time, userMention } from "discord.js";
import { addCoins } from "../lib/economy.js";
import { UserError } from "../lib/errors.js";
import { ephemeral } from "../lib/respond.js";
import { checkAnswer, pickQuestion, prepareQuestion, TRIVIA_TIME_LIMIT_MS } from "../lib/trivia.js";
import { COLORS } from "./logging.js";

const LETTERS = ["A", "B", "C", "D"];
const sessions = new Map(); // sessionId -> { userId, guildId, prepared, interaction, timer }

const memberKey = (guildId, userId) => `${guildId}:${userId}`;
const activeMembers = new Set();

function answerButtons(sessionId, prepared, { reveal = false, chosen = null } = {}) {
  const buttons = prepared.options.map((option, i) => {
    let style = ButtonStyle.Primary;
    if (reveal) {
      if (i === prepared.correctIndex) style = ButtonStyle.Success;
      else if (i === chosen) style = ButtonStyle.Danger;
      else style = ButtonStyle.Secondary;
    }
    return new ButtonBuilder()
      .setCustomId(`trivia:${sessionId}:${i}`)
      .setLabel(`${LETTERS[i]}. ${option}`.slice(0, 80))
      .setStyle(style)
      .setDisabled(reveal);
  });
  return new ActionRowBuilder().addComponents(buttons);
}

function endSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  clearTimeout(session.timer);
  sessions.delete(sessionId);
  activeMembers.delete(memberKey(session.guildId, session.userId));
  return session;
}

async function timeUp(sessionId) {
  const session = endSession(sessionId);
  if (!session) return;
  const { prepared } = session;
  const embed = new EmbedBuilder()
    .setColor(COLORS.warn)
    .setTitle("⏰ Time's up!")
    .setDescription(`**${prepared.question}**\n\nThe answer was **${prepared.options[prepared.correctIndex]}**.`);
  await session.interaction
    .editReply({ embeds: [embed], components: [answerButtons(sessionId, prepared, { reveal: true })] })
    .catch((error) => console.warn(`[trivia] Could not show the time-out: ${error.message}`));
}

/** /trivia */
export async function startTrivia(interaction, ctx, category = "any") {
  const { guildId, user } = interaction;
  const key = memberKey(guildId, user.id);
  if (activeMembers.has(key)) throw new UserError("Answer your current trivia question first!");

  const sessionId = interaction.id;
  const prepared = prepareQuestion(pickQuestion(category));
  const endsAt = new Date(Date.now() + TRIVIA_TIME_LIMIT_MS);
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(prepared.category === "minecraft" ? "⛏️ Minecraft trivia" : "🧠 Trivia")
    .setDescription(`**${prepared.question}**\n\nTime runs out ${time(endsAt, "R")}.`)
    .setFooter({ text: `A right answer is worth ${ctx.config.triviaReward} coins.` });

  activeMembers.add(key);
  sessions.set(sessionId, {
    userId: user.id,
    guildId,
    prepared,
    interaction,
    timer: setTimeout(() => timeUp(sessionId), TRIVIA_TIME_LIMIT_MS),
  });
  try {
    await interaction.reply({ embeds: [embed], components: [answerButtons(sessionId, prepared)] });
  } catch (error) {
    endSession(sessionId);
    throw error;
  }
}

/** "trivia:<sessionId>:<answerIndex>" buttons */
export async function answerTrivia(interaction, ctx) {
  const [, sessionId, choice] = interaction.customId.split(":");
  const session = sessions.get(sessionId);
  if (!session) {
    return interaction.reply(ephemeral("⏰ This question has already ended. Start a new one with `/trivia`!"));
  }
  if (session.userId !== interaction.user.id) {
    return interaction.reply(
      ephemeral(`This question is for ${userMention(session.userId)}. Start your own with \`/trivia\`!`),
    );
  }

  endSession(sessionId);
  const { prepared } = session;
  const chosen = Number(choice);
  const right = checkAnswer(prepared, chosen);
  const answer = prepared.options[prepared.correctIndex];
  let description = `**${prepared.question}**\n\n`;
  if (right) {
    const balance = addCoins(ctx.db, interaction.guildId, interaction.user.id, ctx.config.triviaReward);
    description += `✅ **${answer}** is right! You earned **${ctx.config.triviaReward}** coins (balance: ${balance.toLocaleString("en-US")}).`;
  } else {
    description += `❌ Not quite. The answer was **${answer}**.`;
  }
  const embed = new EmbedBuilder()
    .setColor(right ? COLORS.success : COLORS.kick)
    .setTitle(right ? "🎉 Correct!" : "Wrong answer")
    .setDescription(description);
  await interaction.update({ embeds: [embed], components: [answerButtons(sessionId, prepared, { reveal: true, chosen })] });
}
