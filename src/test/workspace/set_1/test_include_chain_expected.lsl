// Test simple include chain A -> B -> C
// @line 1 "file:///test/workspace/set_1/include/helper.lsl"
// Helper utilities that includes common
// @line 1 "file:///test/workspace/set_1/include/common.lsl"
// Common utility functions

// @line 4 "file:///test/workspace/set_1/include/common.lsl"
float add(float a, float b) {
    return a + b;
}

// @line 4 "file:///test/workspace/set_1/include/helper.lsl"
string formatNumber(float n) {
    return "Value: " + (string)n;
}

// @line 4 "file:///test/workspace/set_1/test_include_chain.lsl"
default {
    state_entry() {
        float result = add(5.0, 3.0);
        llSay(0, formatNumber(result));
    }
}
