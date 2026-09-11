/**
 * @file commandregistry.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import {
    CommandExecuteParams,
    CommandExecuteResponse,
    CommandInfo,
    CommandListResponse,
} from "./viewereditwsclient";
import { JSONRPCError } from "./websockclient";

type CommandHandler = (params: Record<string, unknown>) => Promise<CommandExecuteResponse>;

export class CommandRegistry {
    private readonly commands = new Map<string, { info: CommandInfo; handler: CommandHandler }>();

    public register(info: CommandInfo, handler: CommandHandler): void {
        this.commands.set(info.command, { info, handler });
    }

    public async execute(params: CommandExecuteParams): Promise<CommandExecuteResponse> {
        const entry = this.commands.get(params.command);
        if (!entry) {
            throw new JSONRPCError(-32602, `Unknown command: ${params.command}`);
        }
        try {
            return await entry.handler(params.params ?? {});
        } catch (err) {
            if (err instanceof JSONRPCError) {
                throw err;
            }
            throw new JSONRPCError(
                -32603,
                err instanceof Error ? err.message : "Execution error",
            );
        }
    }

    public list(): CommandListResponse {
        return { commands: [...this.commands.values()].map(e => e.info) };
    }
}
