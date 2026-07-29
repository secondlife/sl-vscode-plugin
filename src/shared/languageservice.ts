/**
 * @file languageservice.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
//import { Preprocessor } from "./preprocessservice";
import { JSONRPCInterface } from "../websockclient";
import { LanguageTransformer } from "./languagetransformer";
import { LanguageRepository } from "./languagerepository";
import {
    StringUri,
    resolveUri,
    HostInterface,
    TextDocLike,
    DisposableLike
} from "../interfaces/hostinterface";
import { ConfigKey } from "../interfaces/configinterface";
import { SelenePlugin, LuaLSPPlugin } from "../pluginsupport";
import { ConfigService } from "../configservice";

// TODO: migrate to ConfigInterface injection
export type ScriptLanguage = "lsl" | "luau" | "txt";

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
    public async changeSyntaxVersion(
        syntaxId: string,
        socket?: JSONRPCInterface,
        force?: boolean,
        syntaxCacheSupported?: boolean,
    ): Promise<boolean> {
        if (syntaxCacheSupported && socket) {
            return await this.configureSyntaxFromViewerCache(syntaxId, socket);
        }

        const syntax = await this.repository.getSyntax(syntaxId, {
            force,
            socket,
            syntaxCacheSupported,
        });

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

    private async configureSyntaxFromViewerCache(
        syntaxId: string,
        socket: JSONRPCInterface,
    ): Promise<boolean> {
        const cacheFiles = this.repository.syntaxCacheFiles;

        const selene = new SelenePlugin(this.host);
        if (cacheFiles.includes("secondlife_selene.yml")) {
            const content = await this.repository.requestSyntaxCacheFile(socket, "secondlife_selene.yml");
            if (typeof content === "string") {
                await selene.configureFromViewerCache(syntaxId, content);
            } else {
                console.warn("syntax_cache: secondlife_selene.yml missing or invalid, skipping Selene configuration");
            }
        } else {
            console.warn("syntax_cache: secondlife_selene.yml not in viewer cache, skipping Selene configuration");
        }

        const luauLSP = new LuaLSPPlugin(this.host);
        const hasDLuau = cacheFiles.includes("secondlife.d.luau");
        const hasDocs = cacheFiles.includes("secondlife.docs.json");
        if (hasDLuau && hasDocs) {
            const dLuau = await this.repository.requestSyntaxCacheFile(socket, "secondlife.d.luau");
            const docs = await this.repository.requestSyntaxCacheFile(socket, "secondlife.docs.json");
            if (typeof dLuau === "string" && typeof docs === "string") {
                await luauLSP.configureFromViewerCache(syntaxId, dLuau, docs);
            } else {
                console.warn("syntax_cache: secondlife.d.luau or secondlife.docs.json missing or invalid, skipping Luau-LSP configuration");
            }
        } else {
            console.warn("syntax_cache: Luau-LSP files not in viewer cache, skipping Luau-LSP configuration");
        }

        this.languageVersion = syntaxId;
        await ConfigService.getInstance().setConfig<string>(ConfigKey.LastSyntaxID, syntaxId, { target: "global" });
        return true;
    }

    public async requestSyntaxId(socket: JSONRPCInterface): Promise<string | null> {
        return await this.repository.requestLanguageSyntaxId(socket);
    }

    public async requestSyntaxCacheList(socket: JSONRPCInterface): Promise<string[] | null> {
        return await this.repository.requestSyntaxCacheList(socket);
    }

    public async requestSyntaxCacheFile(
        socket: JSONRPCInterface,
        filename: string,
        asJson?: boolean,
    ): Promise<string | object | null> {
        return await this.repository.requestSyntaxCacheFile(socket, filename, asJson);
    }
    //#endregion

    //#region Language definition massaging
    public static translateLSLFunctionNameToLua(lslFunctionName: string): string {
        return LanguageTransformer.translateLSLFunctionNameToLua(lslFunctionName);
    }
    //#endregion

    //#region Language ID Caching utils
    public async getCachedSyntaxFileName(syntaxId: string): Promise<StringUri> {
        let base: StringUri;
        if (!syntaxId || syntaxId === "default") {
            base = resolveUri(await this.host.config.getExtensionInstallPath(), "data");
        } else {
            base = await this.host.config.getGlobalConfigPath();
        }
        return resolveUri(base, `syntax_def_${syntaxId}.json`);
    }

    public async hasCachedSyntaxFile(syntaxId: string): Promise<boolean> {
        const filePath = await this.getCachedSyntaxFileName(syntaxId);
        return await this.host.exists(filePath);
    }

    //#endregion
}
