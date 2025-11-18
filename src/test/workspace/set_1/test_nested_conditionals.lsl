// Test nested conditionals with macro expansion
#define FEATURE_A
#define FEATURE_B
#define LEVEL 3

#ifdef FEATURE_A
    #ifdef FEATURE_B
        #if LEVEL > 2
            #define MODE "advanced"
        #else
            #define MODE "intermediate"
        #endif
    #else
        #define MODE "basic"
    #endif
#else
    #define MODE "disabled"
#endif

default
{
    state_entry()
    {
        llOwnerSay("Mode: " + MODE);

#if defined(FEATURE_A) && defined(FEATURE_B)
        llOwnerSay("Both features enabled");
#elif defined(FEATURE_A)
        llOwnerSay("Only feature A enabled");
#else
        llOwnerSay("No features enabled");
#endif

#if LEVEL == 1
        llOwnerSay("Level 1");
#elif LEVEL == 2
        llOwnerSay("Level 2");
#elif LEVEL >= 3
        llOwnerSay("Level 3 or higher");
#else
        llOwnerSay("Unknown level");
#endif
    }
}
