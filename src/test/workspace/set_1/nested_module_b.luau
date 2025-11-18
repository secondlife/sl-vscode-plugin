-- Module B that requires Module C
local moduleC = require("nested_module_c.luau")

local function funcB()
    print("Function B")
    moduleC.funcC()
end

return {
    funcB = funcB
}
