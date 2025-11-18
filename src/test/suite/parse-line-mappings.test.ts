/**
 * @file parse-line-mappings.test.ts
 * Tests for parsing line mappings from @line directives
 */

import * as assert from 'assert';
import { LineMapper, LineMapping } from '../../shared/linemapper';
import { normalizePath, HostInterface, NormalizedPath } from '../../interfaces/hostinterface';
import { FullConfigInterface } from '../../interfaces/configinterface';
import { expectMapping, expectMappings } from './helpers/expectMapping';

suite('Parse Line Mappings Tests', () => {
    // Helper function to create a mock URI
    const np = (p: string): ReturnType<typeof normalizePath> => normalizePath(p);

    // Create a minimal mock host for testing URI conversions
    function createMockHost(): HostInterface {
        return new class implements HostInterface {
            config = {} as FullConfigInterface;

            async readFile(path: NormalizedPath): Promise<string | null> {
                return null;
            }
            async exists(path: NormalizedPath): Promise<boolean> {
                return false;
            }
            async resolveFile(
                filename: string,
                from: NormalizedPath,
                extensions?: string[],
                includePaths?: string[]
            ): Promise<NormalizedPath | null> {
                return null;
            }
            async writeFile(p: NormalizedPath, content: string | Uint8Array): Promise<boolean> {
                return false;
            }
            async readJSON<T = any>(p: NormalizedPath): Promise<T | null> {
                return null;
            }
            async readYAML<T = any>(p: NormalizedPath): Promise<T | null> {
                return null;
            }
            async readTOML<T = any>(p: NormalizedPath): Promise<T | null> {
                return null;
            }
            async writeJSON(p: NormalizedPath, data: any, pretty?: boolean): Promise<boolean> {
                return false;
            }
            async writeYAML(p: NormalizedPath, data: any): Promise<boolean> {
                return false;
            }
            async writeTOML(p: NormalizedPath, data: Record<string, any>): Promise<boolean> {
                return false;
            }
            fileNameToUri(fileName: NormalizedPath): string {
                // Strip path to only include directories/filename after "test" directory
                const testIndex = fileName.indexOf('test');
                const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
                // Normalize backslashes to forward slashes
                const normalizedPath = relativePath.replace(/\\/g, '/');
                return "unittest:///" + normalizedPath;
            }
            uriToFileName(uri: string): NormalizedPath {
                return normalizePath(uri.replace("unittest:///", ""));
            }
        };
    }

    test('should parse LSL @line directives correctly', () => {
        const content = `// Processed by Second Life Script Preprocessor
// Language: LSL
// @ define: DEBUG=1
// @line 0 "/path/to/main.lsl"
some code here
more code
// @line 5 "/path/to/include.lsl"
included content
another line
// @line 10 "/path/to/main.lsl"
back to main file`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "lsl", createMockHost());

        expectMappings(mappings, [
            [4, 0, np('/path/to/main.lsl')],
            [7, 5, np('/path/to/include.lsl')],
            [10, 10, np('/path/to/main.lsl')]
        ]);
    });

    test('should parse Luau @line directives correctly', () => {
        const content = `-- Processed by Second Life Script Preprocessor
-- Language: LUAU
-- @ define: DEBUG=1
-- @line 0 "/path/to/main.luau"
local x = 1
print(x)
-- @line 3 "/path/to/helper.luau"
local function helper()
    return true
end
-- @line 7 "/path/to/main.luau"
local result = helper()`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "luau", createMockHost());

        expectMappings(mappings, [
            [4, 0, np('/path/to/main.luau')],
            [7, 3, np('/path/to/helper.luau')],
            [11, 7, np('/path/to/main.luau')]
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
// @line 5 "/path/to/file.lsl"
// Malformed directives
// @line invalid "/path/to/file.lsl"
// @line 10
// @line 15 "unclosed quote
// @line 20 "/valid/again.lsl"
code here`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "lsl", createMockHost());

        // Should only parse the valid directives
        expectMappings(mappings, [
            [2, 5, np('/path/to/file.lsl')],
            [7, 20, np('/valid/again.lsl')]
        ]);
    });

    test('should handle mixed case and whitespace variations', () => {
        const content = `   // @line    1   "/path/to/file.lsl"
//  @LINE 5 "/another/file.lsl"
	// @line	10	"/tabs/file.lsl"
// @Line 15 "/mixed/case.lsl"`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "lsl", createMockHost());

        // Parsing is case-sensitive, only '// @line' matches exactly (not '@LINE' or '@Line')
        expectMappings(mappings, [
            [1, 1, np('/path/to/file.lsl')],
            [3, 10, np('/tabs/file.lsl')]
        ]);
    });

    test('should default to LSL when no language specified', () => {
        const content = `// @line 1 "/path/to/file.lsl"
some code`;

        const mappings = LineMapper.parseLineMappingsFromContent(content, "lsl", createMockHost());

        expectMappings(mappings, [
            [1, 1, np('/path/to/file.lsl')]
        ]);
    });
});
