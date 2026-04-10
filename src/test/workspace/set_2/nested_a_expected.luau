(function()
    local modules = {
(function()
-- @line 1 "unittest:///test/workspace/set_2/nested_b.luau"
-- Nested module B: requires C
local moduleC = require(2)

-- @line 4 "unittest:///test/workspace/set_2/nested_b.luau"
local function transform(value)
    return moduleC.calculate(value) + 10
end

-- @line 8 "unittest:///test/workspace/set_2/nested_b.luau"
return {
    transform = transform
}
end),
(function()
-- @line 1 "unittest:///test/workspace/set_2/nested_c.luau"
-- Nested module C: requires D
local moduleD = require(3)

-- @line 4 "unittest:///test/workspace/set_2/nested_c.luau"
local function calculate(value)
    return moduleD.BASE_VALUE + value
end

-- @line 8 "unittest:///test/workspace/set_2/nested_c.luau"
return {
    calculate = calculate
}
end),
(function()
-- @line 1 "unittest:///test/workspace/set_2/nested_d.luau"
-- Nested module D: base module with constant
return {
    BASE_VALUE = 42
}
end),
    }
    local cache = {}
    function require(mod)
        if not cache[mod] then
            if not modules[mod] then
                error(`unknown module '{mod}'`)
            end
            cache[mod] = dangerouslyexecuterequiredmodule(modules[mod])
        end
        return cache[mod]
    end
end)()
--@line 1 "/home/wolfgang/projects/sl/vscode/sl-vscode-plugin/src/test/workspace/set_2/nested_a.luau"
-- Test file for nested require chains: A -> B -> C -> D
local moduleB = require(1)

-- @line 4 "unittest:///test/workspace/set_2/nested_a.luau"
local function processData(value)
    return moduleB.transform(value) * 2
end


-- @line 9 "unittest:///test/workspace/set_2/nested_a.luau"
print(processData(5))
