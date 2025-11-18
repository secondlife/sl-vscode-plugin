-- Test file demonstrating new assignment syntax for require()

-- Standalone require (original functionality)
require("test_library.luau")

-- Assignment syntax (new functionality)
mymodule = require("test_library.luau")
local utils = require("test_library.luau")
helper = require("test_library.luau")

-- Main script
print("Testing assignment syntax for require()")
