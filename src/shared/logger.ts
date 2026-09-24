/**
 * @file logger.ts
 * Copyright (C) 2026, Linden Research, Inc.
 */

/** Severity levels, ordered from most to least severe. */
export enum LogLevel
{
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
    Trace = 4,
}

export const DEFAULT_LOG_LEVEL = LogLevel.Info;

/** A message, or a thunk evaluated only if the level passes the threshold. */
export type LogMessage = string | (() => string);

/** Destination for formatted log lines. */
export interface LogSink
{
    write(line: string): void;
}

export interface LoggerOptions
{
    sink: LogSink;
    level?: LogLevel;
    /** Injectable clock; tests pass a fixed value. */
    now?: () => Date;
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.Error]: "ERROR",
    [LogLevel.Warn]: "WARN",
    [LogLevel.Info]: "INFO",
    [LogLevel.Debug]: "DEBUG",
    [LogLevel.Trace]: "TRACE",
};

export function logLevelName(level: LogLevel): string
{
    return LOG_LEVEL_NAMES[level];
}

const LOG_LEVEL_ALIASES: Record<string, LogLevel> = {
    ERROR: LogLevel.Error,
    WARN: LogLevel.Warn,
    WARNING: LogLevel.Warn,
    INFO: LogLevel.Info,
    DEBUG: LogLevel.Debug,
    TRACE: LogLevel.Trace,
};

/** Case-insensitive; accepts WARNING as an alias for WARN. Returns undefined if unrecognized. */
export function parseLogLevel(value: unknown): LogLevel | undefined
{
    if (typeof value !== "string")
    {
        return undefined;
    }

    return LOG_LEVEL_ALIASES[value.toUpperCase()];
}

export class Logger
{
    private readonly sink: LogSink;
    private readonly now: () => Date;
    private level: LogLevel;

    constructor(options: LoggerOptions)
    {
        this.sink = options.sink;
        this.now = options.now ?? ((): Date => new Date());
        this.level = options.level ?? DEFAULT_LOG_LEVEL;
    }

    public getLevel(): LogLevel
    {
        return this.level;
    }

    public setLevel(level: LogLevel): void
    {
        this.level = level;
    }

    public isEnabled(level: LogLevel): boolean
    {
        return level <= this.level;
    }

    public log(level: LogLevel, message: LogMessage, error?: unknown): void
    {
        if (!this.isEnabled(level))
        {
            return;
        }

        const text = typeof message === "function" ? message() : message;
        const timestamp = this.now().toISOString();
        this.sink.write(`[${timestamp}] ${logLevelName(level)}: ${text}`);

        if (error !== undefined)
        {
            this.writeErrorDetail(error);
        }
    }

    public error(message: LogMessage, error?: unknown): void
    {
        this.log(LogLevel.Error, message, error);
    }

    public warn(message: LogMessage): void
    {
        this.log(LogLevel.Warn, message);
    }

    public info(message: LogMessage): void
    {
        this.log(LogLevel.Info, message);
    }

    public debug(message: LogMessage): void
    {
        this.log(LogLevel.Debug, message);
    }

    public trace(message: LogMessage): void
    {
        this.log(LogLevel.Trace, message);
    }

    private writeErrorDetail(error: unknown): void
    {
        if (error instanceof Error)
        {
            this.sink.write(`  ${error.message}`);
            if (error.stack)
            {
                this.sink.write(`  Stack: ${error.stack}`);
            }
            return;
        }

        this.sink.write(`  ${String(error)}`);
    }
}
