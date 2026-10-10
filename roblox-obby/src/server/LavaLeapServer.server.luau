--!strict
-- Lava Leap: an obby built from code. This Script builds the whole course when the
-- game starts, then runs checkpoints, hazards, saving, and the finish line.
-- Put it in ServerScriptService. The matching LocalScript (LavaLeapClient) goes in
-- StarterPlayer > StarterPlayerScripts.

local CollectionService = game:GetService("CollectionService")
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

-- Tags and names shared with the client script.
local JUMP_PAD_TAG = "LavaLeapJumpPad"
local CHECKPOINT_TAG = "LavaLeapCheckpoint"
local REMOTE_NAME = "LavaLeapEvents"

local START = Vector3.new(-260, 40, 0) -- near edge of the first checkpoint, 40 studs above the lava
local PAD_SIZE = Vector3.new(12, 1, 12)
local SAVE_KEY_PREFIX = "player_"

local KILL_COLOR = Color3.fromRGB(255, 40, 40)
local LAVA_COLOR = Color3.fromRGB(255, 96, 0)
local CHECKPOINT_COLOR = Color3.fromRGB(200, 205, 215)
local FINISH_COLOR = Color3.fromRGB(255, 205, 50)
local VANISH_COLOR = Color3.fromRGB(255, 236, 110)
local MOVER_COLOR = Color3.fromRGB(70, 140, 255)
local PAD_COLOR = Color3.fromRGB(60, 255, 120)
local SIGN_COLOR = Color3.fromRGB(255, 255, 255)

--------------------------------------------------------------------------------
-- Building blocks
--------------------------------------------------------------------------------

local function block(parent: Instance, size: Vector3, cframe: CFrame, color: Color3, material: Enum.Material?): Part
	local part = Instance.new("Part")
	part.Anchored = true
	part.Size = size
	part.CFrame = cframe
	part.Color = color
	part.Material = material or Enum.Material.SmoothPlastic
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = parent
	return part
end

-- A platform whose top surface is centred on `top`.
local function platform(parent: Instance, size: Vector3, top: Vector3, color: Color3, material: Enum.Material?): Part
	return block(parent, size, CFrame.new(top - Vector3.new(0, size.Y / 2, 0)), color, material)
end

-- An invisible, non-colliding anchor for constraints.
local function anchorAt(parent: Instance, position: Vector3): Part
	local anchor = block(parent, Vector3.one, CFrame.new(position), Color3.new(), nil)
	anchor.Transparency = 1
	anchor.CanCollide = false
	anchor.CanTouch = false
	anchor.CanQuery = false
	return anchor
end

local function characterFromHit(hit: BasePart): Model?
	local model = hit:FindFirstAncestorOfClass("Model")
	if model and model:FindFirstChildOfClass("Humanoid") then
		return model
	end
	return nil
end

local function aliveHumanoid(character: Model): Humanoid?
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if humanoid and humanoid.Health > 0 then
		return humanoid
	end
	return nil
end

local function makeDeadly(part: BasePart)
	part.Touched:Connect(function(hit)
		local character = characterFromHit(hit)
		local humanoid = character and aliveHumanoid(character)
		if humanoid then
			humanoid.Health = 0
		end
	end)
end

-- A glowing red kill brick.
local function makeHazard(part: BasePart)
	part.Color = KILL_COLOR
	part.Material = Enum.Material.Neon
	makeDeadly(part)
end

-- Fades out shortly after someone steps on it, then comes back.
local function makeVanishing(part: BasePart)
	local busy = false
	part.Touched:Connect(function(hit)
		if busy or not characterFromHit(hit) then
			return
		end
		busy = true
		local fade = TweenService:Create(part, TweenInfo.new(0.7), { Transparency = 0.8 })
		fade:Play()
		fade.Completed:Wait()
		part.CanCollide = false
		part.Transparency = 1
		task.wait(2.5)
		part.CanCollide = true
		part.Transparency = 0
		busy = false
	end)
end

-- Physics parts are simulated by the server so everyone sees them in the same place.
local function serverOwned(part: BasePart)
	pcall(function()
		part:SetNetworkOwner(nil)
	end)
