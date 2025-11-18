// Test multiple includes with include guards
#include "include/math.lsl"
#include "include/common.lsl"

default {
    state_entry() {
        float radius = 5.0;
        float area = PI * square(radius);
        float perimeter = 2.0 * PI * radius;

        llSay(0, "Area: " + (string)area);
        llSay(0, "Perimeter: " + (string)perimeter);
    }
}
