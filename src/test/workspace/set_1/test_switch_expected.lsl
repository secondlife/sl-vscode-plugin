default {
    state_entry()
    {
        string test = "test";
        if((test) == ("test")) jump c860cf;
        jump c7b43f;
        @c860cf;
        {
            // @line 9 "file:///test/workspace/set_1/test_switch.lsl"
            llOwnerSay("Switch case matched 'test'");
            jump sfcc97;
        }
        @c7b43f;
        {
            // @line 14 "file:///test/workspace/set_1/test_switch.lsl"
            llOwnerSay("Switch case did not match");
            jump sfcc97;
        }
        @sfcc97;

        integer i;
        if((i) == (1)) jump cb2d31;
        if((i) == (2)) jump c8ba57;
        if((i) == (3)) jump ca5466;
        jump c7cb55;
        @cb2d31;
        {
            // @line 24 "file:///test/workspace/set_1/test_switch.lsl"
            llOwnerSay("1");
            // fallthrough to case 2
        }
        @c8ba57;
        {
            // @line 29 "file:///test/workspace/set_1/test_switch.lsl"
            llOwnerSay("1 or 2");
            // no fallthrough
            jump s5c77b;
        }
        @ca5466;
        {
            // @line 35 "file:///test/workspace/set_1/test_switch.lsl"
            llOwnerSay("3");
            // fallthrough to default
        }
        @c7cb55;
        {
            // @line 40 "file:///test/workspace/set_1/test_switch.lsl"
            llOwnerSay("3 or default");
        }
        @s5c77b;

        if((i) == (1)) jump cd0f56;
        if((i) == (2  // colon optional as curly brace opens next
                )) jump ccc445;
        jump cd702f;
        @cd0f56; // needs colon
        @ccc445;
        {
                llOwnerSay("x is 1 or 2");
                jump sc2783;
            }
        @cd702f;
        {
                // @line 54 "file:///test/workspace/set_1/test_switch.lsl"
            llOwnerSay("x is neither 1 nor 2");
            }
        @sc2783;
    }
}
