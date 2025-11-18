-- Test library for require() functionality
local function utility_function(msg)
    print("Utility: " .. msg)
    return "processed: " .. msg
end

local function another_function()
    return 42
end

return {
    utility = utility_function,
    getValue = another_function
}
