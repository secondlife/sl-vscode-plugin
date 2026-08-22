/**
 * @file parse-line-mappings.test.ts
 * Tests for parsing line mappings from @line directives
 */

import * as assert from 'assert';
import { LineMapper, LineMapping } from '../../shared/linemapper';
import { filePathToStringUri, StringUri } from '../../interfaces/hostinterface';
import { createMockHost } from './helpers/mockHost';
import { expectMapping, expectMappings } from './helpers/expectMapping';

suite('Parse Line Mappings Tests', () => {
    // Helper function to create a mock URI
    const np = (p: string): ReturnType<typeof filePathToStringUri> => filePathToStringUri(p);

    test('should parse LSL @line directives correctly', () => {
        const content = `// Processed by Second Life Script Preprocessor
// Language: LSL
// @ define: DEBUG=1
// @line 0 "file:///path/to/main.lsl"
some code here
more code
// @line 5 "file:///path/to/include.lsl"
included content
another line
// @line 10 "file:///path/to/main.lsl"
back to main file`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "lsl", createMockHost());

        expectMappings(mappings, [
            [5, 0, np('/path/to/main.lsl')],
            [8, 5, np('/path/to/include.lsl')],
            [11, 10, np('/path/to/main.lsl')]
        ]);
    });

    test('should parse Luau @line directives correctly', () => {
        const content = `-- Processed by Second Life Script Preprocessor
-- Language: LUAU
-- @ define: DEBUG=1
-- @line 0 "file:///path/to/main.luau"
local x = 1
print(x)
-- @line 3 "file:///path/to/helper.luau"
local function helper()
    return true
end
-- @line 7 "file:///path/to/main.luau"
local result = helper()`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "luau", createMockHost());

        expectMappings(mappings, [
            [5, 0, np('/path/to/main.luau')],
            [8, 3, np('/path/to/helper.luau')],
            [12, 7, np('/path/to/main.luau')]
        ]);
    });

    test('should handle content with no @line directives', () => {
        const content = `// Regular code without line directives
some code here
more code here`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "lsl", createMockHost());

        assert.strictEqual(mappings.length, 0);
    });

    test('should handle malformed @line directives gracefully', () => {
        const content = `// Good directive
// @line 5 "file:///path/to/file.lsl"
// Malformed directives
// @line invalid "/path/to/file.lsl"
// @line 10
// @line 15 "unclosed quote
// @line 20 "file:///valid/again.lsl"
code here`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "lsl", createMockHost());

        // Should only parse the valid directives
        expectMappings(mappings, [
            [3, 5, np('/path/to/file.lsl')],
            [8, 20, np('/valid/again.lsl')]
        ]);
    });

    test('should handle mixed case and whitespace variations', () => {
        const content = `   // @line    1   "file:///path/to/file.lsl"
//  @LINE 5 "/another/file.lsl"
	// @line	10	"file:///tabs/file.lsl"
// @Line 15 "/mixed/case.lsl"`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "lsl", createMockHost());

        // Parsing is case-sensitive, only '// @line' matches exactly (not '@LINE' or '@Line')
        expectMappings(mappings, [
            [2, 1, np('/path/to/file.lsl')],
            [4, 10, np('/tabs/file.lsl')]
        ]);
    });

    test('should default to LSL when no language specified', () => {
        const content = `// @line 1 "file:///path/to/file.lsl"
some code`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "lsl", createMockHost());

        expectMappings(mappings, [
            [2, 1, np('/path/to/file.lsl')]
        ]);
    });
});
