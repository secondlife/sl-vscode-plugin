-- Luau test file demonstrating include functionality with defines and conditionals
--#include "include/common_defines.luau"

-- Local defines that build on included ones
--#define ENHANCED_DEBUG true
--#define LOG_LEVEL 2

-- Conditional defines based on included constants
--#ifdef ENHANCED_DEBUG
    --#define DETAILED_LOG(msg) LOG_INFO("DETAILED: " .. tostring(msg))
--#else
    --#define DETAILED_LOG(msg) -- No-op when not in enhanced debug
--#endif

-- Test mathematical operations using included constants
--#define CIRCLE_AREA(radius) (PI * SQUARE(radius))
--#define SPHERE_VOLUME(radius) ((4.0 / 3.0) * PI * (radius) * (radius) * (radius))

-- Advanced macros using included utilities
--#define CLAMP_ANGLE(angle) ((angle) < 0 and (angle) + (2 * PI) or ((angle) > (2 * PI) and (angle) - (2 * PI) or (angle)))
--#define DEGREES_TO_RADIANS(deg) ((deg) * PI / 180.0)

-- Table manipulation helpers
--#define ARRAY_CONTAINS(arr, val) (function() for i, v in ipairs(arr) do if v == val then return true end end return false end)()

--#include "particleext.luau"

print(__FILE__)
print(__TIMESTAMP__)

-- Main test functions
local function test_mathematical_constants()
    LOG_INFO("Starting include test")

    -- Test included mathematical constants
    local e_squared = SQUARE(E)
    LOG_INFO("E squared: " .. tostring(e_squared))

    local golden_calc = GOLDEN_RATIO * SQRT_2
    LOG_INFO("Golden ratio * sqrt(2): " .. tostring(golden_calc))
end

local function test_utility_macros()
    -- Test included utility macros
    local positive_sign = SIGN(42)
    local negative_sign = SIGN(-17)
    local zero_sign = SIGN(0)

    LOG_INFO("Signs: " .. tostring(positive_sign) .. ", " .. tostring(negative_sign) .. ", " .. tostring(zero_sign))

    -- Test rounding functions
    local test_val = 3.7
    local rounded = ROUND(test_val)
    LOG_INFO("Rounded " .. tostring(test_val) .. " to " .. tostring(rounded))

    -- Test ceiling division
    local ceil_result = CEIL_DIV(17, 5)
    LOG_INFO("Ceiling division 17/5: " .. tostring(ceil_result))
end

local function test_color_constants()
    -- Test color constants
    local red_color = COLOR_RED
    local white_color = COLOR_WHITE

    LOG_INFO("Red color: r=" .. tostring(red_color.r) .. ", g=" .. tostring(red_color.g) .. ", b=" .. tostring(red_color.b))
    LOG_INFO("White color: r=" .. tostring(white_color.r) .. ", g=" .. tostring(white_color.g) .. ", b=" .. tostring(white_color.b))

    -- Test all color constants
    local colors = {
        {name = "Red", color = COLOR_RED},
        {name = "Green", color = COLOR_GREEN},
        {name = "Blue", color = COLOR_BLUE},
        {name = "White", color = COLOR_WHITE},
        {name = "Black", color = COLOR_BLACK}
    }

    for _, color_data in ipairs(colors) do
        local color = color_data.color
        LOG_INFO(color_data.name .. " color: " ..
                "r=" .. tostring(color.r) ..
                ", g=" .. tostring(color.g) ..
                ", b=" .. tostring(color.b))
    end
end

local function test_advanced_math()
    -- Test advanced mathematical calculations
    local radius = 5.0
    local area = CIRCLE_AREA(radius)
    local volume = SPHERE_VOLUME(radius)

    LOG_INFO("Circle area (r=" .. tostring(radius) .. "): " .. tostring(area))
    LOG_INFO("Sphere volume (r=" .. tostring(radius) .. "): " .. tostring(volume))

    -- Test angle calculations
    local angle_degrees = 45.0
    local angle_radians = DEGREES_TO_RADIANS(angle_degrees)
    LOG_INFO("45 degrees = " .. tostring(angle_radians) .. " radians")

    -- Test angle clamping
    local test_angles = {0.0, PI/4, PI/2, PI, 3*PI/2, 2*PI, 2.5*PI}

    for i, angle in ipairs(test_angles) do
        local clamped = CLAMP_ANGLE(angle)
        LOG_INFO("Angle " .. tostring(angle) .. " clamped to " .. tostring(clamped))
    end
