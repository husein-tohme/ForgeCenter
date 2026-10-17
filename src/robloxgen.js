// Roblox Forge: turns a few choices into a Rojo 7 project (Luau scripts that also
// parse as Lua 5.1, so tests can check them). Pure: options in, { path: text } out.
// Every value a visitor types reaches Lua only through luaString() or as a
// validated number, so nothing they type can break out of a string.

export const TEMPLATES = {
  obby: { label: "Obby", icon: "rbx-obby", text: "Jump from checkpoint to checkpoint. Stages save, kill bricks send you back." },
  tycoon: { label: "Tycoon", icon: "rbx-tycoon", text: "Claim a plot, droppers make parts, the collector pays you, buttons unlock more droppers." },
  simulator: { label: "Simulator", icon: "rbx-sim", text: "Click to earn, rebirth to multiply. The server checks every click so nobody can spam it." },
  minigame: { label: "Minigame rounds", icon: "rbx-round", text: "Lobby, countdown, then a falling-tiles arena. The last players standing win." },
};

export const EXTRAS = {
  daily: { label: "Daily reward", text: "A button that pays out once every 24 hours. The cooldown is saved." },
  leaderboard: { label: "Global leaderboard", text: "A board in the world showing the richest players across every server." },
  vip: { label: "VIP game pass", text: "Players who own your game pass earn more. You'll need the game pass id." },
};

// Each number's range, default, whether it must be whole, and which template or
// extra uses it (null = every game).
export const NUMBERS = {
  startingCurrency: { label: "Starting currency", min: 0, max: 1_000_000, def: 0, int: true, for: null },
  stages: { label: "Stages", min: 3, max: 50, def: 10, int: true, for: "obby" },
  stageReward: { label: "Currency per new stage", min: 0, max: 10_000, def: 5, int: true, for: "obby" },
  dropValue: { label: "Value of each dropped part", min: 1, max: 1000, def: 5, int: true, for: "tycoon" },
  dropInterval: { label: "Seconds between drops", min: 1, max: 30, def: 2, int: true, for: "tycoon" },
  dropperCost: { label: "Price of the second dropper", min: 1, max: 1_000_000, def: 50, int: true, for: "tycoon" },
  clickReward: { label: "Currency per click", min: 1, max: 1000, def: 1, int: true, for: "simulator" },
  clickCooldown: { label: "Seconds between clicks", min: 0.1, max: 5, def: 0.25, int: false, for: "simulator" },
  rebirthCost: { label: "First rebirth price", min: 10, max: 1_000_000_000, def: 1000, int: true, for: "simulator" },
  intermissionSeconds: { label: "Countdown seconds", min: 5, max: 120, def: 15, int: true, for: "minigame" },
  roundSeconds: { label: "Round length in seconds", min: 20, max: 600, def: 90, int: true, for: "minigame" },
  minPlayers: { label: "Players needed to start", min: 1, max: 20, def: 2, int: true, for: "minigame" },
  winReward: { label: "Currency for each winner", min: 1, max: 1_000_000, def: 25, int: true, for: "minigame" },
  dailyAmount: { label: "Daily reward amount", min: 1, max: 1_000_000, def: 100, int: true, for: "daily" },
  vipMultiplier: { label: "VIP earnings multiplier", min: 2, max: 10, def: 2, int: true, for: "vip" },
};

export const LIMITS = { name: 50, currency: 20, gamePassDigits: 15 };

class OptionError extends Error {}

// A double-quoted Lua string literal. Printable ASCII stays as is (except \ and "),
// everything else (newlines, control characters, UTF-8 bytes) becomes a \ddd escape.
export function luaString(value) {
  let out = '"';
  for (const byte of Buffer.from(String(value), "utf8")) {
    if (byte === 0x5c) out += "\\\\";
    else if (byte === 0x22) out += '\\"';
    else if (byte >= 0x20 && byte < 0x7f) out += String.fromCharCode(byte);
    else out += "\\" + String(byte).padStart(3, "0");
  }
  return out + '"';
}

export const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "") || "my-game";
// Roblox caps DataStore names at 50 characters; the leaderboard adds "_Top".
const dataStoreName = name => "ForgeData_v1_" + slug(name).slice(0, 30).replace(/-+$/, "");
const luaNumber = n => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));

// Leaderstats that some templates add next to the currency.
const RESERVED_STATS = ["stage", "rebirths"];

