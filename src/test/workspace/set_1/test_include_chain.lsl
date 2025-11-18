// Test simple include chain A -> B -> C
#include "include/helper.lsl"

default {
    state_entry() {
        float result = add(5.0, 3.0);
        llSay(0, formatNumber(result));
    }
}
