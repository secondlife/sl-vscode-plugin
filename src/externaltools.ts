/**
 * @file externaltools.ts
 * Runs user-configured external tool steps during the script save pipeline.
 * Tools can be inserted before or after the preprocessor step.
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ConfigInterface, ConfigKey } from "./interfaces/configinterface";
import { ScriptLanguage } from "./shared/languageservice";
import { logError, logInfo, logWarning } from "./utils";

// ============================================================
// Types
// ============================================================

/** When in the save pipeline this step should be invoked. */
export type ExternalToolTrigger = "beforePreprocessor" | "afterPreprocessor";

/** How the tool receives its input content. */
export type ExternalToolInput = "file" | "stdin";

/** How the tool returns its output content. */
export type ExternalToolOutput = "stdout" | "file";

/**
 * A single external tool step, as configured by the user in settings.
 */
export interface ExternalToolStep {
    /** Shell command to execute. Supports {inputFile} and {outputFile} tokens. */
    command: string;
    /** When to run: before or after the preprocessor. Default: "afterPreprocessor". */
    trigger?: ExternalToolTrigger;
    /** How to deliver content to the tool. Default: "stdin". */
    input?: ExternalToolInput;
    /** How to collect output from the tool. Default: "stdout". */
    output?: ExternalToolOutput;
    /** Optional list of languages this step applies to. Omit to apply to all. */
    languages?: ScriptLanguage[];
    /** Timeout in milliseconds before the tool process is killed. Default: 10000. */
    timeoutMs?: number;
}

// ============================================================
// Runner
// ============================================================

export class ExternalToolRunner {

    private readonly config: ConfigInterface;

    constructor(config: ConfigInterface) {
        this.config = config;
    }

    public async runSteps(
        content: string,
        language: ScriptLanguage,
        trigger: ExternalToolTrigger,
    ): Promise<string> {
        const allSteps = this.config.getConfig<ExternalToolStep[]>(ConfigKey.ExternalToolingSteps, []);
        if (!allSteps || allSteps.length === 0) return content;

        const matchingSteps = allSteps.filter(step => {
            const stepTrigger: ExternalToolTrigger = step.trigger ?? "afterPreprocessor";
            if (stepTrigger !== trigger) return false;
            if (step.languages && step.languages.length > 0) {
                return step.languages.includes(language);
            }
            return true;
        });

        let current = content;
        for (const step of matchingSteps) {
            try {
                current = await this.runSingleStep(current, step);
            } catch (err) {
                logError(`[ExternalTools] Step failed ("${step.command}"): ${err}`);
            }
        }
        return current;
    }

    private async runSingleStep(content: string, step: ExternalToolStep): Promise<string> {
        const inputMode:  ExternalToolInput  = step.input  ?? "stdin";
        const outputMode: ExternalToolOutput = step.output ?? "stdout";
        const timeoutMs = step.timeoutMs ?? 10_000;

        const tmpDir = os.tmpdir();
        const inputFile  = path.join(tmpDir, `sl-ext-in-${process.pid}-${Date.now()}.tmp`);
        const outputFile = path.join(tmpDir, `sl-ext-out-${process.pid}-${Date.now()}.tmp`);

        try {
            if (inputMode === "file") {
                fs.writeFileSync(inputFile, content, "utf8");
            }

            let cmd = step.command;
            cmd = cmd.replace(/\{inputFile\}/g, inputFile);
            cmd = cmd.replace(/\{outputFile\}/g, outputFile);

            logInfo(`[ExternalTools] Running: ${cmd}`);

            const result = await this.exec(cmd, inputMode === "stdin" ? content : undefined, timeoutMs);

            if (result.exitCode !== 0) {
                logWarning(`[ExternalTools] Non-zero exit (${result.exitCode}) from: ${cmd}`);
                if (result.stderr) {
                    logWarning(`[ExternalTools] stderr: ${result.stderr.trim()}`);
                }
                throw new Error(`Tool exited with code ${result.exitCode}`);
            }

            if (outputMode === "file") {
                if (!fs.existsSync(outputFile)) {
                    throw new Error(`Tool did not produce output file: ${outputFile}`);
                }
                return fs.readFileSync(outputFile, "utf8");
            } else {
                if (result.stdout.length === 0) {
                    logWarning(`[ExternalTools] Tool produced empty stdout, keeping original content.`);
                    return content;
                }
                return result.stdout;
            }

        } finally {
            for (const f of [inputFile, outputFile]) {
                try { if (fs.existsSync(f)) { fs.unlinkSync(f); } } catch { /* ignore */ }
            }
        }
    }

    private exec(
        cmd: string,
        stdin: string | undefined,
        timeoutMs: number,
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        return new Promise((resolve, reject) => {
            const child = cp.exec(cmd, { timeout: timeoutMs }, (error, stdout, stderr) => {
                if (error && error.killed) {
                    reject(new Error(`Tool timed out after ${timeoutMs}ms`));
                    return;
                }
                resolve({
                    stdout,
                    stderr,
                    exitCode: error?.code ?? 0,
                });
            });

            if (stdin !== undefined && child.stdin) {
                child.stdin.write(stdin);
                child.stdin.end();
            }
        });
    }
}