export function validate(input = {}) {
  if (!input || typeof input !== "object") throw new OptionError("Send the game options as JSON.");
  const template = input.template ?? "obby";
  if (typeof template !== "string" || !Object.hasOwn(TEMPLATES, template)) throw new OptionError("Pick one of the game templates.");

  if (typeof input.name !== "string") throw new OptionError("Give your game a name.");
  // Control characters become spaces; the name is still escaped when written to Lua.
  const name = input.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!name) throw new OptionError("Give your game a name.");
  if ([...name].length > LIMITS.name) throw new OptionError(`Keep the game name to ${LIMITS.name} characters or fewer.`);

  const currency = typeof input.currency === "string" ? input.currency.trim() : input.currency === undefined ? "Coins" : "";
  if (!/^[A-Za-z0-9 ]{1,20}$/.test(currency) || !/[A-Za-z0-9]/.test(currency))
    throw new OptionError("The currency name can use letters, numbers and spaces, up to 20 characters.");
  if (RESERVED_STATS.includes(currency.toLowerCase()))
    throw new OptionError(`"${currency}" is already used on the leaderboard. Pick a different currency name, like Coins or Gems.`);

  if (input.extras !== undefined && !Array.isArray(input.extras)) throw new OptionError("Send the extras as a list.");
  const extrasIn = input.extras ?? [];
  for (const e of extrasIn) if (typeof e !== "string" || !Object.hasOwn(EXTRAS, e)) throw new OptionError("One of the extras isn't one we know. Reload the page and try again.");
  const extras = Object.fromEntries(Object.keys(EXTRAS).map(k => [k, extrasIn.includes(k)]));

  const numbers = {};
  for (const [key, spec] of Object.entries(NUMBERS)) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === "") { numbers[key] = spec.def; continue; }
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*-?(\d+(\.\d+)?|\.\d+)\s*$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < spec.min || n > spec.max || (spec.int && !Number.isInteger(n)))
      throw new OptionError(`${spec.label} must be ${spec.int ? "a whole number" : "a number"} from ${spec.min} to ${spec.max.toLocaleString("en-US")}.`);
    numbers[key] = n;
  }

  let gamePassId = 0;
  if (extras.vip) {
    const id = String(input.gamePassId ?? "").trim();
    if (!new RegExp(`^[0-9]{1,${LIMITS.gamePassDigits}}$`).test(id) || Number(id) === 0)
      throw new OptionError("Enter your game pass id using digits only. You'll find it in the game pass link on Roblox.");
    gamePassId = Number(id);
  }
  return { template, name, currency, extras, numbers, gamePassId };
}
export const isOptionError = e => e instanceof OptionError;

// ---------- Files ----------

function configLua(o) {
  const n = o.numbers, L = luaNumber;
  const per = {
    obby: `Config.Stages = ${L(n.stages)}
Config.StageReward = ${L(n.stageReward)}`,
    tycoon: `Config.DropValue = ${L(n.dropValue)}
Config.DropInterval = ${L(n.dropInterval)}
-- Prices of the four droppers. The first one is free.
Config.DropperPrices = { 0, ${L(n.dropperCost)}, ${L(n.dropperCost * 5)}, ${L(n.dropperCost * 20)} }`,
    simulator: `Config.ClickReward = ${L(n.clickReward)}
Config.ClickCooldown = ${L(n.clickCooldown)}
-- Each rebirth costs this times the rebirth number and resets your currency.
Config.RebirthCost = ${L(n.rebirthCost)}`,
    minigame: `Config.IntermissionSeconds = ${L(n.intermissionSeconds)}
Config.RoundSeconds = ${L(n.roundSeconds)}
Config.MinPlayers = ${L(n.minPlayers)}
Config.WinReward = ${L(n.winReward)}`,
  }[o.template];
  return `-- Settings for ${o.template} game. Change a number here, save, and press Play in Studio.
local Config = {}

Config.GameName = ${luaString(o.name)}
Config.Currency = ${luaString(o.currency)}
Config.Template = ${luaString(o.template)}
-- Changing this starts everyone's saved data from scratch.
Config.DataStoreName = ${luaString(dataStoreName(o.name))}
Config.StartingCurrency = ${L(n.startingCurrency)}

${per}

Config.DailyReward = { Enabled = ${o.extras.daily}, Amount = ${L(n.dailyAmount)}, Cooldown = 86400 }
Config.Leaderboard = { Enabled = ${o.extras.leaderboard} }
Config.Vip = { Enabled = ${o.extras.vip}, GamePassId = ${o.gamePassId}, Multiplier = ${L(n.vipMultiplier)} }

return Config
`;
}

const HEADER = `local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
`;
const SERVER_HEADER = HEADER + `local DataService = require(script.Parent:WaitForChild("DataService"))
`;

const PARTS_LUA = `-- Small helpers for building the map from code.
local Parts = {}

function Parts.make(name, size, position, color, parent, className)
	local part = Instance.new(className or "Part")
	part.Name = name
	part.Size = size
	part.Position = position
	part.Anchored = true
	part.Color = color
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = parent
	return part
end

-- Returns the player and humanoid behind a touching part, if it belongs to a player.
function Parts.playerFromHit(hit)
	local character = hit.Parent
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return nil, nil
	end
	return game:GetService("Players"):GetPlayerFromCharacter(character), humanoid
end

function Parts.label(part, text)
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.new(0, 220, 0, 50)
	gui.StudsOffset = Vector3.new(0, 3, 0)
	gui.AlwaysOnTop = false
	gui.MaxDistance = 100
	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 1, 0)
	label.BackgroundTransparency = 1
	label.TextScaled = true
	label.Font = Enum.Font.GothamBold
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextStrokeTransparency = 0
	label.Text = text
	label.Parent = gui
	gui.Parent = part
	return label
end

return Parts
`;

