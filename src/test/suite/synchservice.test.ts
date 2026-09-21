import * as assert from "assert";
import { SynchService } from "../../synchservice";

suite("SynchService Test Suite", () => {
    test("stripEmittedMeta removes metadata block", () => {
        const input = `// ================ sl-vscode-plugin meta ================
// @file script.lsl
// @hash 12345
// @date 2026-01-01 00:00:00
// =======================================================
default {
    state_entry() {
        llOwnerSay("Hello");
    }
}`;
        const expected = `default {
    state_entry() {
        llOwnerSay("Hello");
    }
}`;
        // LSL line comment prefix is "//"
        assert.strictEqual(SynchService.stripEmittedMeta(input, "lsl"), expected);
    });

    test("stripEmittedMeta handles luau comment prefix", () => {
        const input = `-- ================ sl-vscode-plugin meta ================
-- @file script.luau
-- @hash 12345
-- @date 2026-01-01 00:00:00
-- =======================================================
print("Hello")
`;
        const expected = `print("Hello")\n`;
        // Luau line comment prefix is "--"
        assert.strictEqual(SynchService.stripEmittedMeta(input, "luau"), expected);
    });

    test("stripEmittedMeta leaves content without metadata untouched", () => {
        const input = `default {\n    state_entry() {}\n}`;
        assert.strictEqual(SynchService.stripEmittedMeta(input, "lsl"), input);
    });

    test("stripEmittedMeta only looks at the top of the file", () => {
        const input = `default {\n    state_entry() {}\n}
// ================ sl-vscode-plugin meta ================
// @file script.lsl
// =======================================================
`;
        assert.strictEqual(SynchService.stripEmittedMeta(input, "lsl"), input);
    });
});
