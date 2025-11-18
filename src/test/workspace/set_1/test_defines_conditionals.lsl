// Comprehensive LSL test file for preprocessor defines and conditionals
// This file exercises all major features of the preprocessor system

// ========== BASIC DEFINES ==========
#define VERSION 2
#define DEBUG_MODE TRUE
#define PI 3.14159265
#define MAX_ITEMS 10
#define OWNER_GREETING "Hello, Owner!"
#define CHANNEL 42
#define TIMEOUT 30.0

// Valueless defines
#define DEBUG
#define PRODUCTION

// ========== FUNCTION-LIKE MACROS ==========
// Single parameter macros
#define SQUARE(x) ((x) * (x))
#define ABS(x) ((x) < 0 ? -(x) : (x))
#define TO_RADIANS(degrees) ((degrees) * PI / 180.0)
#define LOG_DEBUG(msg) llOwnerSay("DEBUG: " + (string)(msg))
#define CLAMP_01(x) ((x) < 0.0 ? 0.0 : ((x) > 1.0 ? 1.0 : (x)))

// Multi-parameter macros
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define LERP(a, b, t) ((a) + (t) * ((b) - (a)))
#define DISTANCE_2D(x1, y1, x2, y2) llSqrt(((x2) - (x1)) * ((x2) - (x1)) + ((y2) - (y1)) * ((y2) - (y1)))
#define SAY_CHANNEL(ch, msg) llSay((ch), (msg))
#define VECTOR_ADD(v1, v2) (<(v1).x + (v2).x, (v1).y + (v2).y, (v1).z + (v2).z>)

// Nested macro definitions
#define DOUBLE(x) ((x) * 2)
#define QUAD(x) DOUBLE(DOUBLE(x))
#define COMPLEX_CALC(x, y) (SQUARE(x) + SQUARE(y) + DOUBLE(MIN(x, y)))

// ========== CONDITIONAL COMPILATION TESTS ==========

// Test basic ifdef/endif
#ifdef DEBUG
    #define DEBUG_LOG(msg) llOwnerSay("DEBUG: " + (string)(msg))
#endif

#ifndef PRODUCTION
    #define VERBOSE_LOGGING TRUE
#endif

// Test if/elif/else chains
#if VERSION == 1
    #define API_MESSAGE "Using API Version 1.0"
    #define FEATURE_ADVANCED FALSE
#elif VERSION == 2
    #define API_MESSAGE "Using API Version 2.0"
    #define FEATURE_ADVANCED TRUE
#elif VERSION >= 3
    #define API_MESSAGE "Using Future API Version"
    #define FEATURE_ADVANCED TRUE
#else
    #define API_MESSAGE "Unknown API Version"
    #define FEATURE_ADVANCED FALSE
#endif

// Test complex conditional expressions
#define BUILD_TYPE "debug"
#if BUILD_TYPE == "debug" && defined(VERBOSE_LOGGING)
    #define FULL_DEBUG TRUE
#else
    #define FULL_DEBUG FALSE
#endif

// Nested conditionals
#ifdef DEBUG_MODE
    #if VERSION >= 2
        #define USE_NEW_DEBUG_FEATURES TRUE
    #else
        #define USE_NEW_DEBUG_FEATURES FALSE
    #endif
#else
    #define USE_NEW_DEBUG_FEATURES FALSE
#endif

