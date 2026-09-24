/**
 * @file preprocessor-trace.test.ts
 * Tests for preprocessor TRACE logging: the entry breadcrumb in handleDirective,
 * the shouldInclude outcome logging for conditionals, the #define symbol/value
 * echo, the structural (non-boolean) logging for #switch, macro expansion
 * logging (including nested expansions), and the nested-parser config threading
 * fix that lets all of this work inside #include'd files.
 */

import * as assert from 'assert';
import {
    LexingPreprocessor,
    PreprocessorOptions,
    PreprocessorLogger,
    ScriptLanguage,
    getLanguageConfig,
    filePathToStringUri,
} from '#sl-script-preprocessor';
import { createMockHostWithFiles, MockFileSystem } from './helpers/mockHost';

function createRecordingLogger(): PreprocessorLogger & { lines: string[] } {
    const lines: string[] = [];
    const capture = (m: string | (() => string)): void => {
        lines.push(typeof m === 'function' ? m() : m);
    };
    return { lines, trace: capture, debug: capture, info: capture, warn: capture, error: capture };
}

function createOptions(language: ScriptLanguage, logger?: PreprocessorLogger): PreprocessorOptions {
    return {
        enabled: true,
        language,
        flags: {
            generateWarnings: false,
            generateDecls: false,
        },
        include: {
            paths: ['.'],
            maxDepth: 10,
        },
        logger,
    };
}

