import * as assert from 'assert';
import { LineMapping } from '#sl-script-preprocessor';
import { StringUri } from '#sl-script-preprocessor';

/**
 * Assert that a single LineMapping matches expected values.
 */
export function expectMapping(mapping: LineMapping | undefined, processed: number, original: number, file: StringUri): void {
    assert.ok(mapping, `Expected mapping for processed line ${processed}`);
    assert.strictEqual(mapping!.processedLine, processed, 'processedLine mismatch');
    assert.strictEqual(mapping!.originalLine, original, 'originalLine mismatch');
    assert.strictEqual(mapping!.sourceFile, file, 'sourceFile mismatch');
}

/**
 * Assert multiple mappings compactly.
 * rows: Array of tuples [processedLine, originalLine, file]
 */
export function expectMappings(mappings: LineMapping[], rows: Array<[number, number, StringUri]>): void {
    assert.strictEqual(mappings.length, rows.length, `Expected ${rows.length} mappings, got ${mappings.length}`);
    for (let i = 0; i < rows.length; i++) {
        const [p, o, f] = rows[i];
        expectMapping(mappings[i], p, o, f);
    }
}
