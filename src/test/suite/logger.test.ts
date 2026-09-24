/**
 * @file logger.test.ts
 * Tests for the pure Logger implementation in src/shared/logger.ts
 */

import * as assert from 'assert';
import { Logger, LogLevel, DEFAULT_LOG_LEVEL, logLevelName, parseLogLevel, LogSink } from '../../shared/logger';

function createRecordingSink(): LogSink & { lines: string[] }
{
    const lines: string[] = [];
    return {
        lines,
        write(line: string): void
        {
            lines.push(line);
        },
    };
}

const FIXED_DATE = new Date('2026-09-22T17:04:11.204Z');

suite('Logger Tests', () => {

    //#region parseLogLevel / logLevelName

    test('parseLogLevel accepts each level name in any case', () => {
        assert.strictEqual(parseLogLevel('ERROR'), LogLevel.Error);
        assert.strictEqual(parseLogLevel('error'), LogLevel.Error);
        assert.strictEqual(parseLogLevel('Warn'), LogLevel.Warn);
        assert.strictEqual(parseLogLevel('INFO'), LogLevel.Info);
        assert.strictEqual(parseLogLevel('debug'), LogLevel.Debug);
        assert.strictEqual(parseLogLevel('Trace'), LogLevel.Trace);
    });

    test('parseLogLevel accepts WARNING as an alias for WARN', () => {
        assert.strictEqual(parseLogLevel('WARNING'), LogLevel.Warn);
        assert.strictEqual(parseLogLevel('warning'), LogLevel.Warn);
    });

    test('parseLogLevel returns undefined for unrecognized or non-string values', () => {
        assert.strictEqual(parseLogLevel('LOUD'), undefined);
        assert.strictEqual(parseLogLevel(''), undefined);
        assert.strictEqual(parseLogLevel(undefined), undefined);
        assert.strictEqual(parseLogLevel(null), undefined);
        assert.strictEqual(parseLogLevel(42), undefined);
    });

    test('logLevelName returns the expected name for each level', () => {
        assert.strictEqual(logLevelName(LogLevel.Error), 'ERROR');
        assert.strictEqual(logLevelName(LogLevel.Warn), 'WARN');
        assert.strictEqual(logLevelName(LogLevel.Info), 'INFO');
        assert.strictEqual(logLevelName(LogLevel.Debug), 'DEBUG');
        assert.strictEqual(logLevelName(LogLevel.Trace), 'TRACE');
    });

    //#endregion

    //#region Logger level state

    test('defaults to INFO when no level is supplied', () => {
        const logger = new Logger({ sink: createRecordingSink() });
        assert.strictEqual(logger.getLevel(), DEFAULT_LOG_LEVEL);
        assert.strictEqual(logger.getLevel(), LogLevel.Info);
    });

    test('setLevel takes effect on the next call', () => {
        const sink = createRecordingSink();
        const logger = new Logger({ sink });

        logger.debug('suppressed');
        assert.strictEqual(sink.lines.length, 0);

        logger.setLevel(LogLevel.Debug);
        logger.debug('emitted');
        assert.strictEqual(sink.lines.length, 1);
    });

    //#endregion

    //#region Threshold filtering table

    const emitters: [string, LogLevel, (logger: Logger, message: string) => void][] = [
        ['error', LogLevel.Error, (logger, message): void => logger.error(message)],
        ['warn', LogLevel.Warn, (logger, message): void => logger.warn(message)],
        ['info', LogLevel.Info, (logger, message): void => logger.info(message)],
        ['debug', LogLevel.Debug, (logger, message): void => logger.debug(message)],
        ['trace', LogLevel.Trace, (logger, message): void => logger.trace(message)],
    ];

    const configuredLevels = [LogLevel.Error, LogLevel.Warn, LogLevel.Info, LogLevel.Debug, LogLevel.Trace];

    for (const configured of configuredLevels)
    {
        test(`at ${logLevelName(configured)} level, exactly the expected methods emit`, () => {
            for (const [name, level, emit] of emitters)
            {
                const sink = createRecordingSink();
                const logger = new Logger({ sink, level: configured });

                emit(logger, `${name} message`);

                const shouldEmit = level <= configured;
                assert.strictEqual(sink.lines.length, shouldEmit ? 1 : 0,
                    `${name}() at configured level ${logLevelName(configured)}`);
            }
        });
    }

    //#endregion

    //#region Deferred message construction

    test('a suppressed thunk message is never invoked', () => {
        const sink = createRecordingSink();
        const logger = new Logger({ sink, level: LogLevel.Info });
        let invoked = false;

        logger.debug(() => {
            invoked = true;
            return 'built lazily';
        });

        assert.strictEqual(invoked, false);
        assert.strictEqual(sink.lines.length, 0);
    });

    test('an enabled thunk message is invoked exactly once', () => {
        const sink = createRecordingSink();
        const logger = new Logger({ sink, level: LogLevel.Debug });
        let callCount = 0;

        logger.debug(() => {
            callCount += 1;
            return 'built lazily';
        });

        assert.strictEqual(callCount, 1);
        assert.strictEqual(sink.lines.length, 1);
    });

    //#endregion

    //#region error() detail formatting

    test('error() with an Error writes message and stack, indented', () => {
        const sink = createRecordingSink();
        const logger = new Logger({ sink, level: LogLevel.Error, now: () => FIXED_DATE });
        const err = new Error('boom');

        logger.error('failed to publish', err);

        assert.strictEqual(sink.lines.length, 3);
        assert.strictEqual(sink.lines[0], `[${FIXED_DATE.toISOString()}] ERROR: failed to publish`);
        assert.strictEqual(sink.lines[1], `  ${err.message}`);
        assert.strictEqual(sink.lines[2], `  Stack: ${err.stack}`);
    });

    test('error() with a non-Error value stringifies it and writes no stack line', () => {
        const sink = createRecordingSink();
        const logger = new Logger({ sink, level: LogLevel.Error });

        logger.error('failed', 'plain string reason');

        assert.strictEqual(sink.lines.length, 2);
        assert.strictEqual(sink.lines[1], '  plain string reason');
    });

    //#endregion

    //#region Line format

    test('line format matches [<iso>] <LEVEL>: <text> using the injected clock', () => {
        const sink = createRecordingSink();
        const logger = new Logger({ sink, level: LogLevel.Trace, now: () => FIXED_DATE });

        logger.trace('raw frame');

        assert.strictEqual(sink.lines.length, 1);
        assert.strictEqual(sink.lines[0], `[${FIXED_DATE.toISOString()}] TRACE: raw frame`);
    });

    //#endregion
});
