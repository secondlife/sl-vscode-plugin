-- Module A that requires Module B
local moduleB = require("nested_module_b.luau")

local function funcA()
    print("Function A")
    moduleB.funcB()
end

return {
    funcA = funcA
}
