-- Comprehensive Luau test file for preprocessor defines and conditionals
-- This file exercises all major features of the preprocessor system

-- ========== BASIC DEFINES ==========
--#define VERSION 2
--#define DEBUG_MODE true
--#define PI 3.14159265
--#define MAX_ITEMS 10
--#define OWNER_GREETING "Hello, Owner!"
--#define CHANNEL 42
--#define TIMEOUT 30.0

-- Valueless defines
--#define DEBUG
--#define PRODUCTION

-- ========== FUNCTION-LIKE MACROS ==========
-- Single parameter macros
--#define SQUARE(x) ((x) * (x))
--#define ABS(x) ((x) < 0 and -(x) or (x))
--#define TO_RADIANS(degrees) ((degrees) * PI / 180.0)
--#define LOG_DEBUG(msg) ll.Say(0, "DEBUG: " .. tostring(msg))
--#define CLAMP_01(x) ((x) < 0.0 and 0.0 or ((x) > 1.0 and 1.0 or (x)))

-- Multi-parameter macros
--#define MAX(a, b) ((a) > (b) and (a) or (b))
--#define MIN(a, b) ((a) < (b) and (a) or (b))
--#define LERP(a, b, t) ((a) + (t) * ((b) - (a)))
--#define DISTANCE_2D(x1, y1, x2, y2) math.sqrt(((x2) - (x1)) * ((x2) - (x1)) + ((y2) - (y1)) * ((y2) - (y1)))
--#define SAY_CHANNEL(ch, msg) ll.Say(ch, msg)
--#define VECTOR_ADD(v1, v2) vector((v1).X + (v2).X, (v1).Y + (v2).Y, (v1).Z + (v2).Z)

-- Nested macro definitions
--#define DOUBLE(x) ((x) * 2)
--#define QUAD(x) DOUBLE(DOUBLE(x))
--#define COMPLEX_CALC(x, y) (SQUARE(x) + SQUARE(y) + DOUBLE(MIN(x, y)))

-- Table/array helper macros
--#define TABLE_SIZE(t) #t
--#define APPEND_ITEM(t, item) table.insert(t, item)
--#define GET_FIRST(t) t[1]
--#define GET_LAST(t) t[#t]

-- ========== CONDITIONAL COMPILATION TESTS ==========

-- Test basic ifdef/endif
--#ifdef DEBUG
    --#define DEBUG_LOG(msg) ll.Say(0, "DEBUG: " .. tostring(msg))
--#endif

--#ifndef PRODUCTION
    --#define VERBOSE_LOGGING true
--#endif

-- Test if/elif/else chains
--#if VERSION == 1
    --#define API_MESSAGE "Using API Version 1.0"
    --#define FEATURE_ADVANCED false
--#elif VERSION == 2
    --#define API_MESSAGE "Using API Version 2.0"
    --#define FEATURE_ADVANCED true
--#elif VERSION >= 3
    --#define API_MESSAGE "Using Future API Version"
    --#define FEATURE_ADVANCED true
--#else
    --#define API_MESSAGE "Unknown API Version"
    --#define FEATURE_ADVANCED false
--#endif

-- Test complex conditional expressions
--#define BUILD_TYPE "debug"
--#if BUILD_TYPE == "debug" && defined(VERBOSE_LOGGING)
    --#define FULL_DEBUG true
--#else
    --#define FULL_DEBUG false
--#endif

-- Nested conditionals
--#ifdef DEBUG_MODE
    --#if VERSION >= 2
        --#define USE_NEW_DEBUG_FEATURES true
    --#else
        --#define USE_NEW_DEBUG_FEATURES false
    --#endif
--#else
    --#define USE_NEW_DEBUG_FEATURES false
--#endif

-- Platform-specific defines
--#define PLATFORM "server"
--#if PLATFORM == "server"
    --#define IS_SERVER true
    --#define IS_CLIENT false
--#elif PLATFORM == "client"
    --#define IS_SERVER false
    --#define IS_CLIENT true
--#else
    --#define IS_SERVER false
    --#define IS_CLIENT false
--#endif

-- ========== MAIN SCRIPT ==========

-- Global variables for testing
local test_data = {}
local event_count = 0

