-- Test file for nested require chains: A -> B -> C -> D
local moduleB = require("nested_b.luau")

local function processData(value)
    return moduleB.transform(value) * 2
end


processData(5)