const DATA_LUA = HEADER + `local DataStoreService = game:GetService("DataStoreService")

-- Loads and saves player data. Profiles live in a session cache while the player
-- is in the server; every DataStore call is wrapped in pcall and retried.
local DataService = {}
local store = DataStoreService:GetDataStore(Config.DataStoreName)
local sessions = {}
local MAX_TRIES = 3
-- Saves still running, so shutdown can wait for the ones PlayerRemoving started too.
local savesInFlight = 0

-- Which leaderstats value shows each saved field.
local STAT_NAMES = { Currency = Config.Currency, Stage = "Stage", Rebirths = "Rebirths" }

local function newProfile()
	return { Currency = Config.StartingCurrency, Stage = 1, Rebirths = 0, LastDaily = 0, Unlocked = {} }
end

local function withRetries(label, fn)
	local lastError
	for attempt = 1, MAX_TRIES do
		local ok, result = pcall(fn)
		if ok then
			return true, result
		end
		lastError = result
		warn(label .. " failed (try " .. attempt .. " of " .. MAX_TRIES .. "): " .. tostring(result))
		if attempt < MAX_TRIES then
			task.wait(attempt * 2)
		end
	end
	return false, lastError
end

local function keyFor(player)
	return "player_" .. player.UserId
end

function DataService.Load(player)
	local ok, saved = withRetries("Loading " .. player.Name, function()
		return store:GetAsync(keyFor(player))
	end)
	local profile = newProfile()
	if ok and type(saved) == "table" then
		for key, value in pairs(saved) do
			profile[key] = value
		end
	end
	-- If loading failed, never save over the player's real data this session.
	profile.CanSave = ok
	if not ok then
		warn("Couldn't load data for " .. player.Name .. ". Progress this session won't be saved.")
	end
	sessions[player] = profile
	return profile
end

function DataService.Get(player)
	return sessions[player]
end

-- Waits until the player's data is ready (or they leave).
function DataService.WaitForProfile(player)
	while player.Parent and not player:GetAttribute("DataLoaded") do
		task.wait(0.2)
	end
	return sessions[player]
end

function DataService.Save(player)
	local profile = sessions[player]
	if not profile or not profile.CanSave then
		return false
	end
	local data = {}
	for key, value in pairs(profile) do
		if key ~= "CanSave" then
			data[key] = value
		end
	end
	savesInFlight = savesInFlight + 1
	local ok = withRetries("Saving " .. player.Name, function()
		store:SetAsync(keyFor(player), data, { player.UserId })
	end)
	savesInFlight = savesInFlight - 1
	return ok
end

function DataService.SavesInFlight()
	return savesInFlight
end

function DataService.Release(player)
	sessions[player] = nil
end

function DataService.Set(player, key, value)
	local profile = sessions[player]
	if not profile then
		return
	end
	profile[key] = value
	local statName = STAT_NAMES[key]
	local stats = player:FindFirstChild("leaderstats")
	local stat = stats and statName and stats:FindFirstChild(statName)
	if stat then
		stat.Value = value
	end
end

-- Rebirths add 1x each; VIP multiplies the total.
function DataService.Multiplier(player)
	local profile = sessions[player]
	local multiplier = 1
	if profile then
		multiplier = multiplier + profile.Rebirths
	end
	if Config.Vip.Enabled and player:GetAttribute("VIP") then
		multiplier = multiplier * Config.Vip.Multiplier
	end
	return multiplier
end

-- Adds currency, with rebirth and VIP bonuses when boosted is true.
function DataService.AddCurrency(player, amount, boosted)
	local profile = sessions[player]
	if not profile then
		return 0
	end
	if boosted then
		amount = amount * DataService.Multiplier(player)
	end
	DataService.Set(player, "Currency", math.floor(profile.Currency + amount))
	return profile.Currency
end

function DataService.Spend(player, amount)
	local profile = sessions[player]
	if not profile or profile.Currency < amount then
		return false
	end
	DataService.Set(player, "Currency", profile.Currency - amount)
	return true
end

return DataService
`;

function mainLua(o) {
  return SERVER_HEADER + `
-- Creates leaderstats, loads data on join, and saves on leave, on shutdown and every few minutes.
local AUTOSAVE_SECONDS = 120

-- Shared objects the other scripts and the client wait for.
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
remotes.Parent = ReplicatedStorage
local status = Instance.new("StringValue")
status.Name = "Status"
status.Value = "Welcome to " .. Config.GameName
status.Parent = ReplicatedStorage

local function addStat(folder, name, value)
	local stat = Instance.new("IntValue")
	stat.Name = name
	stat.Value = value
	stat.Parent = folder
end

local function onPlayerAdded(player)
	local profile = DataService.Load(player)
	if not player.Parent then
		-- They left while their data was loading.
		DataService.Release(player)
		return
	end
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	addStat(leaderstats, Config.Currency, profile.Currency)
${o.template === "obby" ? `	addStat(leaderstats, "Stage", profile.Stage)\n` : ""}${o.template === "simulator" ? `	addStat(leaderstats, "Rebirths", profile.Rebirths)\n` : ""}	leaderstats.Parent = player
	player:SetAttribute("DataLoaded", true)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	DataService.Save(player)
	DataService.Release(player)
end)

game:BindToClose(function()
	for _, player in ipairs(Players:GetPlayers()) do
		task.spawn(DataService.Save, player)
	end
	-- Players may already have left (their PlayerRemoving save is still running),
	-- so wait for every save in flight, not just the ones started here.
	local started = os.clock()
	while DataService.SavesInFlight() > 0 and os.clock() - started < 25 do
		task.wait(0.5)
	end
end)

task.spawn(function()
	while true do
		task.wait(AUTOSAVE_SECONDS)
		for _, player in ipairs(Players:GetPlayers()) do
			task.spawn(DataService.Save, player)
		end
	end
end)
`;
}

