-- Module C (deepest level)
local function funcC()
    print("Function C - deepest level")
end

return {
    funcC = funcC
}