end

local function test_uuid_validation()
    -- Test UUID validation
    local valid_uuid = "550e8400-e29b-41d4-a716-446655440000"
    local invalid_uuid = INVALID_UUID

    if IS_VALID_UUID(valid_uuid) then
        LOG_INFO("Valid UUID detected correctly")
    end

    if not IS_VALID_UUID(invalid_uuid) then
        LOG_INFO("Invalid UUID detected correctly")
    end

    if not IS_VALID_UUID(nil) then
        LOG_INFO("Nil UUID handled correctly")
    end
end

local function test_table_utilities()
    -- Test table utility functions
    local test_table = {a = 1, b = 2, c = 3}
    local count = TABLE_COUNT(test_table)
    LOG_INFO("Table count: " .. tostring(count))

    -- Test table copying
    local dest_table = {}
    TABLE_COPY(test_table, dest_table)

    LOG_INFO("Copied table contents:")
    for k, v in pairs(dest_table) do
        LOG_INFO("  " .. tostring(k) .. " = " .. tostring(v))
    end

    -- Test table clearing
    TABLE_CLEAR(dest_table)
    local cleared_count = TABLE_COUNT(dest_table)
    LOG_INFO("Cleared table count: " .. tostring(cleared_count))
end

local function test_conditional_compilation()
    -- Test conditional compilation with included defines
--#if LOG_LEVEL >= 2
    DETAILED_LOG("Detailed logging is enabled")
    LOG_WARNING("This is a test warning")
    LOG_ERROR("This is a test error (not real)")
--#endif

--#ifdef ENHANCED_DEBUG
    print("Enhanced debug mode active")

    -- Additional debug information
    local pos = {x = 100, y = 200, z = 50}  -- Mock position
    local rot = {x = 0, y = 0, z = 0, w = 1}  -- Mock rotation

    DETAILED_LOG("Position: x=" .. tostring(pos.x) .. ", y=" .. tostring(pos.y) .. ", z=" .. tostring(pos.z))
    DETAILED_LOG("Rotation: x=" .. tostring(rot.x) .. ", y=" .. tostring(rot.y) .. ", z=" .. tostring(rot.z) .. ", w=" .. tostring(rot.w))
--#endif
end

local function simulate_timer_event()
    LOG_INFO("Timer event triggered")

    -- Test more included functionality with different log levels
--#if LOG_LEVEL >= 1
    LOG_INFO("Log level 1 or higher - showing basic info")
--#endif

--#if LOG_LEVEL >= 2
    DETAILED_LOG("Log level 2 or higher - showing detailed info")
--#endif

--#if LOG_LEVEL >= 3
    LOG_INFO("Log level 3 - maximum verbosity")
--#endif

    -- Test mathematical operations in timer context
    local test_values = {-5.5, -2.0, 0.0, 3.7, 10.9}

    for i, val in ipairs(test_values) do
        local sign_result = SIGN(val)
        local rounded_result = ROUND(val)
        local squared_result = SQUARE(val)

        local result_msg = "Value: " .. tostring(val) ..
                          ", Sign: " .. tostring(sign_result) ..
                          ", Rounded: " .. tostring(rounded_result) ..
                          ", Squared: " .. tostring(squared_result)

        DETAILED_LOG(result_msg)
    end
end

local function simulate_touch_event(total_number, toucher_data)
    local toucher_id = toucher_data and toucher_data.id or INVALID_UUID

    if IS_VALID_UUID(toucher_id) then
        local name = toucher_data.name or "Unknown"
        LOG_INFO("Valid touch from: " .. name)

        -- Use included channel constants
        print("PUBLIC_CHANNEL message: Hello " .. name .. "!")

