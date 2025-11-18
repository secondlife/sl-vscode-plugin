-- Diamond test: A requires both B and D, B also requires D
local moduleB = require("diamond_b.luau")
local moduleD = require("diamond_d.luau")

local function run()
    return moduleB.getValue() + moduleD.constant
end

run()
