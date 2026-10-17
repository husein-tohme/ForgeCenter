// Built-in trivia questions. Add your own: one right answer and exactly three wrong ones.
// category is "minecraft" or "general".

export const QUESTIONS = [
  // Minecraft
  { category: "minecraft", question: "Which mob sneaks up on you and explodes?", answer: "Creeper", wrong: ["Zombie", "Skeleton", "Spider"] },
  { category: "minecraft", question: "Which block is used to build a Nether portal frame?", answer: "Obsidian", wrong: ["Cobblestone", "Netherrack", "Bedrock"] },
  { category: "minecraft", question: "What is the name of the giant boss that lives in The End?", answer: "Ender Dragon", wrong: ["Wither", "Elder Guardian", "Warden"] },
  { category: "minecraft", question: "What is the weakest pickaxe that can mine diamond ore?", answer: "Iron pickaxe", wrong: ["Stone pickaxe", "Golden pickaxe", "Wooden pickaxe"] },
  { category: "minecraft", question: "Which item do you use to tame a wolf?", answer: "Bone", wrong: ["Raw fish", "Seeds", "Carrot"] },
  { category: "minecraft", question: "Which mob drops Ender Pearls?", answer: "Enderman", wrong: ["Blaze", "Ghast", "Witch"] },
  { category: "minecraft", question: "An Eye of Ender is crafted from an Ender Pearl and what?", answer: "Blaze Powder", wrong: ["Gunpowder", "Redstone Dust", "Glowstone Dust"] },
  { category: "minecraft", question: "In which dimension can you find Ancient Debris?", answer: "The Nether", wrong: ["The Overworld", "The End", "The Void"] },
  { category: "minecraft", question: "How many hearts does a player have at full health?", answer: "10", wrong: ["8", "12", "20"] },
  { category: "minecraft", question: "Which blind mob lives in the Deep Dark and finds you by sound?", answer: "Warden", wrong: ["Allay", "Sniffer", "Breeze"] },
  { category: "minecraft", question: "A pig struck by lightning turns into which mob?", answer: "Zombified Piglin", wrong: ["Hoglin", "Charged Creeper", "Piglin Brute"] },
  { category: "minecraft", question: "What can you wear on your head so Endermen don't get angry when you look at them?", answer: "Carved Pumpkin", wrong: ["Iron Helmet", "Turtle Shell", "Leather Cap"] },
  { category: "minecraft", question: "Which helmet lets you breathe a little longer underwater?", answer: "Turtle Shell", wrong: ["Carved Pumpkin", "Chainmail Helmet", "Golden Helmet"] },
  { category: "minecraft", question: "What is the name of the classic default skin with the blue shirt?", answer: "Steve", wrong: ["Alex", "Herobrine", "Notch"] },
  { category: "minecraft", question: "Which block lets you skip the night?", answer: "Bed", wrong: ["Campfire", "Lantern", "Hay Bale"] },
  { category: "minecraft", question: "How many obsidian blocks does the smallest Nether portal need (no corners)?", answer: "10", wrong: ["8", "12", "14"] },

  // General knowledge
  { category: "general", question: "What is the largest planet in our solar system?", answer: "Jupiter", wrong: ["Saturn", "Neptune", "Earth"] },
  { category: "general", question: "Which planet is known as the Red Planet?", answer: "Mars", wrong: ["Venus", "Jupiter", "Mercury"] },
  { category: "general", question: "What is the closest star to Earth?", answer: "The Sun", wrong: ["Polaris", "Sirius", "Alpha Centauri"] },
  { category: "general", question: "How many legs does a spider have?", answer: "8", wrong: ["6", "10", "12"] },
  { category: "general", question: "What is the fastest land animal?", answer: "Cheetah", wrong: ["Lion", "Horse", "Greyhound"] },
  { category: "general", question: "What is the largest animal that has ever lived?", answer: "Blue whale", wrong: ["T. rex", "African elephant", "Giraffe"] },
  { category: "general", question: "What does a caterpillar turn into?", answer: "Butterfly", wrong: ["Bee", "Dragonfly", "Beetle"] },
  { category: "general", question: "What sweet food do bees make?", answer: "Honey", wrong: ["Milk", "Syrup", "Butter"] },
  { category: "general", question: "How many continents are there on Earth?", answer: "7", wrong: ["5", "6", "8"] },
  { category: "general", question: "What is the largest ocean on Earth?", answer: "Pacific Ocean", wrong: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean"] },
  { category: "general", question: "Which gas do plants take in from the air to make their food?", answer: "Carbon dioxide", wrong: ["Oxygen", "Helium", "Hydrogen"] },
  { category: "general", question: "At what temperature does water freeze in Celsius?", answer: "0 °C", wrong: ["10 °C", "32 °C", "-10 °C"] },
  { category: "general", question: "What color do you get when you mix blue and yellow?", answer: "Green", wrong: ["Purple", "Orange", "Brown"] },
  { category: "general", question: "How many sides does a hexagon have?", answer: "6", wrong: ["5", "7", "8"] },
  { category: "general", question: "What is 7 × 8?", answer: "56", wrong: ["54", "48", "64"] },
  { category: "general", question: "How many minutes are in an hour?", answer: "60", wrong: ["100", "30", "90"] },
  { category: "general", question: "What is the capital city of France?", answer: "Paris", wrong: ["London", "Rome", "Madrid"] },
];