const OBBY_LUA = SERVER_HEADER + `local Parts = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Parts"))

-- Builds the course: checkpoints, jumps between them and a kill floor under each gap.
local map = workspace:WaitForChild("ForgeMap")
local SPACING = 24
local checkpoints = Instance.new("Folder")
checkpoints.Name = "Checkpoints"
checkpoints.Parent = map

local GREEN = Color3.fromRGB(85, 200, 110)
local STONE = Color3.fromRGB(190, 190, 190)
local LAVA = Color3.fromRGB(230, 60, 40)

for stage = 1, Config.Stages do
	local base = Vector3.new((stage - 1) * SPACING, 4 + stage * 2, 40)
	local pad = Parts.make(tostring(stage), Vector3.new(8, 1, 8), base, GREEN, checkpoints)
	Parts.label(pad, "Stage " .. stage)

	pad.Touched:Connect(function(hit)
		local player, humanoid = Parts.playerFromHit(hit)
		if not player or humanoid.Health <= 0 then
			return
		end
		local profile = DataService.Get(player)
		-- Only the next stage counts, so nobody can skip ahead.
		if profile and stage == profile.Stage + 1 then
			DataService.Set(player, "Stage", stage)
			if Config.StageReward > 0 then
				DataService.AddCurrency(player, Config.StageReward, true)
			end
		end
	end)

	if stage < Config.Stages then
		for jump = 1, 2 do
			Parts.make("Jump", Vector3.new(4, 1, 4), base + Vector3.new(jump * 8, 1, 0), STONE, map)
		end
		local kill = Parts.make("KillPart", Vector3.new(20, 1, 12), base + Vector3.new(12, -4, 0), LAVA, map)
		kill.Material = Enum.Material.Neon
		kill.Touched:Connect(function(hit)
			local player, humanoid = Parts.playerFromHit(hit)
			if player and humanoid then
				humanoid.Health = 0
			end
		end)
	end
end

-- Respawn at the last checkpoint reached.
local function onCharacter(player, character)
	local profile = DataService.WaitForProfile(player)
	if not profile then
		return
	end
	character:WaitForChild("HumanoidRootPart")
	task.wait()
	local pad = checkpoints:FindFirstChild(tostring(profile.Stage)) or checkpoints:FindFirstChild("1")
	character:PivotTo(pad.CFrame + Vector3.new(0, 4, 0))
end

local function onPlayer(player)
	player.CharacterAdded:Connect(function(character)
		onCharacter(player, character)
	end)
	if player.Character then
		task.spawn(onCharacter, player, player.Character)
	end
end

Players.PlayerAdded:Connect(onPlayer)
for _, player in ipairs(Players:GetPlayers()) do
	onPlayer(player)
end
`;

const TYCOON_LUA = SERVER_HEADER + `local Debris = game:GetService("Debris")
local Parts = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Parts"))

-- One plot: a claim pad, four droppers over a collector, and a buy button for each.
local map = workspace:WaitForChild("ForgeMap")
local plot = Instance.new("Model")
plot.Name = "Tycoon"
plot.Parent = map

local ORIGIN = Vector3.new(0, 0.5, -60)
local GOLD = Color3.fromRGB(240, 190, 50)

Parts.make("Floor", Vector3.new(60, 1, 60), ORIGIN, Color3.fromRGB(120, 120, 120), plot)
local collector = Parts.make("Collector", Vector3.new(44, 1, 8), ORIGIN + Vector3.new(0, 1, 0), GOLD, plot)
collector.Material = Enum.Material.Neon
local claimPad = Parts.make("ClaimPad", Vector3.new(8, 1, 8), ORIGIN + Vector3.new(0, 1, 24), Color3.fromRGB(85, 200, 110), plot)
local claimLabel = Parts.label(claimPad, "Step here to claim this tycoon")

local owner = nil
local droppers = {}

local function setUnlocked(index, unlocked)
	local dropper = droppers[index]
	dropper.Unlocked = unlocked
	dropper.Head.Transparency = unlocked and 0 or 0.75
	dropper.Button.Transparency = unlocked and 1 or 0
	dropper.Button.CanCollide = not unlocked
	dropper.Label.Text = unlocked and "" or ("Dropper " .. index .. ": " .. Config.DropperPrices[index] .. " " .. Config.Currency)
end

for index = 1, #Config.DropperPrices do
	local x = -15 + (index - 1) * 10
	local dropper = {
		Head = Parts.make("Dropper" .. index, Vector3.new(4, 4, 4), ORIGIN + Vector3.new(x, 14, 0), Color3.fromRGB(70, 70, 80), plot),
		Button = Parts.make("Buy" .. index, Vector3.new(5, 1, 5), ORIGIN + Vector3.new(x, 1, 12), Color3.fromRGB(60, 160, 230), plot),
		Unlocked = false,
	}
	dropper.Label = Parts.label(dropper.Button, "")
	droppers[index] = dropper
	setUnlocked(index, false)

	dropper.Button.Touched:Connect(function(hit)
		local player = Parts.playerFromHit(hit)
		if not player or player ~= owner or dropper.Unlocked then
			return
		end
		if DataService.Spend(player, Config.DropperPrices[index]) then
			DataService.Get(player).Unlocked[tostring(index)] = true
			setUnlocked(index, true)
		end
	end)
end

claimPad.Touched:Connect(function(hit)
	if owner then
		return
	end
	local player = Parts.playerFromHit(hit)
	local profile = player and DataService.Get(player)
	if not profile then
		return
	end
	owner = player
	claimLabel.Text = player.DisplayName .. "'s tycoon"
	for index = 1, #droppers do
		setUnlocked(index, index == 1 or profile.Unlocked[tostring(index)] == true)
	end
end)

Players.PlayerRemoving:Connect(function(player)
	if player ~= owner then
		return
	end
	owner = nil
	claimLabel.Text = "Step here to claim this tycoon"
	for index = 1, #droppers do
		setUnlocked(index, false)
	end
end)

collector.Touched:Connect(function(hit)
	local value = hit:GetAttribute("DropValue")
	if not value or hit:GetAttribute("Collected") then
		return
	end
	hit:SetAttribute("Collected", true)
	hit:Destroy()
	if owner then
		DataService.AddCurrency(owner, value, true)
	end
end)

task.spawn(function()
	while true do
		task.wait(Config.DropInterval)
		if owner then
			for _, dropper in ipairs(droppers) do
				if dropper.Unlocked then
					local drop = Instance.new("Part")
					drop.Name = "Drop"
					drop.Size = Vector3.new(1, 1, 1)
					drop.Color = GOLD
					drop.Position = dropper.Head.Position - Vector3.new(0, 3, 0)
					drop:SetAttribute("DropValue", Config.DropValue)
					drop.Parent = plot
					Debris:AddItem(drop, 15)
				end
			end
		end
	end
end)
`;

