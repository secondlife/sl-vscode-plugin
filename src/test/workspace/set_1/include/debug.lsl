#ifndef TEST
#define TEST

#if DEBUG
debug(string stuff) {
    llOwnerSay(stuff);
}
#else
#define debug(a)
#endif

#endif
