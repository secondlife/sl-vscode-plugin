local __require_table: { [number]: () -> any } = {}
__require_table[1] = (function()
-- @line 1 "diamond_b.luau"
-- Diamond B: requires D
local moduleD = __require_table[2]()

local function getValue()
    return moduleD.constant * 2
end

return {
    getValue = getValue
}
end)
__require_table[2] = (function()
-- @line 1 "diamond_d.luau"
-- Diamond D: shared base module
return {
    constant = 100
}
end)
-- @line 1 "diamond_a.luau"
-- Diamond test: A requires both B and D, B also requires D
local moduleB = __require_table[1]()
local moduleD = __require_table[2]()

local function run()
    return moduleB.getValue() + moduleD.constant
end

run()

__require_table = nil :: any