const SIM_SERVER_LUA = SERVER_HEADER + `
-- Clicks arrive through a RemoteEvent. The server keeps its own cooldown, so a
-- player who fires the event faster than allowed just gets nothing extra.
local remotes = ReplicatedStorage:WaitForChild("Remotes")

local click = Instance.new("RemoteEvent")
click.Name = "Click"
click.Parent = remotes

local rebirth = Instance.new("RemoteFunction")
rebirth.Name = "Rebirth"
rebirth.Parent = remotes

local lastClick = {}

click.OnServerEvent:Connect(function(player)
	local now = os.clock()
	local last = lastClick[player]
	if last and now - last < Config.ClickCooldown then
		return
	end
	lastClick[player] = now
	DataService.AddCurrency(player, Config.ClickReward, true)
end)

rebirth.OnServerInvoke = function(player)
	local profile = DataService.Get(player)
	if not profile then
		return false, "Your data is still loading. Try again in a moment."
	end
	local cost = Config.RebirthCost * (profile.Rebirths + 1)
	if profile.Currency < cost then
		return false, "You need " .. cost .. " " .. Config.Currency .. " to rebirth."
	end
	DataService.Set(player, "Currency", 0)
	DataService.Set(player, "Rebirths", profile.Rebirths + 1)
	return true, "Rebirthed! You now earn " .. DataService.Multiplier(player) .. "x."
end

Players.PlayerRemoving:Connect(function(player)
	lastClick[player] = nil
end)
`;

const MINIGAME_LUA = SERVER_HEADER + `local Parts = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Parts"))

-- Lobby, countdown, then a round on an arena whose tiles fall one by one.
-- Everyone still standing when the time runs out (or the last one left) wins.
local map = workspace:WaitForChild("ForgeMap")
local status = ReplicatedStorage:WaitForChild("Status")

local LOBBY = Vector3.new(0, 1, 80)
local ARENA = Vector3.new(0, 100, 0)
local TILE_COLOR = Color3.fromRGB(110, 170, 235)
local DANGER = Color3.fromRGB(230, 60, 40)

local lobby = Parts.make("Lobby", Vector3.new(40, 1, 40), LOBBY, Color3.fromRGB(85, 200, 110), map, "SpawnLocation")
lobby.Neutral = true
local killFloor = Parts.make("KillFloor", Vector3.new(200, 1, 200), ARENA - Vector3.new(0, 30, 0), DANGER, map)
killFloor.Material = Enum.Material.Neon
killFloor.Touched:Connect(function(hit)
	local player, humanoid = Parts.playerFromHit(hit)
	if player and humanoid then
		humanoid.Health = 0
	end
end)

local arena = nil
local function buildArena()
	if arena then
		arena:Destroy()
	end
	arena = Instance.new("Folder")
	arena.Name = "Arena"
	arena.Parent = map
	local tiles = {}
	for x = 1, 8 do
		for z = 1, 8 do
			local position = ARENA + Vector3.new((x - 4.5) * 6, 0, (z - 4.5) * 6)
			table.insert(tiles, Parts.make("Tile", Vector3.new(6, 1, 6), position, TILE_COLOR, arena))
		end
	end
	return tiles
end

local function teleport(character, position)
	character:PivotTo(CFrame.new(position + Vector3.new(0, 4, 0)))
end

local alive = {}
local aliveCount = 0
local function eliminate(player)
	if alive[player] then
		alive[player] = nil
		aliveCount = aliveCount - 1
	end
end
Players.PlayerRemoving:Connect(eliminate)

while true do
	while #Players:GetPlayers() < Config.MinPlayers do
		status.Value = "Waiting for " .. Config.MinPlayers .. " players"
		task.wait(1)
	end
	for seconds = Config.IntermissionSeconds, 1, -1 do
		status.Value = "Next round in " .. seconds
		task.wait(1)
	end

	local tiles = buildArena()
	local connections = {}
	alive = {}
	aliveCount = 0
	for _, player in ipairs(Players:GetPlayers()) do
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		if humanoid and humanoid.Health > 0 then
			alive[player] = true
			aliveCount = aliveCount + 1
			teleport(character, ARENA + Vector3.new(math.random(-18, 18), 0, math.random(-18, 18)))
			table.insert(connections, humanoid.Died:Connect(function()
				eliminate(player)
			end))
		end
	end
	local startCount = aliveCount

	local started = os.clock()
	while os.clock() - started < Config.RoundSeconds do
		if aliveCount == 0 or (startCount > 1 and aliveCount <= 1) then
			break
		end
		local left = math.ceil(Config.RoundSeconds - (os.clock() - started))
		status.Value = aliveCount .. " left, " .. left .. "s to go"
		if #tiles > 0 then
			local tile = table.remove(tiles, math.random(1, #tiles))
			tile.Color = DANGER
			task.delay(1, function()
				tile:Destroy()
			end)
		end
		task.wait(1)
	end

	local names = {}
	for player in pairs(alive) do
		DataService.AddCurrency(player, Config.WinReward, true)
		table.insert(names, player.DisplayName)
		if player.Character then
			teleport(player.Character, LOBBY)
		end
	end
	for _, connection in ipairs(connections) do
		connection:Disconnect()
	end
	alive = {}
	aliveCount = 0
	if #names > 0 then
		status.Value = "Winners: " .. table.concat(names, ", ")
	else
		status.Value = "No winners this round"
	end
	task.wait(5)
end
`;