// ========== MAIN SCRIPT ==========
default
{
    state_entry()
    {
        // Test basic define substitution
        llOwnerSay(OWNER_GREETING);
        llOwnerSay("Version: " + (string)VERSION);
        llOwnerSay(API_MESSAGE);

        // Test numeric defines
        float circumference = 2 * PI * 5.0;
        llOwnerSay("Circumference: " + (string)circumference);

        // Test function-like macros
        integer value = 5;
        llOwnerSay("5 squared = " + (string)SQUARE(value));
        llOwnerSay("|-7| = " + (string)ABS(-7));

        float angle_rad = TO_RADIANS(90.0);
        llOwnerSay("90 degrees in radians = " + (string)angle_rad);

        // Test multi-parameter macros
        integer a = 10;
        integer b = 20;
        llOwnerSay("Max(10, 20) = " + (string)MAX(a, b));
        llOwnerSay("Min(10, 20) = " + (string)MIN(a, b));

        float lerped = LERP(0.0, 100.0, 0.5);
        llOwnerSay("Lerp(0, 100, 0.5) = " + (string)lerped);

        // Test vector math macro
        vector v1 = <1.0, 2.0, 3.0>;
        vector v2 = <4.0, 5.0, 6.0>;
        vector result = VECTOR_ADD(v1, v2);
        llOwnerSay("Vector addition result: " + (string)result);

        // Test distance calculation
        float dist = DISTANCE_2D(0.0, 0.0, 3.0, 4.0);
        llOwnerSay("Distance 2D: " + (string)dist);

        // Test nested macros
        integer nested_result = QUAD(3);
        llOwnerSay("Quad(3) = " + (string)nested_result);

        integer complex_result = COMPLEX_CALC(3, 4);
        llOwnerSay("Complex calculation result: " + (string)complex_result);

        // Test channel communication
        SAY_CHANNEL(CHANNEL, "Hello on channel " + (string)CHANNEL);

        // Test conditional compilation results
#ifdef DEBUG_LOG
        DEBUG_LOG("Debug logging is enabled");
#endif

#ifdef VERBOSE_LOGGING
        llOwnerSay("Verbose logging is enabled");
#endif

#if FEATURE_ADVANCED
        llOwnerSay("Advanced features are available");

        // Advanced feature code
        list advanced_items = [];
        integer i;
        for (i = 0; i < MAX_ITEMS; i++) {
            advanced_items += ["Advanced Item " + (string)i];
        }
        llOwnerSay("Created " + (string)llGetListLength(advanced_items) + " advanced items");
#else
        llOwnerSay("Basic features only");
#endif

#if FULL_DEBUG
        llOwnerSay("Full debug mode activated");
        llOwnerSay("Build type: " + BUILD_TYPE);
#endif

#if USE_NEW_DEBUG_FEATURES
        llOwnerSay("Using new debug features for version " + (string)VERSION);
#else
        llOwnerSay("Using legacy debug features");
#endif

        // Test clamping macro
        float test_val = 1.5;
        float clamped = CLAMP_01(test_val);
        llOwnerSay("Clamped " + (string)test_val + " to " + (string)clamped);

        // Set up timer for further testing
        llSetTimerEvent(TIMEOUT);
    }

    timer()
    {
        llSetTimerEvent(0.0);

        // Test more complex macro usage in timer
        vector pos = llGetPos();
        vector target = pos + <10.0, 0.0, 0.0>;

        float distance = DISTANCE_2D(pos.x, pos.y, target.x, target.y);
        llOwnerSay("Distance to target: " + (string)distance);

#if VERSION >= 2
        // Version 2+ specific features
        llOwnerSay("Executing version 2+ timer code");

        integer max_val = MAX(SQUARE(5), ABS(-30));
        llOwnerSay("Max of 25 and 30 = " + (string)max_val);
#endif

#ifdef DEBUG
        llOwnerSay("Timer event processed in debug mode");
#endif
    }

    touch_start(integer total_number)
    {
        // Test macros in event handlers
        LOG_DEBUG("Touch detected by " + (string)total_number + " avatars");

        integer touched_squared = SQUARE(total_number);
        llOwnerSay("Touches squared: " + (string)touched_squared);

#ifndef PRODUCTION
        llOwnerSay("Development touch handler active");

        // Development-only touch features
        key toucher = llDetectedKey(0);
        string name = llDetectedName(0);

        SAY_CHANNEL(0, "Touched by: " + name);

#if FEATURE_ADVANCED
        vector touch_pos = llDetectedPos(0);
        vector object_pos = llGetPos();
        float touch_distance = DISTANCE_2D(touch_pos.x, touch_pos.y, object_pos.x, object_pos.y);

        llOwnerSay("Touch distance: " + (string)touch_distance);
#endif
#endif
    }

    listen(integer channel, string name, key id, string message)
    {
        // Test conditional compilation in listen events
#if CHANNEL == 42
        if (channel == CHANNEL) {
            llOwnerSay("Received message on configured channel: " + message);

            // Test macro in string processing
            if (message == "test") {
                integer test_result = COMPLEX_CALC(2, 3);
                SAY_CHANNEL(channel, "Test result: " + (string)test_result);
            }
        }
#endif

#ifdef DEBUG_MODE
        LOG_DEBUG("Listen event - Channel: " + (string)channel + ", Message: " + message);
#endif
    }
}

// Test state changes with preprocessor
state test_state
{
    state_entry()
    {
        llOwnerSay("Entered test state");

        // Test that macros work in different states
        integer state_test = DOUBLE(21);  // Should be 42
        llOwnerSay("State test result: " + (string)state_test);

#if VERSION == 2
        llOwnerSay("Version 2 test state functionality");
        llSetTimerEvent(5.0);
#else
        llOwnerSay("Legacy test state functionality");
        llSetTimerEvent(10.0);
#endif
    }

    timer()
    {
        llSetTimerEvent(0.0);

#ifdef DEBUG
        LOG_DEBUG("Test state timer expired");
#endif

        state default;
    }
}
