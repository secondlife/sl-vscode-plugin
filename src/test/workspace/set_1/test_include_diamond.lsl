// Test diamond dependency A -> B,C where B -> C
#include "include/helper.lsl"
#include "include/common.lsl"

default {
    state_entry() {
        // common.lsl should only be included once due to include guards in helper.lsl
        float sum = add(10.0, 20.0);
        llSay(0, formatNumber(sum));
    }
}
