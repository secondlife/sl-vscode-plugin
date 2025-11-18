local __require_table: { [number]: () -> any } = {}
__require_table[1] = (function()
-- @line 1 "nested_b.luau"
-- Nested module B: requires C
local moduleC = __require_table[2]()

local function transform(value)
    return moduleC.calculate(value) + 10
end

return {
    transform = transform
}
end)
__require_table[2] = (function()
-- @line 1 "nested_c.luau"
-- Nested module C: requires D
local moduleD = __require_table[3]()

local function calculate(value)
    return moduleD.BASE_VALUE + value
end

return {
    calculate = calculate
}
end)
__require_table[3] = (function()
-- @line 1 "nested_d.luau"
-- Nested module D: base module with constant
return {
    BASE_VALUE = 42
}
end)
-- @line 1 "nested_a.luau"
-- Test file for nested require chains: A -> B -> C -> D
local moduleB = __require_table[1]()

local function processData(value)
    return moduleB.transform(value) * 2
end

processData(5)

__require_table = nil :: any