-- Main initialization function
local function initialize()
    -- Test basic define substitution
    ll.Say(0, OWNER_GREETING)
    ll.Say(0, "Version: " .. tostring(VERSION))
    ll.Say(0, API_MESSAGE)

    -- Test numeric defines
    local circumference = 2 * PI * 5.0
    ll.Say(0, "Circumference: " .. tostring(circumference))

    ll.

    -- Test function-like macros
    local value = 5
    ll.Say(0, "5 squared = " .. tostring(SQUARE(value)))
    ll.Say(0, "|-7| = " .. tostring(ABS(-7)))

    local angle_rad = TO_RADIANS(90.0)
    ll.Say(0, "90 degrees in radians = " .. tostring(angle_rad))

    -- Test multi-parameter macros
    local a = 10
    local b = 20
    ll.Say(0, "Max(10, 20) = " .. tostring(MAX(a, b)))
    ll.Say(0, "Min(10, 20) = " .. tostring(MIN(a, b)))

    local lerped = LERP(0.0, 100.0, 0.5)
    ll.Say(0, "Lerp(0, 100, 0.5) = " .. tostring(lerped))

    -- Test vector math macro (using vector)
    local v1 = vector(1.0, 2.0, 3.0)
    local v2 = vector(4.0, 5.0, 6.0)
    local result = VECTOR_ADD(v1, v2)
    ll.Say(0, "Vector addition result: " .. tostring(result))

    -- Test distance calculation
    local dist = DISTANCE_2D(0.0, 0.0, 3.0, 4.0)
    ll.Say(0, "Distance 2D: " .. tostring(dist))

    ll.AdjustDamage(Number, Damage)

    local params = ll.GetPrimitiveParams({PRIM_DESC})

    -- Test nested macros
    local nested_result = QUAD(3)
    ll.Say(0, "Quad(3) = " .. tostring(nested_result))

    local complex_result = COMPLEX_CALC(3, 4)
    ll.Say(0, "Complex calculation result: " .. tostring(complex_result))

    -- Test table helper macros
    local test_table = {"item1", "item2", "item3"}
    APPEND_ITEM(test_table, "item4")

    ll.Say(0, "Table size: " .. tostring(TABLE_SIZE(test_table)))
    ll.Say(0, "First item: " .. GET_FIRST(test_table))
    ll.Say(0, "Last item: " .. GET_LAST(test_table))

    local params = ll.GetPrimitiveParams({PRIM_DESC})

    -- Test channel communication
    SAY_CHANNEL(CHANNEL, "Hello on channel " .. tostring(CHANNEL))

    -- Test conditional compilation results
--#ifdef DEBUG_LOG
    DEBUG_LOG("Debug logging is enabled")
--#endif

--#ifdef VERBOSE_LOGGING
    ll.Say(0, "Verbose logging is enabled")
--#endif

--#if FEATURE_ADVANCED
    ll.Say(0, "Advanced features are available")

    -- Advanced feature code
    local advanced_items = {}
    for i = 1, MAX_ITEMS do
        APPEND_ITEM(advanced_items, "Advanced Item " .. tostring(i))
    end
    ll.Say(0, "Created " .. tostring(TABLE_SIZE(advanced_items)) .. " advanced items")
--#else
    ll.Say(0, "Basic features only")
--#endif

--#if FULL_DEBUG
    ll.Say(0, "Full debug mode activated")
    ll.Say(0, "Build type: " .. BUILD_TYPE)
--#endif

--#if USE_NEW_DEBUG_FEATURES
    ll.Say(0, "Using new debug features for version " .. tostring(VERSION))
--#else
    ll.Say(0, "Using legacy debug features")
--#endif

--#if IS_SERVER
    ll.Say(0, "Running in server mode")
--#elif IS_CLIENT
    ll.Say(0, "Running in client mode")
--#else
    ll.Say(0, "Running in unknown platform mode")
--#endif

    -- Test clamping macro
    local test_val = 1.5
    local clamped = CLAMP_01(test_val)
    ll.Say(0, "Clamped " .. tostring(test_val) .. " to " .. tostring(clamped))
end

-- Event handler simulation
local function on_event(event_type, data)
    event_count = event_count + 1

    -- Test macros in event handlers
    LOG_DEBUG("Event detected: " .. event_type .. " (count: " .. tostring(event_count) .. ")")

    local event_squared = SQUARE(event_count)
    ll.Say(0, "Event count squared: " .. tostring(event_squared))

--#ifndef PRODUCTION
    ll.Say(0, "Development event handler active")

    -- Development-only event features
    if data and data.name then
        SAY_CHANNEL(0, "Event triggered by: " .. data.name)

--#if FEATURE_ADVANCED
        if data.position then
            local current_pos = {x = 0, y = 0}  -- Mock current position
            local event_distance = DISTANCE_2D(data.position.x, data.position.y, current_pos.x, current_pos.y)
            ll.Say(0, "Event distance: " .. tostring(event_distance))
        end
--#endif
    end
--#endif
end

-- Timer simulation function
local function on_timer()
    ll.Say(0, "Timer event triggered")

    -- Test more complex macro usage in timer
    local pos = {x = 0, y = 0}  -- Mock position
    local target = {x = pos.x + 10.0, y = pos.y + 0.0}

    local distance = DISTANCE_2D(pos.x, pos.y, target.x, target.y)
    ll.Say(0, "Distance to target: " .. tostring(distance))

--#if VERSION >= 2
    -- Version 2+ specific features
    ll.Say(0, "Executing version 2+ timer code")

    local max_val = MAX(SQUARE(5), ABS(-30))
    ll.Say(0, "Max of 25 and 30 = " .. tostring(max_val))
