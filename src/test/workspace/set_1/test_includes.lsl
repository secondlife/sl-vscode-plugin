// LSL test file demonstrating include functionality with defines and conditionals
#include "include/common_defines.lsl"

// Local defines that build on included ones
#define ENHANCED_DEBUG TRUE
#define LOG_LEVEL 2

// Conditional defines based on included constants
#ifdef ENHANCED_DEBUG
    #define DETAILED_LOG(msg) LOG_INFO("DETAILED: " + (string)(msg))
#else
    #define DETAILED_LOG(msg) // No-op when not in enhanced debug
#endif

// Test mathematical operations using included constants
#define CIRCLE_AREA(radius) (PI * SQUARE(radius))
#define SPHERE_VOLUME(radius) ((4.0 / 3.0) * PI * (radius) * (radius) * (radius))

// Advanced macros using included utilities
#define CLAMP_ANGLE(angle) ((angle) < 0 ? (angle) + TWO_PI : ((angle) > TWO_PI ? (angle) - TWO_PI : (angle)))
#define DEGREES_TO_RADIANS(deg) ((deg) * PI / 180.0)

default
{
    state_entry()
    {
        LOG_INFO("Starting include test");

        // Test included mathematical constants
        float e_squared = SQUARE(E);
        LOG_INFO("E squared: " + (string)e_squared);

        float golden_calc = GOLDEN_RATIO * SQRT_2;
        LOG_INFO("Golden ratio * sqrt(2): " + (string)golden_calc);

        // Test included utility macros
        integer positive_sign = SIGN(42);
        integer negative_sign = SIGN(-17);
        integer zero_sign = SIGN(0);

        LOG_INFO("Signs: " + (string)positive_sign + ", " + (string)negative_sign + ", " + (string)zero_sign);

        // Test rounding functions
        float test_val = 3.7;
        integer rounded = ROUND(test_val);
        LOG_INFO("Rounded " + (string)test_val + " to " + (string)rounded);

        // Test ceiling division
        integer ceil_result = CEIL_DIV(17, 5);
        LOG_INFO("Ceiling division 17/5: " + (string)ceil_result);

        // Test color constants
        vector red_color = COLOR_RED;
        vector white_color = COLOR_WHITE;
        LOG_INFO("Red color: " + (string)red_color);
        LOG_INFO("White color: " + (string)white_color);

        // Test advanced mathematical calculations
        float radius = 5.0;
        float area = CIRCLE_AREA(radius);
        float volume = SPHERE_VOLUME(radius);

        LOG_INFO("Circle area (r=" + (string)radius + "): " + (string)area);
        LOG_INFO("Sphere volume (r=" + (string)radius + "): " + (string)volume);

        // Test key validation
        key valid_key = llGetOwner();
        key invalid_key = INVALID_KEY;

        if (IS_VALID_KEY(valid_key)) {
            LOG_INFO("Owner key is valid");
        }

        if (!IS_VALID_KEY(invalid_key)) {
            LOG_INFO("Invalid key detected correctly");
        }

        // Test conditional compilation with included defines
#if LOG_LEVEL >= 2
        DETAILED_LOG("Detailed logging is enabled");
        LOG_WARNING("This is a test warning");
        LOG_ERROR("This is a test error (not real)");
#endif

#ifdef ENHANCED_DEBUG
        llSay(DEBUG_CHANNEL, "Enhanced debug mode active");

        // Additional debug information
        vector pos = llGetPos();
        rotation rot = llGetRot();

        DETAILED_LOG("Position: " + (string)pos);
        DETAILED_LOG("Rotation: " + (string)rot);
#endif

        // Test angle calculations
        float angle_degrees = 45.0;
        float angle_radians = DEGREES_TO_RADIANS(angle_degrees);
        LOG_INFO("45 degrees = " + (string)angle_radians + " radians");

        // Set timer to test more functionality
        llSetTimerEvent(5.0);
    }

    timer()
    {
        llSetTimerEvent(0.0);

        LOG_INFO("Timer event triggered");

        // Test more included functionality
        list test_angles = [0.0, PI/4, PI/2, PI, 3*PI/2, 2*PI, 2.5*PI];
        integer i;

        for (i = 0; i < llGetListLength(test_angles); i++) {
            float angle = llList2Float(test_angles, i);
            // float clamped = CLAMP_ANGLE(angle);
            //LOG_INFO("Angle " + (string)angle + " clamped to " + (string)clamped);
        }

        // Test error and warning logging
        LOG_WARNING("This is a test warning from timer");

#if LOG_LEVEL >= 1
        LOG_INFO("Log level 1 or higher - showing basic info");
#endif

#if LOG_LEVEL >= 2
        DETAILED_LOG("Log level 2 or higher - showing detailed info");
#endif

#if LOG_LEVEL >= 3
        LOG_INFO("Log level 3 - maximum verbosity");
#endif
    }

    touch_start(integer total_number)
    {
        key toucher = llDetectedKey(0);

        if (IS_VALID_KEY(toucher)) {
            string name = llDetectedName(0);
            LOG_INFO("Valid touch from: " + name);

            // Use included channel constants
            llSay(PUBLIC_CHANNEL, "Hello " + name + "!");

#ifdef ENHANCED_DEBUG
            vector touch_pos = llDetectedPos(0);
            DETAILED_LOG("Touch position: " + (string)touch_pos);

            // Calculate distance using imported mathematical functions
            vector obj_pos = llGetPos();
            float distance = llVecDist(touch_pos, obj_pos);
            DETAILED_LOG("Touch distance: " + (string)distance);
#endif
        } else {
            LOG_ERROR("Invalid toucher key detected");
        }

        // Test mathematical calculations with touch count
        integer touch_squared = SQUARE(total_number);
        float touch_sign = SIGN(total_number - 2);  // Will be positive if more than 2 touches

        LOG_INFO("Touches: " + (string)total_number +
                ", squared: " + (string)touch_squared +
                ", sign(touches-2): " + (string)touch_sign);
    }

    listen(integer channel, string name, key id, string message)
    {
        if (channel == DEBUG_CHANNEL) {
            LOG_INFO("Debug message received: " + message);

            if (message == "test_math") {
                // Perform comprehensive math test using included functions
                list test_values = [-5.5, -2.0, 0.0, 3.7, 10.9];
                integer i;

                for (i = 0; i < llGetListLength(test_values); i++) {
                    float val = llList2Float(test_values, i);

                    integer sign_result = SIGN(val);
                    integer rounded_result = ROUND(val);
                    float squared_result = SQUARE(val);

                    string result_msg = "Value: " + (string)val +
                                      ", Sign: " + (string)sign_result +
                                      ", Rounded: " + (string)rounded_result +
                                      ", Squared: " + (string)squared_result;

                    DETAILED_LOG(result_msg);
                }
            }

            if (message == "test_colors") {
                // Test color constants
                list colors = [COLOR_RED, COLOR_GREEN, COLOR_BLUE, COLOR_WHITE, COLOR_BLACK];
                list color_names = ["Red", "Green", "Blue", "White", "Black"];
                integer i;

                for (i = 0; i < llGetListLength(colors); i++) {
                    vector color = llList2Vector(colors, i);
                    string name_str = llList2String(color_names, i);

                    LOG_INFO(name_str + " color: " + (string)color);
                }
            }
        }
    }
}