end

-- A platform that slides back and forth along `axis`. It is physics-driven (not
-- tweened) so players standing on it get carried along.
local function makeMover(parent: Instance, size: Vector3, top: Vector3, axis: Vector3, distance: number, speed: number, startDirection: number): Part
	local center = top - Vector3.new(0, size.Y / 2, 0)
	local anchor = anchorAt(parent, center)
	local mover = block(parent, size, CFrame.new(center), MOVER_COLOR, Enum.Material.SmoothPlastic)
	mover.Anchored = false

	-- A PrismaticConstraint slides along its attachments' X axis.
	local orientation = CFrame.fromMatrix(Vector3.zero, axis, Vector3.yAxis)
	local attachment0 = Instance.new("Attachment")
	attachment0.CFrame = orientation
	attachment0.Parent = anchor
	local attachment1 = Instance.new("Attachment")
	attachment1.CFrame = orientation
	attachment1.Parent = mover

	local slider = Instance.new("PrismaticConstraint")
	slider.Attachment0 = attachment0
	slider.Attachment1 = attachment1
	slider.ActuatorType = Enum.ActuatorType.Servo
	slider.Speed = speed
	slider.ServoMaxForce = 1e7
	slider.Parent = mover
	serverOwned(mover)

	task.spawn(function()
		local direction = startDirection
		slider.TargetPosition = distance * direction
		task.wait(distance / speed + 0.6)
		while mover.Parent do
			direction = -direction
			slider.TargetPosition = distance * direction
			task.wait(2 * distance / speed + 0.6)
		end
	end)
	return mover
end

-- A deadly bar that sweeps around a vertical axis.
local function makeSweeper(parent: Instance, center: Vector3, length: number, angularSpeed: number): Part
	local anchor = anchorAt(parent, center)
	local bar = block(parent, Vector3.new(length, 1, 1), CFrame.new(center), KILL_COLOR, Enum.Material.Neon)
	bar.Anchored = false
	bar.CanCollide = false
	makeHazard(bar)

	-- A HingeConstraint spins around its attachments' X axis; point it up.
	local upright = CFrame.Angles(0, 0, math.rad(90))
	local attachment0 = Instance.new("Attachment")
	attachment0.CFrame = upright
	attachment0.Parent = anchor
	local attachment1 = Instance.new("Attachment")
	attachment1.CFrame = upright
	attachment1.Parent = bar

	local hinge = Instance.new("HingeConstraint")
	hinge.Attachment0 = attachment0
	hinge.Attachment1 = attachment1
	hinge.ActuatorType = Enum.ActuatorType.Motor
	hinge.AngularVelocity = angularSpeed
	hinge.MotorMaxTorque = 1e8
	hinge.Parent = bar
	serverOwned(bar)
	return bar
end

local function addSign(part: BasePart, text: string, height: number)
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromScale(14, 2.5)
	gui.StudsOffset = Vector3.new(0, height, 0)
	gui.MaxDistance = 150
	gui.LightInfluence = 0

	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Text = text
	label.TextScaled = true
	label.Font = Enum.Font.FredokaOne
	label.TextColor3 = SIGN_COLOR
	label.TextStrokeTransparency = 0.3
	label.Parent = gui

	gui.Parent = part
end

--------------------------------------------------------------------------------
-- Stages
-- Each stage starts at `start` (the top surface at the far edge of its checkpoint)
-- and returns where the next checkpoint's near edge should go.
--------------------------------------------------------------------------------

type Stage = {
	name: string,
	color: Color3,
	build: (folder: Folder, start: Vector3, color: Color3) -> Vector3,
}

