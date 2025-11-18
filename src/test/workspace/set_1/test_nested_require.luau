-- Test file for nested require() functionality
local moduleA = require("nested_module_a.luau")

-- Main script
print("Main script with nested requires")
moduleA.funcA()
