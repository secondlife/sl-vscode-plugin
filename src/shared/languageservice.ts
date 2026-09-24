/**
 * @file languageservice.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
//import { Preprocessor } from "./preprocessservice";
import {
    JSONRPCInterface,
    SyntaxCacheFile,
    SyntaxCacheGetRequest,
    SyntaxCacheList,
} from "#sl-ide-ws-client";
import {
    resolveUri,
    HostInterface
} from "#sl-script-preprocessor";
import { ConfigKey, FullConfigInterface } from "../interfaces/configinterface";
import { SelenePlugin, LuaLSPPlugin } from "../pluginsupport";
import { ConfigService } from "../configservice";

//-----------------------------------------

export interface TextDocLike {
    languageId: string;
    fileName: string;
}

export interface DisposableLike {
    dispose(): void;
}

/**
 * Shared services container for LSP servers
 * Provides common infrastructure used by both LSL and Luau language servers
 * This is a singleton class - use getInstance() to get the instance.
 */
export class LanguageService implements DisposableLike {
    private languageVersion: string = "0";
    private readonly host: HostInterface;
    private readonly config: FullConfigInterface;
    private syntaxCacheFiles: string[] = [];
    private disposed = false;

    private static instance: LanguageService | undefined;

    private constructor(host: HostInterface, config: FullConfigInterface) {
        this.host = host;
        this.config = config;
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
            LanguageService.instance = new LanguageService(host, ConfigService.getInstance());
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
        return this.config.getConfig<string>(ConfigKey.LastSyntaxID);
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
        return await this.configureSyntaxFromStagedArtifacts(syntaxId);
    }

    private async configureSyntaxFromStagedArtifacts(syntaxId: string): Promise<boolean> {
        const dataRoot = resolveUri(
            await this.config.getExtensionInstallPath(),
            "data",
        );

        const requiredFiles = [
            "lsl_keywords.xml",
            "lua_keywords.xml",
            "secondlife.d.luau",
            "secondlife.docs.json",
            "secondlife_selene.yml",
        ];

        for (const fileName of requiredFiles) {
            const exists = await this.host.exists(resolveUri(dataRoot, fileName), true);
            if (!exists) {
                console.warn(`staged syntax artifact missing: ${fileName}`);
                return false;
            }
        }

        const selenePath = resolveUri(dataRoot, "secondlife_selene.yml");
        const dLuauPath = resolveUri(dataRoot, "secondlife.d.luau");
        const docsPath = resolveUri(dataRoot, "secondlife.docs.json");

        const seleneYml = await this.host.readFile(selenePath, true);
        const dLuau = await this.host.readFile(dLuauPath, true);
        const docsJson = await this.host.readFile(docsPath, true);
        if (
            typeof seleneYml !== "string" ||
            typeof dLuau !== "string" ||
            typeof docsJson !== "string"
        ) {
            console.warn("failed to read staged syntax artifacts from data/");
            return false;
        }

        const selene = new SelenePlugin(this.host, this.config);
        await selene.configureFromViewerCache(syntaxId, seleneYml);

        const luauLSP = new LuaLSPPlugin(this.host, this.config);
        await luauLSP.configureFromViewerCache(
            syntaxId,
            dLuau,
            docsJson,
        );

        this.languageVersion = syntaxId;
        if (syntaxId !== "default") {
            await ConfigService.getInstance().setConfig<string>(ConfigKey.LastSyntaxID, syntaxId, { target: "global" });
        }
        return true;
    }

    private async configureSyntaxFromViewerCache(
        syntaxId: string,
        socket: JSONRPCInterface,
    ): Promise<boolean> {
        const cacheFiles = this.syntaxCacheFiles;

        const selene = new SelenePlugin(this.host, this.config);
        if (cacheFiles.includes("secondlife_selene.yml")) {
            const content = await this.requestSyntaxCacheFile(socket, "secondlife_selene.yml");
            if (typeof content === "string") {
                await selene.configureFromViewerCache(syntaxId, content);
            } else {
                console.warn("syntax_cache: secondlife_selene.yml missing or invalid, skipping Selene configuration");
            }
        } else {
            console.warn("syntax_cache: secondlife_selene.yml not in viewer cache, skipping Selene configuration");
        }

        const luauLSP = new LuaLSPPlugin(this.host, this.config);
        const hasDLuau = cacheFiles.includes("secondlife.d.luau");
        const hasDocs = cacheFiles.includes("secondlife.docs.json");
        if (hasDLuau && hasDocs) {
            const dLuau = await this.requestSyntaxCacheFile(socket, "secondlife.d.luau");
            const docs = await this.requestSyntaxCacheFile(socket, "secondlife.docs.json");
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
        try {
            const result = await socket.call("language.syntax.id");
            return result["id"];
        } catch (error) {
            console.error("Error calling language.syntax.id:", error);
            return null;
        }
    }

    public async requestSyntaxCacheList(socket: JSONRPCInterface): Promise<string[] | null> {
        try {
            const result = await socket.call("language.syntax.cache") as SyntaxCacheList;
            if (result && result.success === true && Array.isArray(result.files)) {
                this.syntaxCacheFiles = result.files;
                return this.syntaxCacheFiles;
            }
            this.syntaxCacheFiles = [];
            return null;
        } catch (error) {
            console.error("Error calling language.syntax.cache:", error);
            this.syntaxCacheFiles = [];
            return null;
        }
    }

    public async requestSyntaxCacheFile(
        socket: JSONRPCInterface,
        filename: string,
        asJson?: boolean,
    ): Promise<string | object | null> {
        const params: SyntaxCacheGetRequest = {
            filename,
            ...(asJson !== undefined ? { as_json: asJson } : {}),
        };
        try {
            const result = await socket.call("language.syntax.get", params) as SyntaxCacheFile;
            if (result && result.success === true && result.content !== undefined) {
                return result.content;
            }
            return null;
        } catch (error) {
            console.error("Error calling language.syntax.get for " + filename + ":", error);
            return null;
        }
    }

    public async hasCachedViewerSyntaxFiles(syntaxId: string): Promise<boolean> {
        if (!syntaxId || syntaxId === "default") {
            return true;
        }

        const configPath = await this.config.getWorkspaceConfigPath();
        const requiredFiles: string[] = [];

        if (SelenePlugin.isEnabledHost(this.host)) {
            requiredFiles.push(`slua_${syntaxId}.yml`);
        }

        if (LuaLSPPlugin.isEnabledHost(this.host)) {
            requiredFiles.push(`slua_${syntaxId}.d.luau`);
            requiredFiles.push(`slua_${syntaxId}.docs.json`);
        }

        for (const fileName of requiredFiles) {
            const exists = await this.host.exists(resolveUri(configPath, fileName));
            if (!exists) {
                return false;
            }
        }

        return true;
    }
    //#endregion

}