const DAILY_LUA = SERVER_HEADER + `
-- Pays the daily reward once every 24 hours. The time of the last claim is saved.
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local claim = Instance.new("RemoteFunction")
claim.Name = "ClaimDaily"
claim.Parent = remotes

claim.OnServerInvoke = function(player)
	local profile = DataService.Get(player)
	if not profile then
		return false, "Your data is still loading. Try again in a moment."
	end
	local now = os.time()
	local waitLeft = Config.DailyReward.Cooldown - (now - profile.LastDaily)
	if waitLeft > 0 then
		local hours = math.ceil(waitLeft / 3600)
		return false, "Come back in " .. hours .. (hours == 1 and " hour." or " hours.")
	end
	profile.LastDaily = now
	DataService.AddCurrency(player, Config.DailyReward.Amount, false)
	task.spawn(DataService.Save, player)
	return true, "You got " .. Config.DailyReward.Amount .. " " .. Config.Currency .. "!"
end
`;

const BOARD_LUA = SERVER_HEADER + `local DataStoreService = game:GetService("DataStoreService")

-- Shows the top ten players from every server on the Leaderboard part.
-- Move the board by changing its CFrame in default.project.json.
local REFRESH_SECONDS = 60
local topStore = DataStoreService:GetOrderedDataStore(Config.DataStoreName .. "_Top")
local board = workspace:WaitForChild("Leaderboard")
board.Color = Color3.fromRGB(40, 40, 46)
board.Material = Enum.Material.SmoothPlastic
local lastSent = {}

local gui = Instance.new("SurfaceGui")
gui.Face = Enum.NormalId.Front
gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
gui.PixelsPerStud = 40
gui.Parent = board

local list = Instance.new("Frame")
list.Size = UDim2.new(1, 0, 1, 0)
list.BackgroundColor3 = Color3.fromRGB(40, 40, 46)
list.Parent = gui
local layout = Instance.new("UIListLayout")
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = list

local function addLine(text, order, bold)
	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 0.09, 0)
	label.BackgroundTransparency = 1
	label.TextScaled = true
	label.TextColor3 = Color3.new(1, 1, 1)
	label.Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham
	label.Text = text
	label.LayoutOrder = order
	label.Parent = list
end

local function refresh()
	for _, player in ipairs(Players:GetPlayers()) do
		local profile = DataService.Get(player)
		-- Skip players whose data didn't load, so a fresh profile never replaces a real score.
		local amount = profile and profile.CanSave and math.floor(profile.Currency)
		if amount and lastSent[player] ~= amount then
			local ok, err = pcall(function()
				topStore:SetAsync("player_" .. player.UserId, amount)
			end)
			if ok then
				lastSent[player] = amount
			else
				warn("Leaderboard save failed: " .. tostring(err))
			end
		end
	end
	local ok, pages = pcall(function()
		return topStore:GetSortedAsync(false, 10)
	end)
	if not ok then
		warn("Leaderboard load failed: " .. tostring(pages))
		return
	end
	for _, child in ipairs(list:GetChildren()) do
		if child:IsA("TextLabel") then
			child:Destroy()
		end
	end
	addLine("Top " .. Config.Currency, 0, true)
	for rank, entry in ipairs(pages:GetCurrentPage()) do
		local userId = tonumber(string.match(entry.key, "%d+"))
		local name = "Player " .. tostring(userId)
		local nameOk, found = pcall(function()
			return Players:GetNameFromUserIdAsync(userId)
		end)
		if nameOk and found then
			name = found
		end
		addLine(rank .. ". " .. name .. ": " .. entry.value, rank, false)
	end
end

Players.PlayerRemoving:Connect(function(player)
	lastSent[player] = nil
end)

while true do
	refresh()
	task.wait(REFRESH_SECONDS)
end
`;

