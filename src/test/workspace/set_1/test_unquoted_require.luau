-- Test file demonstrating unquoted require() syntax

-- Quoted strings (original functionality)
require("test_library.luau")
mymodule1 = require("test_library.luau")
local utils1 = require("test_library.luau")

-- Unquoted strings (new functionality)
require(test_library.luau)
mymodule2 = require(test_library.luau)
local utils2 = require(test_library.luau)

-- Path examples
require(../include/common.luau)
local helper = require(subfolder/helper.luau)

-- Main script
print("Testing unquoted syntax for require()")
