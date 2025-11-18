/**
 * @file pluginsupport.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { HostInterface } from "./interfaces/hostinterface";
import { NormalizedPath, normalizeJoinPath, normalizePath } from "./interfaces/hostinterface"; // migrated path abstractions
import { LuaTypeDefinitions } from "./shared/luadefsinterface";
import { LuauDefsGenerator } from "./shared/luadefsgenerator";
import { DocsJsonGenerator } from "./shared/docsjsongenerator";
import { SeleneYamlGenerator } from "./shared/seleneyamlgenerator";

//=============================================================================
abstract class BasePlugin {
    protected readonly host: HostInterface;
    constructor(host: HostInterface) {
        this.host = host;
    }
    public abstract configurePlugin(
        version: any,
        defs: LuaTypeDefinitions,
    ): Promise<boolean>;
}

//#region Selene Plugin Support
export class SelenePlugin extends BasePlugin {
    constructor(host: HostInterface) {
        super(host);
    }

    public static isEnabledHost(host: HostInterface): boolean {
        return host.isExtensionAvailable ? host.isExtensionAvailable("Kampfkarren.selene-vscode") : !!vscode.extensions.getExtension("Kampfkarren.selene-vscode");
    }

    public async configurePlugin(
        version: any,
        defs: LuaTypeDefinitions,
    ): Promise<boolean> {
        if (!SelenePlugin.isEnabledHost(this.host)) {
            console.warn("Selene plugin not active - skipping configuration");
            return false;
        }

        const basename = `slua_${version}`;
        let configPath: NormalizedPath;
        configPath = await this.host.config.getWorkspaceConfigPath();

        // Use the new generator
        const yamlContent = this.buildSeleneConfig(version, defs);

        let saved = await SelenePlugin.saveSLuaSeleneConfig(
            configPath,
            basename + `.yml`,
            yamlContent,
            this.host,
        );

        if (saved) {
            await SelenePlugin.updateSeleneConfig(configPath, basename, this.host);
        }

        return saved;
    }

    // =======================================
    // Language syntax export for Selene support
    // =======================================
    private static async saveSLuaSeleneConfig(
        configPath: NormalizedPath,
        filename: string,
        yamlContent: string,
        host: HostInterface,
    ): Promise<boolean> {
        const fullpath = normalizeJoinPath(configPath, filename);
        if (host.writeFile) {
            await host.writeFile(fullpath, yamlContent);
            return true;
        }
        // Fallback to VS Code API
        await vscode.workspace.fs.writeFile(vscode.Uri.file(fullpath), Buffer.from(yamlContent, "utf8"));
        return true;
    }

    private buildSeleneConfig(version: any, defs: LuaTypeDefinitions): string {
        const generator = new SeleneYamlGenerator();
        const config = {
            base: 'roblox',
            luaVersions: ['roblox', '5.1'],
            name: 'SLua LSL language support',
            version: version
        };
        return generator.generate(defs, config);
    }

    private static async updateSeleneConfig(
        configPath: NormalizedPath,
        basename: string,
        host: HostInterface,
    ): Promise<boolean> {
        let folders: NormalizedPath[] = [];
        if (host.listWorkspaceFolders) {
            folders = await host.listWorkspaceFolders();
        } else {
            const ws = vscode.workspace.workspaceFolders;
            if (ws) folders = ws.map(f => normalizePath(f.uri.fsPath));
        }
        if (folders.length === 0) {
            console.warn("No workspace folder found - cannot update selene.toml");
            return false;
        }
        let saved = false;
        for (const root of folders) {
            const tomlPath = normalizeJoinPath(root, "selene.toml");
            let seleneToml: any = {};
            seleneToml = (await host?.readTOML(tomlPath)) || {};
            const fullConfig = normalizeJoinPath(configPath, `${basename}.yml`);
            seleneToml.std = "roblox+" + fullConfig;
            saved = await host.writeTOML(tomlPath, seleneToml);
        }
        return saved;
    }
}
//#endregion Selene Plugin Support

//#region Lua LSP Plugin Support
export class LuaLSPPlugin extends BasePlugin {
    constructor(host: HostInterface) {
        super(host);
    }

    public static isEnabledHost(host: HostInterface): boolean {
        return host.isExtensionAvailable ? host.isExtensionAvailable("johnnymorganz.luau-lsp") : !!vscode.extensions.getExtension("johnnymorganz.luau-lsp");
    }

    public async configurePlugin(
        version: any,
        defs: LuaTypeDefinitions,
    ): Promise<boolean> {
        // Implementation for configuring the Lua LSP plugin
        let configs = this.buildLuauLSPConfig(defs);

        // Determine config path via host first
        let configPath: NormalizedPath;
        configPath = await this.host.config.getWorkspaceConfigPath();

        const defsFileName = await this.saveLuauLSPDefs(
            configPath,
            version,
            configs[0],
        );
        const docsFileName = await this.saveLuauLSPDocs(
            configPath,
            version,
            configs[1],
        );

        await this.restartLuauLSP(defsFileName, docsFileName, this.host);
        return true;
    }

    private async restartLuauLSP(
        defsFile: string,
        docsFile: string,
        _host: HostInterface,
    ): Promise<void> {
        // NOTE: Configuration updates still use VS Code API directly because they are
        // specific to another extension's settings. If desired we could expose a
        // generic configuration proxy later.
        const luaulsp = vscode.workspace.getConfiguration("luau-lsp");

        // Luau lsp uses a key'd object for this config, but used an array of strings int he past
        // We will insert our config with prefixed keys to avoid trampling any user defined keys
        let luaulspDefs = luaulsp.get<{[k:string]:string}|string[]>("types.definitionFiles",{});
        if(luaulspDefs instanceof Array) {
            // Discard array config, theres not much else we can do to fix it
            luaulspDefs = {}
        }
        for(const key in luaulspDefs) {
            if(key.startsWith("sl-")) {
                delete luaulspDefs[key];
            }
        }
        luaulspDefs["sl-slua"] = defsFile;

        await luaulsp.update("types.definitionFiles", luaulspDefs);
        await luaulsp.update("types.documentationFiles", [docsFile]);
        await luaulsp.update("platform.type", "standard");
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    private async saveLuauLSPDefs(
        configPath: NormalizedPath,
        version: any,
        defs: string,
    ): Promise<NormalizedPath> {
        const basename = `slua_${version}.d.luau`;
        const fullPath = normalizeJoinPath(configPath, basename);
        if (this.host.writeFile) {
            await this.host.writeFile(fullPath, defs);
        } else {
            await vscode.workspace.fs.writeFile(vscode.Uri.file(fullPath), Buffer.from(defs, "utf8"));
        }
        return fullPath;
    }

    private async saveLuauLSPDocs(
        configPath: NormalizedPath,
        version: any,
        docs: string,
    ): Promise<NormalizedPath> {
        const basename = `slua_${version}.docs.json`;
        const fullPath = normalizeJoinPath(configPath, basename);
        if (this.host.writeFile) {
            await this.host.writeFile(fullPath, docs);
        } else {
            await vscode.workspace.fs.writeFile(vscode.Uri.file(fullPath), Buffer.from(docs, "utf8"));
        }
        return fullPath;
    }

    public buildLuauLSPConfig(
        defs: LuaTypeDefinitions,
    ): [string, string] {
        // Use the new generators
        const defsGenerator = new LuauDefsGenerator();
        const docsGenerator = new DocsJsonGenerator();

        const luauDefs = defsGenerator.generate(defs);
        const docsDefs = docsGenerator.generate(defs);

        return [luauDefs, docsDefs];
    }
}
//#endregion Lua LSP Plugin Support
