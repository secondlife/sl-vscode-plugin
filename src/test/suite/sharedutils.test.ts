import * as assert from "assert";
import { sanitiseSegment, uniqueInDirectory } from "../../shared/sharedutils";

suite("Shared utilities path safety", () => {
    test("replaces filesystem-invalid and control characters", () => {
        assert.strictEqual(sanitiseSegment("a/b:c*d?e"), "a_b_c_d_e");
        assert.strictEqual(sanitiseSegment("a\x01b"), "a_b");
    });

    test("trims whitespace and trailing dots", () => {
        assert.strictEqual(sanitiseSegment("  name..  "), "name");
    });

    test("uses unnamed for an empty sanitized segment", () => {
        assert.strictEqual(sanitiseSegment("   "), "unnamed");
        assert.strictEqual(sanitiseSegment("..."), "unnamed");
    });

    test("prefixes exact Windows device names", () => {
        assert.strictEqual(sanitiseSegment("CON"), "_CON");
        assert.strictEqual(sanitiseSegment("com3"), "_com3");
    });

    test("preserves reserved names with extensions", () => {
        assert.strictEqual(sanitiseSegment("NUL.lsl"), "NUL.lsl");
    });

    test("truncates long segments while preserving extensions", () => {
        const longName = `${"a".repeat(130)}.luau`;
        const result = sanitiseSegment(longName);
        assert.strictEqual(result.endsWith(".luau"), true);
        assert.strictEqual(result.length, 120);
    });

    test("counts Unicode characters when truncating", () => {
        const longName = `${"\u00e9".repeat(130)}.lsl`;
        const result = sanitiseSegment(longName);
        assert.strictEqual(Array.from(result).length, 120);
    });

    test("returns an available name unchanged", () => {
        assert.strictEqual(uniqueInDirectory("script.lsl", new Set()), "script.lsl");
    });

    test("resolves case-insensitive collisions with stable suffixes", () => {
        const taken = new Set(["Door.lsl"]);
        assert.strictEqual(uniqueInDirectory("door.lsl", taken), "door_2.lsl");
    });

    test("reserves suffix space while resolving a truncated collision", () => {
        const longName = `${"a".repeat(130)}.luau`;
        const first = sanitiseSegment(longName);
        const taken = new Set([first]);
        const second = uniqueInDirectory(longName, taken);
        assert.notStrictEqual(second, first);
        assert.strictEqual(second.endsWith(".luau"), true);
        assert.strictEqual(second.length, 120);
    });
});