--#ifdef ENHANCED_DEBUG
        local touch_pos = toucher_data.position or {x = 0, y = 0, z = 0}
        DETAILED_LOG("Touch position: x=" .. tostring(touch_pos.x) .. ", y=" .. tostring(touch_pos.y) .. ", z=" .. tostring(touch_pos.z))

        -- Calculate distance using mathematical functions
        local obj_pos = {x = 100, y = 100, z = 50}  -- Mock object position
        local dx = touch_pos.x - obj_pos.x
        local dy = touch_pos.y - obj_pos.y
        local dz = touch_pos.z - obj_pos.z
        local distance = math.sqrt(dx*dx + dy*dy + dz*dz)
        DETAILED_LOG("Touch distance: " .. tostring(distance))
--#endif
    else
        LOG_ERROR("Invalid toucher ID detected")
    end

    -- Test mathematical calculations with touch count
    local touch_squared = SQUARE(total_number)
    local touch_sign = SIGN(total_number - 2)  -- Will be positive if more than 2 touches

    LOG_INFO("Touches: " .. tostring(total_number) ..
            ", squared: " .. tostring(touch_squared) ..
            ", sign(touches-2): " .. tostring(touch_sign))
end

local function simulate_message_event(channel, name, id, message)
    if channel == DEBUG_CHANNEL then
        LOG_INFO("Debug message received: " .. message)

        if message == "test_math" then
            -- Perform comprehensive math test using included functions
            local test_values = {-5.5, -2.0, 0.0, 3.7, 10.9}

            for i, val in ipairs(test_values) do
                local sign_result = SIGN(val)
                local rounded_result = ROUND(val)
                local squared_result = SQUARE(val)

                local result_msg = "Value: " .. tostring(val) ..
                                  ", Sign: " .. tostring(sign_result) ..
                                  ", Rounded: " .. tostring(rounded_result) ..
                                  ", Squared: " .. tostring(squared_result)

                DETAILED_LOG(result_msg)
            end
        end

        if message == "test_colors" then
            -- Test color constants
            local colors = {
                {name = "Red", color = COLOR_RED},
                {name = "Green", color = COLOR_GREEN},
                {name = "Blue", color = COLOR_BLUE},
                {name = "White", color = COLOR_WHITE},
                {name = "Black", color = COLOR_BLACK}
            }

            for _, color_data in ipairs(colors) do
                local color = color_data.color
                LOG_INFO(color_data.name .. " color: " ..
                        "r=" .. tostring(color.r) ..
                        ", g=" .. tostring(color.g) ..
                        ", b=" .. tostring(color.b))
            end
        end

        if message == "test_tables" then
            test_table_utilities()
        end
    end
end

-- Main execution
print("=== Starting Luau Include Test ===")

-- Run all tests
test_mathematical_constants()
test_utility_macros()
test_color_constants()
test_advanced_math()
test_uuid_validation()
test_table_utilities()
test_conditional_compilation()

print("\n=== Simulating Events ===")

-- Simulate timer event
simulate_timer_event()

-- Simulate touch events
simulate_touch_event(1, {
    id = "550e8400-e29b-41d4-a716-446655440000",
    name = "TestUser",
    position = {x = 95, y = 105, z = 45}
})

simulate_touch_event(3, {
    id = "660f9511-f39c-52e5-b827-557766551111",
    name = "MultiTouchUser",
    position = {x = 102, y = 98, z = 52}
})

-- Simulate message events
simulate_message_event(DEBUG_CHANNEL, "DebugUser", "test-id-1", "test_math")
simulate_message_event(DEBUG_CHANNEL, "DebugUser", "test-id-2", "test_colors")
simulate_message_event(DEBUG_CHANNEL, "DebugUser", "test-id-3", "test_tables")

print("\n=== Test Summary ===")

--#ifdef ENHANCED_DEBUG
    DETAILED_LOG("All tests completed successfully")
--#endif

--#if LOG_LEVEL >= 2
    print("Detailed test information:")
    print("  Enhanced debug: " .. tostring(ENHANCED_DEBUG))
    print("  Log level: " .. tostring(LOG_LEVEL))
    print("  Mathematical constants available: PI, E, GOLDEN_RATIO, SQRT_2")
    print("  Utility functions available: SIGN, ROUND, CEIL_DIV")
    print("  Color constants available: RED, GREEN, BLUE, WHITE, BLACK")
--#endif

--#if LOG_LEVEL >= 3
    print("Maximum verbosity information:")
    print("  All macro expansions successful")
    print("  All conditional compilations processed")
    print("  All include directives resolved")
--#endif

print("=== Luau Include Test Complete ===")