local STAGES: { Stage } = {
	{
		name = "Stepping Stones",
		color = Color3.fromRGB(90, 200, 250),
		build = function(folder, start, color)
			local x = start.X
			for i = 1, 6 do
				x += 3
				platform(folder, Vector3.new(4, 1, 4), Vector3.new(x + 2, start.Y, start.Z + math.sin(i * 1.3) * 3), color)
				x += 4
			end
			return Vector3.new(x + 3, start.Y, start.Z)
		end,
	},
	{
		name = "Lava Stripes",
		color = Color3.fromRGB(240, 240, 245),
		build = function(folder, start, color)
			local length = 34
			platform(folder, Vector3.new(length, 1, 8), Vector3.new(start.X + length / 2, start.Y, start.Z), color)
			-- Stripes get wider as you go.
			for i, width in { 2, 2.5, 3, 3.5, 4 } do
				local stripe = platform(
					folder,
					Vector3.new(width, 0.3, 8),
					Vector3.new(start.X + 5 + (i - 1) * 6, start.Y + 0.3, start.Z),
					KILL_COLOR
				)
				makeHazard(stripe)
			end
			return Vector3.new(start.X + length, start.Y, start.Z)
		end,
	},
	{
		name = "Staircase",
		color = Color3.fromRGB(160, 120, 255),
		build = function(folder, start, color)
			local x, y = start.X, start.Y
			for i = 1, 7 do
				x += 3
				y += 3
				local side = if i % 2 == 0 then 3 else -3
				platform(folder, Vector3.new(4, 1, 6), Vector3.new(x + 2, y, start.Z + side), color)
				x += 4
			end
			return Vector3.new(x + 3, y, start.Z)
		end,
	},
	{
		name = "Truss Climb",
		color = Color3.fromRGB(90, 220, 140),
		build = function(folder, start, color)
			local height = 24
			platform(folder, Vector3.new(8, 1, 8), Vector3.new(start.X + 4, start.Y, start.Z), color)

			local truss = Instance.new("TrussPart")
			truss.Anchored = true
			truss.Size = Vector3.new(2, height, 2)
			truss.CFrame = CFrame.new(start.X + 9, start.Y - 1 + height / 2, start.Z)
			truss.Color = color
			truss.Parent = folder

			local topY = start.Y - 1 + height
			platform(folder, Vector3.new(10, 1, 8), Vector3.new(start.X + 15, topY, start.Z), color)
			return Vector3.new(start.X + 23, topY, start.Z)
		end,
	},
	{
		name = "Balance Beams",
		color = Color3.fromRGB(255, 190, 60),
		build = function(folder, start, color)
			local nodes = {
				start,
				start + Vector3.new(10, 0, 6),
				start + Vector3.new(20, 0, -6),
				start + Vector3.new(30, 0, 6),
				start + Vector3.new(40, 0, 0),
			}
			for i = 1, #nodes - 1 do
				local a, b = nodes[i], nodes[i + 1]
				local beam = block(folder, Vector3.new(1.5, 1, (b - a).Magnitude), CFrame.lookAt((a + b) / 2, b), color)
				beam.CFrame -= Vector3.new(0, 0.5, 0)
				if i > 1 then
					platform(folder, Vector3.new(3, 1, 3), a, color)
				end
			end
			return nodes[#nodes]
		end,
	},
	{
		name = "Vanishing Tiles",
		color = VANISH_COLOR,
		build = function(folder, start, color)
			local x = start.X
			for _ = 1, 7 do
				x += 3
				makeVanishing(platform(folder, Vector3.new(5, 1, 5), Vector3.new(x + 2.5, start.Y, start.Z), color, Enum.Material.Neon))
				x += 5
			end
			return Vector3.new(x + 3, start.Y, start.Z)
		end,
	},
	{
		name = "Moving Platforms",
		color = MOVER_COLOR,
		build = function(folder, start, _color)
			-- Neighbours slide in opposite directions and line up in the middle.
			local x = start.X
			for i = 1, 4 do
				x += 4
				makeMover(folder, Vector3.new(6, 1, 6), Vector3.new(x + 3, start.Y, start.Z), Vector3.zAxis, 8, 6, if i % 2 == 0 then -1 else 1)
				x += 6
			end
			return Vector3.new(x + 4, start.Y, start.Z)
		end,
	},
	{
		name = "Conveyor Hurdles",
		color = Color3.fromRGB(70, 75, 90),
		build = function(folder, start, color)
			local length = 40
			local belt = platform(folder, Vector3.new(length, 1, 8), Vector3.new(start.X + length / 2, start.Y, start.Z), color, Enum.Material.DiamondPlate)
			-- An anchored part with a velocity acts like a conveyor belt: this one pushes you back.
			belt.AssemblyLinearVelocity = Vector3.new(-10, 0, 0)
			for i = 1, 4 do
				local hurdle = platform(folder, Vector3.new(1, 1.2, 8), Vector3.new(start.X + i * 8, start.Y + 1.2, start.Z), KILL_COLOR)
				makeHazard(hurdle)
			end
			return Vector3.new(start.X + length, start.Y, start.Z)
		end,
	},
	{
		name = "Jump Pads",
		color = Color3.fromRGB(255, 150, 220),
		build = function(folder, start, color)
			-- Floor, then two 10-stud steps. Each pad sits against the next step's wall.
			local rise = 10
			platform(folder, Vector3.new(10, 1, 10), Vector3.new(start.X + 5, start.Y, start.Z), color)
			for tier = 0, 1 do
				local floorY = start.Y + tier * rise
				local floorX = start.X + tier * 10
				local pad = platform(folder, Vector3.new(4, 0.4, 6), Vector3.new(floorX + 8, floorY + 0.4, start.Z), PAD_COLOR, Enum.Material.Neon)
				pad:SetAttribute("Launch", 85)
				CollectionService:AddTag(pad, JUMP_PAD_TAG)
				platform(folder, Vector3.new(10, rise + 1, 10), Vector3.new(floorX + 15, floorY + rise, start.Z), color)
			end
			return Vector3.new(start.X + 33, start.Y + 2 * rise, start.Z)
		end,
	},
	{
		name = "The Sweeper",
		color = Color3.fromRGB(120, 230, 230),
		build = function(folder, start, color)
			local radius = 13
			local center = Vector3.new(start.X + 3 + radius, start.Y, start.Z)
			-- Cylinders run along their X axis, so tip it upright to make a round floor.
			local floor = block(folder, Vector3.new(1, radius * 2, radius * 2), CFrame.new(center - Vector3.new(0, 0.5, 0)) * CFrame.Angles(0, 0, math.rad(90)), color)
			floor.Shape = Enum.PartType.Cylinder
			block(folder, Vector3.new(2, 6, 2), CFrame.new(center + Vector3.new(0, 3, 0)), Color3.fromRGB(40, 45, 60))
			makeSweeper(folder, center + Vector3.new(0, 1.5, 0), radius * 2 - 1, 1.6)
			return Vector3.new(center.X + radius + 3, start.Y, start.Z)
		end,
	},
}

--------------------------------------------------------------------------------
-- Build the course
--------------------------------------------------------------------------------

-- The course replaces the template's baseplate and spawn (you'd land on them instead of lava).
for _, child in workspace:GetChildren() do
	if child:IsA("SpawnLocation") or (child:IsA("BasePart") and child.Name == "Baseplate") then
		child:Destroy()
	end