const VIP_LUA = HEADER + `local MarketplaceService = game:GetService("MarketplaceService")

-- Marks game pass owners with a VIP attribute; DataService multiplies their earnings.
local function checkPass(player)
	for attempt = 1, 3 do
		local ok, owns = pcall(function()
			return MarketplaceService:UserOwnsGamePassAsync(player.UserId, Config.Vip.GamePassId)
		end)
		if ok then
			player:SetAttribute("VIP", owns == true)
			return
		end
		warn("Game pass check failed for " .. player.Name .. ": " .. tostring(owns))
		task.wait(attempt * 2)
	end
end

Players.PlayerAdded:Connect(checkPass)
for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(checkPass, player)
end

MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
	if purchased and passId == Config.Vip.GamePassId then
		player:SetAttribute("VIP", true)
	end
end)
`;

const HUD_LUA = HEADER + `local MarketplaceService = game:GetService("MarketplaceService")

-- Status line at the top, plus buttons for the extras you picked.
local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local status = ReplicatedStorage:WaitForChild("Status")

local gui = Instance.new("ScreenGui")
gui.Name = "ForgeHud"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local statusLabel = Instance.new("TextLabel")
statusLabel.Size = UDim2.new(0, 360, 0, 36)
statusLabel.Position = UDim2.new(0.5, -180, 0, 8)
statusLabel.BackgroundColor3 = Color3.fromRGB(30, 30, 36)
statusLabel.BackgroundTransparency = 0.3
statusLabel.TextColor3 = Color3.new(1, 1, 1)
statusLabel.TextScaled = true
statusLabel.Font = Enum.Font.GothamBold
statusLabel.Text = status.Value
statusLabel.Parent = gui
status.Changed:Connect(function()
	statusLabel.Text = status.Value
end)

local buttons = 0
local function addButton(text, onClick)
	buttons = buttons + 1
	local button = Instance.new("TextButton")
	button.Size = UDim2.new(0, 160, 0, 40)
	button.Position = UDim2.new(0, 12, 0.5, (buttons - 1) * 48)
	button.BackgroundColor3 = Color3.fromRGB(60, 160, 90)
	button.TextColor3 = Color3.new(1, 1, 1)
	button.TextScaled = true
	button.Font = Enum.Font.GothamBold
	button.Text = text
	button.Parent = gui
	button.Activated:Connect(onClick)
	return button
end

local function flash(message)
	statusLabel.Text = message
	task.delay(4, function()
		statusLabel.Text = status.Value
	end)
end

if Config.DailyReward.Enabled then
	local claim = remotes:WaitForChild("ClaimDaily")
	addButton("Daily reward", function()
		local ok, success, message = pcall(function()
			return claim:InvokeServer()
		end)
		if ok then
			flash(message)
		else
			flash("Couldn't reach the server. Try again.")
		end
	end)
end

if Config.Vip.Enabled then
	addButton("Get VIP", function()
		MarketplaceService:PromptGamePassPurchase(player, Config.Vip.GamePassId)
	end)
end
`;

const CLICKER_LUA = HEADER + `
-- Simulator buttons. The server decides what each click is worth.
local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local click = remotes:WaitForChild("Click")
local rebirth = remotes:WaitForChild("Rebirth")

local gui = Instance.new("ScreenGui")
gui.Name = "Clicker"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local clickButton = Instance.new("TextButton")
clickButton.Size = UDim2.new(0, 200, 0, 70)
clickButton.Position = UDim2.new(0.5, -100, 1, -170)
clickButton.BackgroundColor3 = Color3.fromRGB(240, 190, 50)
clickButton.TextScaled = true
clickButton.Font = Enum.Font.GothamBold
clickButton.Text = "Click for " .. Config.Currency
clickButton.Parent = gui
clickButton.Activated:Connect(function()
	click:FireServer()
end)

local rebirthButton = Instance.new("TextButton")
rebirthButton.Size = UDim2.new(0, 200, 0, 44)
rebirthButton.Position = UDim2.new(0.5, -100, 1, -90)
rebirthButton.BackgroundColor3 = Color3.fromRGB(150, 90, 220)
rebirthButton.TextColor3 = Color3.new(1, 1, 1)
rebirthButton.TextScaled = true
rebirthButton.Font = Enum.Font.GothamBold
rebirthButton.Text = "Rebirth"
rebirthButton.Parent = gui
rebirthButton.Activated:Connect(function()
	local ok, success, message = pcall(function()
		return rebirth:InvokeServer()
	end)
	rebirthButton.Text = ok and message or "Try again"
	task.delay(3, function()
		rebirthButton.Text = "Rebirth"
	end)
end)
`;

function projectJson(o) {
  const workspace = { $className: "Workspace", ForgeMap: { $className: "Folder" } };
  // The board's front face points back at the spawn point. CFrame has no short
  // form in Rojo, so it uses the explicit { "CFrame": ... } value.
  if (o.extras.leaderboard) workspace.Leaderboard = {
    $className: "Part",
    $properties: {
      Anchored: true,
      Size: [14, 9, 1],
      CFrame: { CFrame: { position: [-24, 7, 20], orientation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } },
    },
  };
  return JSON.stringify({
    name: slug(o.name),
    tree: {
      $className: "DataModel",
      ReplicatedStorage: { $className: "ReplicatedStorage", Shared: { $path: "src/shared" } },
      ServerScriptService: { $className: "ServerScriptService", Server: { $path: "src/server" } },
      StarterPlayer: { $className: "StarterPlayer", StarterPlayerScripts: { $className: "StarterPlayerScripts", Client: { $path: "src/client" } } },
      Workspace: workspace,
    },
  }, null, 2) + "\n";
}

