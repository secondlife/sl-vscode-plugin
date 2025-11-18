-- Nested module C: requires D
local moduleD = require("nested_d.luau")

local function calculate(value)
    return moduleD.BASE_VALUE + value
end

return {
    calculate = calculate
}
