default {
    state_entry()
    {
        string test = "test";
        switch (test)
        {
            case "test":
            {
                llOwnerSay("Switch case matched 'test'");
                break;
            }
            default:
            {
                llOwnerSay("Switch case did not match");
                break;
            }
        }

        integer i;
        switch(i)
        {
            case 1:
            {
                llOwnerSay("1");
                // fallthrough to case 2
            }
            case 2:
            {
                llOwnerSay("1 or 2");
                // no fallthrough
                break;
            }
            case 3:
            {
                llOwnerSay("3");
                // fallthrough to default
            }
            default:
            {
                llOwnerSay("3 or default");
            }
        }

        switch(i)
        {
            case 1: // needs colon
            case 2  // colon optional as curly brace opens next
                {
                    llOwnerSay("x is 1 or 2");
                    break;
                }
            default  // colon optional as curly brace opens next
                {
                    llOwnerSay("x is neither 1 nor 2");
                }
        }
    }
}
