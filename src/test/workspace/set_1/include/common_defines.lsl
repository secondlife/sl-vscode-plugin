// Common defines for LSL testing
// This file should be included by other LSL test files

// Mathematical constants
#define E 2.71828182845904523536
#define GOLDEN_RATIO 1.61803398874989484820
#define SQRT_2 1.41421356237309504880

// Common utility macros
#define SIGN(x) (((x) > 0) - ((x) < 0))
#define ROUND(x) ((integer)((x) + 0.5))
#define CEIL_DIV(a, b) (((a) + (b) - 1) / (b))
#define SQUARE(x) ((x) * (x))

// Color constants (as vectors)
#define COLOR_RED <1.0, 0.0, 0.0>
#define COLOR_GREEN <0.0, 1.0, 0.0>
#define COLOR_BLUE <0.0, 0.0, 1.0>
#define COLOR_WHITE <1.0, 1.0, 1.0>
#define COLOR_BLACK <0.0, 0.0, 0.0>

// Common LSL constants
#define INVALID_KEY "00000000-0000-0000-0000-000000000000"
#define PUBLIC_CHANNEL 0
#define DEBUG_CHANNEL -999

// Utility functions
#define IS_VALID_KEY(k) ((k) != INVALID_KEY && (k) != NULL_KEY)
#define LOG_ERROR(msg) llOwnerSay("ERROR: " + (string)(msg))
#define LOG_WARNING(msg) llOwnerSay("WARNING: " + (string)(msg))
#define LOG_INFO(msg) llOwnerSay("INFO: " + (string)(msg))
