-- Common defines for Luau testing
-- This file should be included by other Luau test files

-- Mathematical constants
--#define E 2.71828182845904523536
--#define GOLDEN_RATIO 1.61803398874989484820
--#define SQRT_2 1.41421356237309504880

-- Common utility macros
--#define SIGN(x) ((x) > 0 and 1 or ((x) < 0 and -1 or 0))
--#define ROUND(x) math.floor((x) + 0.5)
--#define CEIL_DIV(a, b) math.ceil((a) / (b))
--#define SQUARE(x) ((x) * (x))

-- Color constants (as tables)
--#define COLOR_RED {r = 1.0, g = 0.0, b = 0.0}
--#define COLOR_GREEN {r = 0.0, g = 1.0, b = 0.0}
--#define COLOR_BLUE {r = 0.0, g = 0.0, b = 1.0}
--#define COLOR_WHITE {r = 1.0, g = 1.0, b = 1.0}
--#define COLOR_BLACK {r = 0.0, g = 0.0, b = 0.0}

-- Common Luau constants
--#define INVALID_UUID "00000000-0000-0000-0000-000000000000"
--#define PUBLIC_CHANNEL 0
--#define DEBUG_CHANNEL -999

-- Utility functions
--#define IS_VALID_UUID(id) ((id) ~= INVALID_UUID and (id) ~= nil)
--#define LOG_ERROR(msg) print("ERROR: " .. tostring(msg))
--#define LOG_WARNING(msg) print("WARNING: " .. tostring(msg))
--#define LOG_INFO(msg) print("INFO: " .. tostring(msg))

-- Table utility macros
--#define TABLE_CLEAR(t) for k in pairs(t) do t[k] = nil end
--#define TABLE_COPY(src, dest) for k, v in pairs(src) do dest[k] = v end
--#define TABLE_COUNT(t) (function() local count = 0; for _ in pairs(t) do count = count + 1 end; return count end)()
