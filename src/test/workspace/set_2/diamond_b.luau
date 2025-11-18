-- Diamond B: requires D
local moduleD = require("diamond_d.luau")

local function getValue()
    return moduleD.constant * 2
end

return {
    getValue = getValue
}