suite('Preprocessor Trace Logging Tests', () => {
    const testFile = filePathToStringUri('/test/main.lsl');
    const lslLanguageConfig = getLanguageConfig('lsl');

    test('plain script with no directives or macros produces no trace lines', async () => {
        const logger = createRecordingLogger();
        const host = createMockHostWithFiles(new Map());
        const preprocessor = new LexingPreprocessor(host, createOptions('lsl', logger));

        const source = `integer x = 42;\nstring s = "hello";`;
        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

        assert.ok(result.success);
        assert.strictEqual(logger.lines.filter(l => l.includes('[PARSER]') || l.includes('[MACRO]')).length, 0);
    });

    test('#define echoes the macro name and its replacement text', async () => {
        const logger = createRecordingLogger();
        const host = createMockHostWithFiles(new Map());
        const preprocessor = new LexingPreprocessor(host, createOptions('lsl', logger));

        const source = `#define PI 3.14159\nfloat area = PI;`;
        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

        assert.ok(result.success);
        const defineOutcome = logger.lines.find(l => l.startsWith('[PARSER] #define'));
        assert.ok(defineOutcome);
        assert.ok(defineOutcome!.includes('PI'));
        assert.ok(defineOutcome!.includes('"3.14159"'));
    });

    test('function-like #define echoes its parameter list', async () => {
        const logger = createRecordingLogger();
        const host = createMockHostWithFiles(new Map());
        const preprocessor = new LexingPreprocessor(host, createOptions('lsl', logger));

        const source = `#define MAX(a, b) ((a) > (b) ? (a) : (b))\ninteger m = MAX(1, 2);`;
        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

        assert.ok(result.success);
        const defineOutcome = logger.lines.find(l => l.startsWith('[PARSER] #define'));
        assert.ok(defineOutcome);
        assert.ok(defineOutcome!.includes('MAX(a, b)'));
    });

    test('#ifdef/#else/#endif chain logs one breadcrumb and a matching outcome per directive', async () => {
        const logger = createRecordingLogger();
        const host = createMockHostWithFiles(new Map());
        const preprocessor = new LexingPreprocessor(host, createOptions('lsl', logger));

        const source = `#define DEBUG_MODE 1
#ifdef DEBUG_MODE
integer x = 1;
#else
integer x = 0;
#endif
`;
        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

        assert.ok(result.success);
        assert.ok(result.content.includes('integer x = 1;'));
        assert.ok(!result.content.includes('integer x = 0;'));

        // #define, #ifdef, #else, #endif: one breadcrumb each
        const breadcrumbs = logger.lines.filter(l => l.startsWith('[PARSER] directive'));
        assert.strictEqual(breadcrumbs.length, 4);

        const ifdefOutcome = logger.lines.find(l => l.startsWith('[PARSER] #ifdef'));
        assert.ok(ifdefOutcome);
        assert.ok(ifdefOutcome!.endsWith('-> true'));

        const elseOutcome = logger.lines.find(l => l.startsWith('[PARSER] #else'));
        assert.ok(elseOutcome);
        assert.ok(elseOutcome!.endsWith('-> false'));
    });

    test('#include propagates trace logging into the included file', async () => {
        const logger = createRecordingLogger();
        const includedUri = filePathToStringUri('/test/included.lsl');
        const files: MockFileSystem = new Map([
            [includedUri, `#ifdef FOO\ninteger y = 1;\n#endif\n`],
        ]);
        const host = createMockHostWithFiles(files);
        const preprocessor = new LexingPreprocessor(host, createOptions('lsl', logger));

        const source = `#include "included.lsl"\ninteger x = 0;`;
        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

        assert.ok(result.success);

        // Regression guard for the Phase A nested-parser config fix: without it,
        // this directive inside the included file would never trace anything.
        const includedBreadcrumb = logger.lines.find(l =>
            l.startsWith('[PARSER] directive #ifdef') && l.includes(includedUri));
        assert.ok(includedBreadcrumb, 'expected a trace line for the #ifdef inside the included file');
    });

    test('nested macro expansion logs the inner macro before the outer one, both with resolved values', async () => {
        const logger = createRecordingLogger();
        const host = createMockHostWithFiles(new Map());
        const preprocessor = new LexingPreprocessor(host, createOptions('lsl', logger));

        const source = `#define A 1
#define B A
integer x = B;
`;
        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

        assert.ok(result.success);
        assert.ok(result.content.includes('integer x = 1;'));

        const expandLines = logger.lines.filter(l => l.startsWith('[MACRO] expand'));
        const innerIndex = expandLines.findIndex(l => l.startsWith('[MACRO] expand A'));
        const outerIndex = expandLines.findIndex(l => l.startsWith('[MACRO] expand B'));

        assert.notStrictEqual(innerIndex, -1, 'expected a trace line for the nested A expansion');
        assert.notStrictEqual(outerIndex, -1, 'expected a trace line for the outer B expansion');
        assert.ok(innerIndex < outerIndex, 'nested macro A should log before outer macro B');
        assert.ok(expandLines[innerIndex].endsWith('-> "1"'));
        // B's logged value already reflects A's expansion, not the raw "A" body text
        assert.ok(expandLines[outerIndex].endsWith('-> "1"'));
    });

    test('logger without a trace method is safely ignored', async () => {
        const host = createMockHostWithFiles(new Map());
        const preprocessor = new LexingPreprocessor(host, createOptions('lsl', { debug: (): void => {} }));

        const source = `#define X 1\ninteger x = X;`;
        await assert.doesNotReject(() => preprocessor.process(source, testFile, lslLanguageConfig));
    });

    test('each directive triggers exactly the expected number of trace calls', async () => {
        let callCount = 0;
        const host = createMockHostWithFiles(new Map());
        const preprocessor = new LexingPreprocessor(host, createOptions('lsl', { trace: (): void => { callCount++; } }));

        const source = `#define X 1\n#ifdef X\ninteger x = 1;\n#endif\n`;
        await preprocessor.process(source, testFile, lslLanguageConfig);

        // #define: breadcrumb + outcome (2). #ifdef: breadcrumb + outcome (2).
        // #endif: breadcrumb + outcome (2). No macro usage in this source.
        assert.strictEqual(callCount, 6);
    });

    test('#switch logs case count and default presence, with no boolean result', async () => {
        const logger = createRecordingLogger();
        const switchLanguageConfig = getLanguageConfig('lsl');
        switchLanguageConfig.directiveKeywords.push('switch');
        const host = createMockHostWithFiles(new Map());
        const preprocessor = new LexingPreprocessor(host, createOptions('lsl', logger));

        const source = `switch(a) {
    case 1: {
        integer x = 1;
        break;
    }
    default: {
        integer x = 0;
        break;
    }
}`;
        const result = await preprocessor.process(source, testFile, switchLanguageConfig);

        assert.ok(result.success);
        const switchLine = logger.lines.find(l => l.startsWith('[PARSER] #switch'));
        assert.ok(switchLine);
        assert.ok(switchLine!.includes('2 case(s) + default'));
        assert.ok(!switchLine!.includes('->'));
    });
});