--#endif

--#ifdef DEBUG
    ll.Say(0, "Timer event processed in debug mode")
--#endif
end

-- Message handler simulation
local function on_message(channel, name, id, message)
    -- Test conditional compilation in message events
--#if CHANNEL == 42
    if channel == CHANNEL then
        ll.Say(0, "Received message on configured channel: " .. message)

        -- Test macro in string processing
        if message == "test" then
            local test_result = COMPLEX_CALC(2, 3)
            SAY_CHANNEL(channel, "Test result: " .. tostring(test_result))
        end
    end
--#endif

--#ifdef DEBUG_MODE
    LOG_DEBUG("Message event - Channel: " .. tostring(channel) .. ", Message: " .. message)
--#endif
end

-- State machine simulation
local current_state = "default"

local function change_state(new_state)
    ll.Say(0, "Changing state from " .. current_state .. " to " .. new_state)
    current_state = new_state

    if new_state == "test_state" then
        ll.Say(0, "Entered test state")

        -- Test that macros work in different states
        local state_test = DOUBLE(21)  -- Should be 42
        ll.Say(0, "State test result: " .. tostring(state_test))

--#if VERSION == 2
        ll.Say(0, "Version 2 test state functionality")
--#else
        ll.Say(0, "Legacy test state functionality")
--#endif

--#ifdef DEBUG
        LOG_DEBUG("Test state entered")
--#endif
    end
end

-- Advanced testing functions
local function test_nested_conditionals()
    ll.Say(0, "Testing nested conditionals...")

--#ifdef DEBUG_MODE
    --#if VERSION >= 2
        --#ifdef FEATURE_ADVANCED
            ll.Say(0, "All debug features active")
        --#else
            ll.Say(0, "Basic debug features only")
        --#endif
    --#else
        ll.Say(0, "Legacy debug mode")
    --#endif
--#else
    ll.Say(0, "Debug disabled")
--#endif
end

local function test_macro_edge_cases()
    ll.Say(0, "Testing macro edge cases...")

    -- Test macro with complex expressions
    local edge_case_1 = COMPLEX_CALC(DOUBLE(2), ABS(-3))
    ll.Say(0, "Edge case 1 result: " .. tostring(edge_case_1))

    -- Test macro chaining
    local chain_result = MAX(MIN(10, 20), ABS(-5))
    ll.Say(0, "Chained macro result: " .. tostring(chain_result))

    -- Test macro with string concatenation
    local concat_test = "Result: " .. tostring(SQUARE(4))
    ll.Say(0, "Concatenation test: " .. concat_test)

    -- Test conditional within macro usage
--#if FEATURE_ADVANCED
    local advanced_calc = LERP(0, 100, CLAMP_01(1.5))
    ll.Say(0, "Advanced calculation: " .. tostring(advanced_calc))
--#endif
end

-- Platform-specific functionality
local function platform_specific_test()
--#if IS_SERVER
    ll.Say(0, "Executing server-specific code")

    -- Server-only functionality
    local server_data = {}
    for i = 1, MAX_ITEMS do
        APPEND_ITEM(server_data, "Server Item " .. tostring(i))
    end

    ll.Say(0, "Server data size: " .. tostring(TABLE_SIZE(server_data)))

--#elif IS_CLIENT
    ll.Say(0, "Executing client-specific code")

    -- Client-only functionality
    local client_pos = vector(1, 2, 3)
    local offset = vector(DOUBLE(1), SQUARE(2), ABS(-3))
    local final_pos = VECTOR_ADD(client_pos, offset)

    ll.Say(0, "Final client position: " .. tostring(final_pos))
--#endif
end

-- Main execution
ll.Say(0, "=== Starting Luau Preprocessor Test ===")

initialize()

ll.Say(0, "\n=== Running Event Tests ===")
on_event("test_event", {name = "TestUser", position = {x = 5, y = 12}})
on_timer()
on_message(CHANNEL, "TestUser", "test-id", "test")

ll.Say(0, "\n=== Running State Tests ===")
change_state("test_state")
change_state("default")

ll.Say(0, "\n=== Running Advanced Tests ===")
test_nested_conditionals()
test_macro_edge_cases()
platform_specific_test()

ll.Say(0, "\n=== Test Summary ===")
ll.Say(0, "Total events processed: " .. tostring(event_count))
ll.Say(0, "Current state: " .. current_state)

--#ifdef DEBUG
    DEBUG_LOG("All tests completed successfully")
--#endif

--#if FULL_DEBUG
    ll.Say(0, "Full debug information:")
    ll.Say(0, "  Version: " .. tostring(VERSION))
    ll.Say(0, "  Debug mode: " .. tostring(DEBUG_MODE))
    ll.Say(0, "  Advanced features: " .. tostring(FEATURE_ADVANCED))
    ll.Say(0, "  Platform: " .. PLATFORM)
--#endif

ll.Say(0, "=== Luau Preprocessor Test Complete ===")