end

local world = Instance.new("Folder")
world.Name = "LavaLeap"
world.Parent = workspace -- must be in the workspace before physics parts are built

local lava = block(world, Vector3.new(2048, 4, 600), CFrame.new(0, -2, 0), LAVA_COLOR, Enum.Material.CrackedLava)
lava.Name = "Lava"
makeDeadly(lava)

local checkpoints: { BasePart } = {}
local cursor = START

for index, stage in STAGES do
	local folder = Instance.new("Folder")
	folder.Name = string.format("%02d %s", index, stage.name)
	folder.Parent = world

	local top = Vector3.new(cursor.X + PAD_SIZE.X / 2, cursor.Y, cursor.Z)
	local pad: BasePart
	if index == 1 then
		local spawnPad = Instance.new("SpawnLocation")
		spawnPad.Duration = 0 -- no force-field bubble
		spawnPad.Neutral = true
		pad = spawnPad
	else
		pad = Instance.new("Part")
	end
	pad.Name = "Checkpoint"
	pad.Anchored = true
	pad.Size = PAD_SIZE
	pad.CFrame = CFrame.new(top - Vector3.new(0, PAD_SIZE.Y / 2, 0))
	pad.Color = CHECKPOINT_COLOR
	pad.Material = Enum.Material.SmoothPlastic
	pad.TopSurface = Enum.SurfaceType.Smooth
	pad:SetAttribute("Stage", index)
	CollectionService:AddTag(pad, CHECKPOINT_TAG)
	addSign(pad, string.format("%d · %s", index, stage.name), 5)
	pad.Parent = folder
	checkpoints[index] = pad

	cursor = stage.build(folder, Vector3.new(cursor.X + PAD_SIZE.X, cursor.Y, cursor.Z), stage.color)