function readme(o) {
  const t = TEMPLATES[o.template];
  const extras = Object.keys(EXTRAS).filter(k => o.extras[k]).map(k => `- ${EXTRAS[k].label}: ${EXTRAS[k].text}`);
  return `# ${o.name}

A ${t.label.toLowerCase()} game made with Roblox Forge on ForgeCenter. ${t.text}

Currency: **${o.currency}**. Every setting lives in \`src/shared/Config.lua\`.
${extras.length ? `\nExtras:\n${extras.join("\n")}\n` : ""}
## Open it in Roblox Studio

1. Install Rojo (https://rojo.space), the tool that syncs these files into Studio.
   - With Rokit or Aftman: run \`rokit install\` or \`aftman install\` in this folder.
     Both read \`aftman.toml\`, which asks for Rojo ${ROJO_VERSION}.
   - Without them: download Rojo from https://github.com/rojo-rbx/rojo/releases.
   - Then install the Rojo plugin for Studio: run \`rojo plugin install\`, or get it
     from the Roblox Creator Store.
2. In this folder, run \`rojo serve\`.
3. Open Roblox Studio, start a Baseplate, open the Rojo plugin and press **Connect**.
   The scripts and the map folder appear in Studio.
4. Turn on saving: in Studio go to **Game Settings > Security** and switch on
   **Enable Studio Access to API Services**. Without it, data won't save while you test.
   (You need to publish the place once first, see step 6.)
5. Press **Play** to test.
6. When you're happy, use **File > Publish to Roblox**. Players' progress saves in the
   published game automatically.

## Files

- \`src/server/Main.server.lua\` leaderstats, loading and saving (with retries, a session cache, PlayerRemoving and BindToClose saves)
- \`src/server/DataService.lua\` the DataStore code every other script uses
- \`src/server/${MAIN_SCRIPT[o.template]}.server.lua\` the game itself
- \`src/client/\` the on-screen buttons and status line
- \`src/shared/Config.lua\` names and numbers you can change
- \`default.project.json\` tells Rojo where each folder goes in Studio${o.extras.leaderboard ? " (and where the leaderboard board stands)" : ""}
${o.template === "tycoon" ? "\nThe tycoon has one plot, so one player owns it at a time. Copy the plot code in `Tycoon.server.lua` to add more.\n" : ""}${o.extras.vip ? `\nThe VIP perk checks game pass ${o.gamePassId}. Make sure that game pass belongs to this game.\n` : ""}`;
}

const ROJO_VERSION = "7.4.4";
const AFTMAN_TOML = `# Tools for this project. Run \`rokit install\` or \`aftman install\` to get them.
[tools]
rojo = "rojo-rbx/rojo@${ROJO_VERSION}"
`;

export function robloxFiles(input) {
  const o = validate(input);
  const files = {
    "default.project.json": projectJson(o),
    "README.md": readme(o),
    "aftman.toml": AFTMAN_TOML,
    "src/shared/Config.lua": configLua(o),
    "src/shared/Parts.lua": PARTS_LUA,
    "src/server/DataService.lua": DATA_LUA,
    "src/server/Main.server.lua": mainLua(o),
    "src/client/Hud.client.lua": HUD_LUA,
  };
  if (o.template === "obby") files["src/server/Obby.server.lua"] = OBBY_LUA;
  if (o.template === "tycoon") files["src/server/Tycoon.server.lua"] = TYCOON_LUA;
  if (o.template === "simulator") {
    files["src/server/Simulator.server.lua"] = SIM_SERVER_LUA;
    files["src/client/Clicker.client.lua"] = CLICKER_LUA;
  }
  if (o.template === "minigame") files["src/server/Minigame.server.lua"] = MINIGAME_LUA;
  if (o.extras.daily) files["src/server/DailyReward.server.lua"] = DAILY_LUA;
  if (o.extras.leaderboard) files["src/server/Leaderboard.server.lua"] = BOARD_LUA;
  if (o.extras.vip) files["src/server/VipPerk.server.lua"] = VIP_LUA;
  return { files, options: o };
}

// The preview pane gets the whole file list but only a few files' text: the
// game's own script, its settings and the project file, plus the one the visitor
// opened. Paths come from the generated map, never from the request.
const MAIN_SCRIPT = { obby: "Obby", tycoon: "Tycoon", simulator: "Simulator", minigame: "Minigame" };
export function robloxPreview(input, open) {
  const { files, options } = robloxFiles(input);
  const main = `src/server/${MAIN_SCRIPT[options.template]}.server.lua`;
  const shown = [main, "src/shared/Config.lua", "default.project.json"];
  if (typeof open === "string" && Object.hasOwn(files, open) && !shown.includes(open)) shown.push(open);
  const text = Object.fromEntries(shown.map(path => [path, files[path]]));
  const list = Object.keys(files).sort().map(path => ({ path, lines: files[path].split("\n").length - 1, bytes: Buffer.byteLength(files[path]) }));
  return { files: list, text, main, slug: slug(options.name) };
}

export const robloxOptions = () => ({
  templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, ...t })),
  extras: Object.entries(EXTRAS).map(([id, e]) => ({ id, ...e })),
  numbers: Object.entries(NUMBERS).map(([id, n]) => ({ id, label: n.label, min: n.min, max: n.max, default: n.def, integer: n.int, for: n.for })),
  limits: LIMITS,
});
