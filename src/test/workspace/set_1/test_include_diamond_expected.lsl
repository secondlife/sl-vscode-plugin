// Test diamond dependency A -> B,C where B -> C
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

// @line 5 "file:///test/workspace/set_1/test_include_diamond.lsl"
default {
    state_entry() {
        // common.lsl should only be included once due to include guards in helper.lsl
        float sum = add(10.0, 20.0);
        llSay(0, formatNumber(sum));
    }
}
