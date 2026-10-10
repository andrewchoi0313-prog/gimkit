--!strict
-- Lava Leap: on-screen display (stage, timer, restart), jump pads, and checkpoint
-- colours. Put this LocalScript in StarterPlayer > StarterPlayerScripts.

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

-- Must match the server script.
local JUMP_PAD_TAG = "LavaLeapJumpPad"
local CHECKPOINT_TAG = "LavaLeapCheckpoint"
local REMOTE_NAME = "LavaLeapEvents"

local REACHED_COLOR = Color3.fromRGB(60, 220, 110)
local UNREACHED_COLOR = Color3.fromRGB(200, 205, 215)
local PANEL_COLOR = Color3.fromRGB(20, 22, 32)
local TEXT_COLOR = Color3.fromRGB(255, 255, 255)
local MUTED_COLOR = Color3.fromRGB(170, 176, 196)
local GOOD_COLOR = Color3.fromRGB(90, 235, 140)
local GOLD_COLOR = Color3.fromRGB(255, 210, 70)

local player = Players.LocalPlayer
local remote = ReplicatedStorage:WaitForChild(REMOTE_NAME) :: RemoteEvent
local stageCount = remote:GetAttribute("StageCount") :: number
local stageNames = string.split(remote:GetAttribute("StageNames") :: string, "|")
local leaderstats = player:WaitForChild("leaderstats")
local stageValue = leaderstats:WaitForChild("Stage") :: IntValue

local function formatTime(seconds: number): string
	seconds = math.max(0, seconds)
	return string.format("%d:%04.1f", seconds // 60, seconds % 60)
end

--------------------------------------------------------------------------------
-- On-screen display
--------------------------------------------------------------------------------

local function round(instance: GuiObject, radius: number)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius)
	corner.Parent = instance
end

local function label(parent: Instance, font: Enum.Font, textSize: number, color: Color3): TextLabel
	local text = Instance.new("TextLabel")
	text.BackgroundTransparency = 1
	text.Font = font
	text.TextSize = textSize
	text.TextColor3 = color
	text.Size = UDim2.new(1, 0, 0, textSize + 4)
	text.Parent = parent
	return text
end

local gui = Instance.new("ScreenGui")
gui.Name = "LavaLeapHud"
gui.ResetOnSpawn = false
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

local panel = Instance.new("Frame")
panel.AnchorPoint = Vector2.new(0.5, 0)
panel.Position = UDim2.new(0.5, 0, 0, 10)
panel.Size = UDim2.fromOffset(300, 0)
panel.AutomaticSize = Enum.AutomaticSize.Y
panel.BackgroundColor3 = PANEL_COLOR
panel.BackgroundTransparency = 0.2
round(panel, 14)
panel.Parent = gui

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 8)
padding.PaddingBottom = UDim.new(0, 10)
padding.Parent = panel

local list = Instance.new("UIListLayout")
list.HorizontalAlignment = Enum.HorizontalAlignment.Center
list.SortOrder = Enum.SortOrder.LayoutOrder
list.Padding = UDim.new(0, 2)
list.Parent = panel

local stageLabel = label(panel, Enum.Font.FredokaOne, 22, TEXT_COLOR)
stageLabel.LayoutOrder = 1
local timerLabel = label(panel, Enum.Font.RobotoMono, 24, GOLD_COLOR)
timerLabel.LayoutOrder = 2
local bestLabel = label(panel, Enum.Font.Gotham, 14, MUTED_COLOR)
bestLabel.LayoutOrder = 3

local restartButton = Instance.new("TextButton")
restartButton.LayoutOrder = 4
restartButton.Size = UDim2.fromOffset(140, 30)
restartButton.BackgroundColor3 = Color3.fromRGB(255, 96, 0)
restartButton.Font = Enum.Font.FredokaOne
restartButton.TextSize = 18
restartButton.TextColor3 = TEXT_COLOR
restartButton.Text = "Restart run"
round(restartButton, 10)
restartButton.Parent = panel

local toast = Instance.new("TextLabel")
toast.AnchorPoint = Vector2.new(0.5, 0.5)
toast.Position = UDim2.fromScale(0.5, 0.3)
toast.Size = UDim2.new(0.9, 0, 0, 44)
toast.BackgroundTransparency = 1
toast.Font = Enum.Font.FredokaOne
toast.TextSize = 40
toast.TextStrokeTransparency = 0.2
toast.TextWrapped = true
toast.Visible = false
toast.Parent = gui