end

local finishPad = platform(world, Vector3.new(16, 1, 16), Vector3.new(cursor.X + 8, cursor.Y, cursor.Z), FINISH_COLOR, Enum.Material.Neon)
finishPad.Name = "Finish"
addSign(finishPad, "FINISH", 6)

local confetti = Instance.new("ParticleEmitter")
confetti.Rate = 0
confetti.Lifetime = NumberRange.new(2, 3)
confetti.Speed = NumberRange.new(35, 55)
confetti.SpreadAngle = Vector2.new(50, 50)
confetti.Acceleration = Vector3.new(0, -40, 0)
confetti.EmissionDirection = Enum.NormalId.Top
confetti.Color = ColorSequence.new({
	ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 80, 80)),
	ColorSequenceKeypoint.new(0.5, Color3.fromRGB(255, 220, 60)),
	ColorSequenceKeypoint.new(1, Color3.fromRGB(80, 200, 255)),
})
confetti.Parent = finishPad

--------------------------------------------------------------------------------
-- Players: progress, saving, checkpoints, finishing
--------------------------------------------------------------------------------

local stageNames = {}
for _, stage in STAGES do
	table.insert(stageNames, stage.name)
end

local remote = Instance.new("RemoteEvent")
remote.Name = REMOTE_NAME
remote:SetAttribute("StageCount", #STAGES)
remote:SetAttribute("StageNames", table.concat(stageNames, "|"))
remote.Parent = ReplicatedStorage

-- Saving needs a published place. To test it in Studio, turn on
-- Game Settings > Security > Enable Studio Access to API Services.
local store: DataStore? = nil
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore("LavaLeap_v1")
	end)
	if ok then
		store = result
	else
		warn("Lava Leap: progress won't be saved:", result)
	end
end

type PlayerState = {
	stage: IntValue,
	wins: IntValue,
	bestTime: number?,
	runStart: number,
	runFromStart: boolean, -- only runs that began at stage 1 count for best time
	finished: boolean,
	canSave: boolean, -- false until saved progress has loaded, so we never overwrite it with defaults
	lastRestart: number,
}

local states: { [Player]: PlayerState } = {}

local function now(): number
	return workspace:GetServerTimeNow()
end

local function startRun(player: Player, state: PlayerState)
	state.runStart = now()
	state.runFromStart = state.stage.Value == 1
	state.finished = false
	player:SetAttribute("RunStart", state.runStart)
	player:SetAttribute("FinishTime", nil)
end

local function moveToCheckpoint(player: Player, character: Model)
	local state = states[player]
	if not state then
		return
	end
	local pad = checkpoints[state.stage.Value]
	local position = pad.Position + Vector3.new(0, PAD_SIZE.Y / 2 + 3.5, 0)
	-- Load the area first so the player doesn't fall through parts that haven't streamed in.
	pcall(function()
		player:RequestStreamAroundAsync(position, 5)
	end)
	if character.Parent then
		character:PivotTo(CFrame.lookAt(position, position + Vector3.xAxis))
	end
end

local function onCharacterAdded(player: Player, character: Model)
	character:WaitForChild("HumanoidRootPart")
	if not character.Parent then
		character.AncestryChanged:Wait()
	end
	task.wait() -- let the engine finish placing the character at the spawn
	moveToCheckpoint(player, character)
end

