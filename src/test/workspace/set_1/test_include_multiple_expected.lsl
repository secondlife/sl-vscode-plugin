// Test multiple includes with include guards
// @line 1 "file:///test/workspace/set_1/include/math.lsl"
// Math utilities

// @line 4 "file:///test/workspace/set_1/include/math.lsl"
float square(float x) {
    return x * x;
}
// @line 1 "file:///test/workspace/set_1/include/common.lsl"
// Common utility functions

// @line 4 "file:///test/workspace/set_1/include/common.lsl"
float add(float a, float b) {
    return a + b;
}

// @line 5 "file:///test/workspace/set_1/test_include_multiple.lsl"
default {
    state_entry() {
        float radius = 5.0;
        float area = 3.14159265 * square(radius);
        float perimeter = 2.0 * 3.14159265 * radius;

// @line 11 "file:///test/workspace/set_1/test_include_multiple.lsl"
        llSay(0, "Area: " + (string)area);
        llSay(0, "Perimeter: " + (string)perimeter);
    }
}