gui.Parent = player:WaitForChild("PlayerGui")

local toastToken = 0
local function showToast(text: string, color: Color3, seconds: number)
	toastToken += 1
	local myToken = toastToken
	toast.Text = text
	toast.TextColor3 = color
	toast.Visible = true
	task.delay(seconds, function()
		if toastToken == myToken then
			toast.Visible = false
		end
	end)
end

local function updateStage()
	local stage = stageValue.Value
	if player:GetAttribute("FinishTime") ~= nil then
		stageLabel.Text = "Course complete!"
	else
		stageLabel.Text = string.format("Stage %d/%d · %s", stage, stageCount, stageNames[stage] or "")
	end
end

local function updateBest()
	local best = player:GetAttribute("BestTime")
	bestLabel.Text = if typeof(best) == "number" then "Best " .. formatTime(best) else "No best time yet"
end

RunService.RenderStepped:Connect(function()
	local finish = player:GetAttribute("FinishTime")
	local runStart = player:GetAttribute("RunStart")
	if typeof(finish) == "number" then
		timerLabel.Text = formatTime(finish)
	elseif typeof(runStart) == "number" then
		timerLabel.Text = formatTime(workspace:GetServerTimeNow() - runStart)
	end
end)

restartButton.Activated:Connect(function()
	remote:FireServer("Restart")
	showToast("Back to stage 1. Go!", TEXT_COLOR, 1.5)
end)

remote.OnClientEvent:Connect(function(kind: string, a: any, b: any, c: any)
	if kind == "Checkpoint" then
		showToast(string.format("Checkpoint! Stage %d", a), GOOD_COLOR, 1.5)
	elseif kind == "Finished" then
		local time, counted, isRecord = a :: number, b :: boolean, c :: boolean
		local message = "You escaped the lava in " .. formatTime(time) .. "!"
		if isRecord then
			message ..= " New best!"
		elseif not counted then
			message ..= " Restart from stage 1 to set a best time."
		end
		showToast(message, GOLD_COLOR, 5)
	end
end)

--------------------------------------------------------------------------------
-- Checkpoint colours: the ones you've reached turn green (only on your screen).
--------------------------------------------------------------------------------

local function tint(pad: Instance)
	local index = pad:GetAttribute("Stage")
	if pad:IsA("BasePart") and typeof(index) == "number" then
		pad.Color = if index <= stageValue.Value then REACHED_COLOR else UNREACHED_COLOR
	end
end

local function tintAll()
	for _, pad in CollectionService:GetTagged(CHECKPOINT_TAG) do
		tint(pad)
	end
end

-- Parts stream in as you get close, so tint them as they arrive.
CollectionService:GetInstanceAddedSignal(CHECKPOINT_TAG):Connect(tint)

stageValue.Changed:Connect(function()
	updateStage()
	tintAll()
end)
player:GetAttributeChangedSignal("FinishTime"):Connect(updateStage)
player:GetAttributeChangedSignal("BestTime"):Connect(updateBest)
updateStage()
updateBest()
tintAll()

--------------------------------------------------------------------------------
-- Jump pads. Your character is simulated on your computer, so the launch happens here.
--------------------------------------------------------------------------------

local lastLaunch = 0

local function hookJumpPad(pad: Instance)
	if not pad:IsA("BasePart") then
		return
	end
	pad.Touched:Connect(function(hit)
		local character = player.Character
		if not character or not hit:IsDescendantOf(character) or os.clock() - lastLaunch < 0.4 then
			return
		end
		local root = character:FindFirstChild("HumanoidRootPart")
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if not root or not root:IsA("BasePart") or not humanoid or humanoid.Health <= 0 then
			return
		end
		lastLaunch = os.clock()
		local launch = pad:GetAttribute("Launch")
		local velocity = root.AssemblyLinearVelocity
		humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
		root.AssemblyLinearVelocity = Vector3.new(velocity.X, if typeof(launch) == "number" then launch else 85, velocity.Z)
	end)
end

for _, pad in CollectionService:GetTagged(JUMP_PAD_TAG) do
	hookJumpPad(pad)
end
CollectionService:GetInstanceAddedSignal(JUMP_PAD_TAG):Connect(hookJumpPad)