local function loadProgress(player: Player): (number, number, number?, boolean)
	local dataStore = store
	if not dataStore then
		return 1, 0, nil, false
	end
	local ok, data = pcall(function()
		return dataStore:GetAsync(SAVE_KEY_PREFIX .. player.UserId)
	end)
	if not ok then
		warn("Lava Leap: couldn't load progress for", player.Name, data)
		return 1, 0, nil, false
	end
	if type(data) ~= "table" then
		return 1, 0, nil, true -- first visit
	end
	local stage = math.clamp(math.floor(tonumber(data.stage) or 1), 1, #STAGES)
	return stage, tonumber(data.wins) or 0, tonumber(data.bestTime), true
end

local function saveProgress(player: Player)
	local dataStore = store
	local state = states[player]
	if not dataStore or not state or not state.canSave then
		return
	end
	local data = { stage = state.stage.Value, wins = state.wins.Value, bestTime = state.bestTime }
	local ok, err = pcall(function()
		dataStore:SetAsync(SAVE_KEY_PREFIX .. player.UserId, data)
	end)
	if not ok then
		warn("Lava Leap: couldn't save progress for", player.Name, err)
	end
end

local function onPlayerAdded(player: Player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	local stage = Instance.new("IntValue")
	stage.Name = "Stage"
	stage.Value = 1
	stage.Parent = leaderstats
	local wins = Instance.new("IntValue")
	wins.Name = "Wins"
	wins.Parent = leaderstats
	leaderstats.Parent = player

	local state: PlayerState = {
		stage = stage,
		wins = wins,
		bestTime = nil,
		runStart = now(),
		runFromStart = true,
		finished = false,
		canSave = false,
		lastRestart = 0,
	}
	states[player] = state
	startRun(player, state)

	player.CharacterAdded:Connect(function(character)
		onCharacterAdded(player, character)
	end)
	if player.Character then
		task.spawn(onCharacterAdded, player, player.Character)
	end

	local savedStage, savedWins, bestTime, loaded = loadProgress(player)
	if states[player] ~= state then
		return -- left while loading
	end
	state.canSave = loaded
	wins.Value = savedWins
	state.bestTime = bestTime
	player:SetAttribute("BestTime", bestTime)
	if savedStage > stage.Value then
		stage.Value = savedStage
		state.runFromStart = false
		if player.Character then
			moveToCheckpoint(player, player.Character)
		end
	end
end

local function playerFromHit(hit: BasePart): (Player?, PlayerState?)
	local character = characterFromHit(hit)
	if not character or not aliveHumanoid(character) then
		return nil, nil
	end
	local player = Players:GetPlayerFromCharacter(character)
	if not player then
		return nil, nil
	end
	return player, states[player]
end

for index, pad in checkpoints do
	pad.Touched:Connect(function(hit)
		local player, state = playerFromHit(hit)
		if player and state and index > state.stage.Value then
			state.stage.Value = index
			remote:FireClient(player, "Checkpoint", index)
		end
	end)
end

finishPad.Touched:Connect(function(hit)
	local player, state = playerFromHit(hit)
	if not player or not state or state.finished or state.stage.Value < #STAGES then
		return
	end
	state.finished = true
	state.wins.Value += 1

	local time = now() - state.runStart
	local isRecord = false
	if state.runFromStart and (state.bestTime == nil or time < state.bestTime) then
		state.bestTime = time
		isRecord = true
		player:SetAttribute("BestTime", time)
	end
	player:SetAttribute("FinishTime", time)
	remote:FireClient(player, "Finished", time, state.runFromStart, isRecord)
	confetti:Emit(80)
	task.spawn(saveProgress, player)
end)

remote.OnServerEvent:Connect(function(player, action)
	local state = states[player]
	if action ~= "Restart" or not state or os.clock() - state.lastRestart < 2 then
		return
	end
	state.lastRestart = os.clock()
	state.stage.Value = 1
	startRun(player, state)
	player:LoadCharacterAsync()
end)

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	saveProgress(player)
	states[player] = nil
end)

game:BindToClose(function()
	local pending = 0
	for _, player in Players:GetPlayers() do
		pending += 1
		task.spawn(function()
			saveProgress(player)
			pending -= 1
		end)
	end
	local deadline = os.clock() + 10
	while pending > 0 and os.clock() < deadline do
		task.wait(0.1)
	end
end)
