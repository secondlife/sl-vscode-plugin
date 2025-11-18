// Comprehensive LSL test file for preprocessor defines and conditionals
// This file exercises all major features of the preprocessor system

// @line 4 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// ========== BASIC DEFINES ==========

// @line 13 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// Valueless defines

// @line 17 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// ========== FUNCTION-LIKE MACROS ==========
// Single parameter macros

// @line 25 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// Multi-parameter macros

// @line 33 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// Nested macro definitions

// @line 38 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// ========== CONDITIONAL COMPILATION TESTS ==========

// @line 40 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// Test basic ifdef/endif
// @line 42 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"


// @line 49 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// Test if/elif/else chains
// @line 54 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"

// @line 64 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// Test complex conditional expressions
// @line 69 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"

// @line 72 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// Nested conditionals
// @line 74 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"

// @line 83 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// ========== MAIN SCRIPT ==========
default
{
    state_entry()
    {
        // Test basic define substitution
        llOwnerSay("Hello, Owner!");
        llOwnerSay("Version: " + (string)2);
        llOwnerSay("Unknown API Version");

// @line 93 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test numeric defines
        float circumference = 2 * 3.14159265 * 5.0;
        llOwnerSay("Circumference: " + (string)circumference);

// @line 97 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test function-like macros
        integer value = 5;
        llOwnerSay("5 squared = " + (string)((value) * (value)));
        llOwnerSay("|-7| = " + (string)((-7) < 0 ? -(-7) : (-7)));

// @line 102 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        float angle_rad = ((90.0) * 3.14159265 / 180.0);
        llOwnerSay("90 degrees in radians = " + (string)angle_rad);

// @line 105 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test multi-parameter macros
        integer a = 10;
        integer b = 20;
        llOwnerSay("Max(10, 20) = " + (string)((a) > (b) ? (a) : (b)));
        llOwnerSay("Min(10, 20) = " + (string)((a) < (b) ? (a) : (b)));

// @line 111 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        float lerped = ((0.0) + (0.5) * ((100.0) - (0.0)));
        llOwnerSay("Lerp(0, 100, 0.5) = " + (string)lerped);

// @line 114 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test vector math macro
        vector v1 = <1.0, 2.0, 3.0>;
        vector v2 = <4.0, 5.0, 6.0>;
        vector result = (<(v1).x + (v2).x, (v1).y + (v2).y, (v1).z + (v2).z>);
        llOwnerSay("Vector addition result: " + (string)result);

// @line 120 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test distance calculation
        float dist = llSqrt(((3.0) - (0.0)) * ((3.0) - (0.0)) + ((4.0) - (0.0)) * ((4.0) - (0.0)));
        llOwnerSay("Distance 2D: " + (string)dist);

// @line 124 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test nested macros
        integer nested_result = ((DOUBLE(3)) * 2);
        llOwnerSay("Quad(3) = " + (string)nested_result);

// @line 128 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        integer complex_result = (((3) * (3)) + ((4) * (4)) + ((((3) < ( 4) ? (3) : ( 4))) * 2));
        llOwnerSay("Complex calculation result: " + (string)complex_result);

// @line 131 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test channel communication
        llSay((42), ("Hello on channel " + (string)42));

// @line 134 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test conditional compilation results
// @line 136 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        llOwnerSay("DEBUG: " + (string)("Debug logging is enabled"));

// @line 140 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        llOwnerSay("Verbose logging is enabled");

// @line 154 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        llOwnerSay("Basic features only");


// @line 165 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        llOwnerSay("Using legacy debug features");

// @line 168 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test clamping macro
        float test_val = 1.5;
        float clamped = ((test_val) < 0.0 ? 0.0 : ((test_val) > 1.0 ? 1.0 : (test_val)));
        llOwnerSay("Clamped " + (string)test_val + " to " + (string)clamped);

// @line 173 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Set up timer for further testing
        llSetTimerEvent(30.0);
    }

// @line 177 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
    timer()
    {
        llSetTimerEvent(0.0);

// @line 181 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test more complex macro usage in timer
        vector pos = llGetPos();
        vector target = pos + <10.0, 0.0, 0.0>;

// @line 185 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        float distance = llSqrt(((target.x) - (pos.x)) * ((target.x) - (pos.x)) + ((target.y) - (pos.y)) * ((target.y) - (pos.y)));
        llOwnerSay("Distance to target: " + (string)distance);

// @line 189 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Version 2+ specific features
        llOwnerSay("Executing version 2+ timer code");

// @line 192 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        integer max_val = ((((5) * (5))) > (((-30) < 0 ? -(-30) : (-30))) ? (((5) * (5))) : (((-30) < 0 ? -(-30) : (-30))));
        llOwnerSay("Max of 25 and 30 = " + (string)max_val);

// @line 197 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        llOwnerSay("Timer event processed in debug mode");
// @line 199 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
    }

// @line 201 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
    touch_start(integer total_number)
    {
        // Test macros in event handlers
        llOwnerSay("DEBUG: " + (string)("Touch detected by " + (string)total_number + " avatars"));

// @line 206 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        integer touched_squared = ((total_number) * (total_number));
        llOwnerSay("Touches squared: " + (string)touched_squared);

// @line 226 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
    }

// @line 228 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
    listen(integer channel, string name, key id, string message)
    {
        // Test conditional compilation in listen events
// @line 232 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        if (channel == 42) {
            llOwnerSay("Received message on configured channel: " + message);

// @line 235 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
            // Test macro in string processing
            if (message == "test") {
                integer test_result = (((2) * (2)) + ((3) * (3)) + ((((2) < ( 3) ? (2) : ( 3))) * 2));
                llSay((channel), ("Test result: " + (string)test_result));
            }
        }

// @line 244 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        llOwnerSay("DEBUG: " + (string)("Listen event - Channel: " + (string)channel + ", Message: " + message));
// @line 246 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
    }
}

// @line 249 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
// Test state changes with preprocessor
state test_state
{
    state_entry()
    {
        llOwnerSay("Entered test state");

// @line 256 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        // Test that macros work in different states
        integer state_test = ((21) * 2);  // Should be 42
        llOwnerSay("State test result: " + (string)state_test);

// @line 261 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        llOwnerSay("Version 2 test state functionality");
        llSetTimerEvent(5.0);
// @line 267 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
    }

// @line 269 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
    timer()
    {
        llSetTimerEvent(0.0);

// @line 274 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        llOwnerSay("DEBUG: " + (string)("Test state timer expired"));

// @line 277 "unittest:///test/workspace/set_1/test_defines_conditionals.lsl"
        state default;
    }
}
