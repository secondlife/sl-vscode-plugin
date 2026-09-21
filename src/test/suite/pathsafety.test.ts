import * as assert from "assert";
import { sanitiseSegment, uniqueInDirectory } from "../../shared/pathsafety";

suite("Path Safety Test Suite", () => {
    test("sanitiseSegment strips reserved characters", () => {
        assert.strictEqual(sanitiseSegment("file/with\\slashes.txt"), "filewithslashes.txt");
        assert.strictEqual(sanitiseSegment("what?*<>|.txt"), "what.txt");
    });

    test("sanitiseSegment strips control characters", () => {
        assert.strictEqual(sanitiseSegment("file\x00name.txt"), "filename.txt");
        assert.strictEqual(sanitiseSegment("file\nname.txt"), "filename.txt");
    });

    test("sanitiseSegment strips trailing dots and spaces", () => {
        assert.strictEqual(sanitiseSegment("file.txt..."), "file.txt");
        assert.strictEqual(sanitiseSegment("file.txt   "), "file.txt");
        assert.strictEqual(sanitiseSegment("file.txt. . ."), "file.txt");
    });

    test("sanitiseSegment escapes Windows reserved names", () => {
        assert.strictEqual(sanitiseSegment("con"), "_con");
        assert.strictEqual(sanitiseSegment("CON"), "_CON");
        assert.strictEqual(sanitiseSegment("prn"), "_prn");
        assert.strictEqual(sanitiseSegment("com1"), "_com1");
        assert.strictEqual(sanitiseSegment("lpt9"), "_lpt9");
    });

    test("sanitiseSegment defaults to 'unnamed' if empty", () => {
        assert.strictEqual(sanitiseSegment(""), "unnamed");
        assert.strictEqual(sanitiseSegment("..."), "unnamed");
        assert.strictEqual(sanitiseSegment("   "), "unnamed");
        assert.strictEqual(sanitiseSegment("???"), "unnamed");
    });

    test("sanitiseSegment truncates to 255 characters", () => {
        const longName = "a".repeat(300);
        assert.strictEqual(sanitiseSegment(longName), "a".repeat(255));
    });

    test("uniqueInDirectory returns original if not taken", () => {
        const taken = new Set(["taken.txt"]);
        assert.strictEqual(uniqueInDirectory("new.txt", taken), "new.txt");
    });

    test("uniqueInDirectory appends numbers if taken", () => {
        const taken = new Set(["taken.txt"]);
        assert.strictEqual(uniqueInDirectory("taken.txt", taken), "taken.txt_1");

        const takenMore = new Set(["taken.txt", "taken.txt_1", "taken.txt_2"]);
        assert.strictEqual(uniqueInDirectory("taken.txt", takenMore), "taken.txt_3");
    });

    test("uniqueInDirectory handles case-insensitive collisions", () => {
        const taken = new Set(["TAKEN.txt"]);
        assert.strictEqual(uniqueInDirectory("taken.txt", taken), "taken.txt_1");
    });
});
