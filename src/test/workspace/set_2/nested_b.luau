-- Nested module B: requires C
local moduleC = require("nested_c.luau")

local function transform(value)
    return moduleC.calculate(value) + 10
end

return {
    transform = transform
}
