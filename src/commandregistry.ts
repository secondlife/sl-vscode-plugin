/**
 * @file commandregistry.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import {
    CommandErrorCode,
    CommandExecuteParams,
    CommandExecuteResponse,
    CommandInfo,
    CommandListResponse,
} from "./viewereditwsclient";

type CommandHandler = (params: Record<string, unknown>) => Promise<CommandExecuteResponse>;

export class CommandRegistry {
    private readonly commands = new Map<string, { info: CommandInfo; handler: CommandHandler }>();

    public register(info: CommandInfo, handler: CommandHandler): void {
        this.commands.set(info.command, { info, handler });
    }

    public async execute(params: CommandExecuteParams): Promise<CommandExecuteResponse> {
        const entry = this.commands.get(params.command);
        if (!entry) {
            return { success: false, error_code: CommandErrorCode.UnknownCommand, message: `Unknown command: ${params.command}` };
        }
        try {
            return await entry.handler(params.params ?? {});
        } catch (err: any) {
            return { success: false, error_code: CommandErrorCode.ExecutionError, message: err?.message ?? "Execution error" };
        }
    }

    public list(): CommandListResponse {
        return { commands: [...this.commands.values()].map(e => e.info) };
    }
}
