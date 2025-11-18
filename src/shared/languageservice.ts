/**
 * @file languageservice.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
//import { Preprocessor } from "./preprocessservice";
import { JSONRPCInterface } from "../websockclient";
import { LanguageTransformer } from "./languagetransformer";
import { LanguageRepository } from "./languagerepository";
import {
    NormalizedPath,
    normalizeJoinPath,
    HostInterface,
    TextDocLike,
    DisposableLike
} from "../interfaces/hostinterface";
import { ConfigKey } from "../interfaces/configinterface";
import { SelenePlugin, LuaLSPPlugin } from "../pluginsupport";
import { ConfigService } from "../configservice";

// TODO: migrate to ConfigInterface injection
export type ScriptLanguage = "lsl" | "luau";

//-----------------------------------------

/**
 * Shared services container for LSP servers
 * Provides common infrastructure used by both LSL and Luau language servers
 * This is a singleton class - use getInstance() to get the instance.
 */
export class LanguageService implements DisposableLike {
    private languageVersion: string = "0";
    private readonly host: HostInterface;
    private readonly repository: LanguageRepository;
    private disposed = false;

    private static instance: LanguageService | undefined;

    private constructor(host: HostInterface) {
        this.host = host;
        this.repository = new LanguageRepository(host);
    }

    /**
     * Acquire singleton instance. On first call both a VS Code context (for downstream services)
     * and a HostInterface implementation are required. Subsequent calls may omit both.
     */
    public static getInstance(
        host?: HostInterface,
    ): LanguageService {
        if (!LanguageService.instance) {
            if (!host) {
                throw new Error(
                    "LanguageService not initialized. Host is required for first initialization.",
                );
            }
            LanguageService.instance = new LanguageService(host);
            LanguageService.instance.initialize();
        }
        return LanguageService.instance;
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        // Reset the singleton instance so a new one can be created if needed
        LanguageService.instance = undefined;

        // Services don't currently implement dispose, but we're ready for when they do
        console.log("Language services disposed");
    }

    private async initialize(): Promise<void> {
    // TODO: Check the current workspace and load the current language version if possible

        return;
    }

    public isDisposed(): boolean {
        return this.disposed;
    }

    public getSyntaxID(): string {
        return this.languageVersion;
    }

    public getLastSyntaxID(): string | undefined {
        return this.host.config.getConfig<string>(ConfigKey.LastSyntaxID);
    }

    public setSyntaxID(version: string): void {
        this.languageVersion = version;
    }

    public static isLuauDocument(document: TextDocLike): boolean {
        return (
            document.languageId === "luau" || document.fileName.endsWith(".luau")
        );
    }

    public static isLSLDocument(document: TextDocLike): boolean {
        return document.languageId === "lsl" || document.fileName.endsWith(".lsl");
    }

    //#region Language Info Fetching
    public async changeSyntaxVersion(syntaxId: string,
        socket?: JSONRPCInterface, force?: boolean): Promise<boolean> {
        const syntax = await this.repository.getSyntax(syntaxId, { force, socket });

        if (!syntax) {
            console.warn(`No language syntax found for version ${syntaxId}`);
            return false;
        }

        if (syntax.slua)
        {
            // Configure optional plugins via host
            const selene = new SelenePlugin(this.host);
            await selene.configurePlugin(syntaxId, syntax.slua);

            const luauLSP = new LuaLSPPlugin(this.host);
            await luauLSP.configurePlugin(syntaxId, syntax.slua);
        }

        if (syntax) {
            this.languageVersion = syntax.id;
            if (syntaxId !== "default") {
                await ConfigService.getInstance().setConfig<string>(ConfigKey.LastSyntaxID, syntaxId, { target: "global" });
            }
        }
        return true;
    }

    public async requestSyntaxId(socket: JSONRPCInterface): Promise<string | null> {
        return await this.repository.requestLanguageSyntaxId(socket);
    }
    //#endregion

    //#region Language definition massaging
    public static translateLSLFunctionNameToLua(lslFunctionName: string): string {
        return LanguageTransformer.translateLSLFunctionNameToLua(lslFunctionName);
    }
    //#endregion

    //#region Language ID Caching utils
    public async getCachedSyntaxFileName(syntaxId: string): Promise<NormalizedPath> {
        let base: NormalizedPath;
        if (!syntaxId || syntaxId === "default") {
            base = normalizeJoinPath(await this.host.config.getExtensionInstallPath(), "data");
        } else {
            base = await this.host.config.getGlobalConfigPath();
        }
        return normalizeJoinPath(base, `syntax_def_${syntaxId}.json`);
    }

    public async hasCachedSyntaxFile(syntaxId: string): Promise<boolean> {
        const filePath = await this.getCachedSyntaxFileName(syntaxId);
        return await this.host.exists(filePath);
    }

    //#endregion
}
