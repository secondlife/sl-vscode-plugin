/**
 * @file pluginsupport.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { HostInterface, StringUri, filePathToStringUri, resolveUri } from "./interfaces/hostinterface";
import { ConfigKey } from "./interfaces/configinterface";

//=============================================================================
abstract class BasePlugin {
    protected readonly host: HostInterface;
    constructor(host: HostInterface) {
        this.host = host;
    }
}

//#region Selene Plugin Support
export class SelenePlugin extends BasePlugin {
    constructor(host: HostInterface) {
        super(host);
    }

    public static isEnabledHost(host: HostInterface): boolean {
        return host.isExtensionAvailable ? host.isExtensionAvailable("Kampfkarren.selene-vscode") : !!vscode.extensions.getExtension("Kampfkarren.selene-vscode");
    }

    // =======================================
    // Language syntax export for Selene support
    // =======================================
    private static async saveSLuaSeleneConfig(
        configPath: StringUri,
        filename: string,
        yamlContent: string,
        host: HostInterface,
    ): Promise<boolean> {
        const fullpath = resolveUri(configPath, filename);
        if (host.writeFile) {
            await host.writeFile(fullpath, yamlContent);
            return true;
        }
        // Fallback to VS Code API
        await vscode.workspace.fs.writeFile(vscode.Uri.parse(fullpath as string), Buffer.from(yamlContent, "utf8"));
        return true;
    }

    public async configureFromViewerCache(
        version: any,
        viewerSeleneYml: string,
    ): Promise<boolean> {
        if (!SelenePlugin.isEnabledHost(this.host)) {
            console.warn("Selene plugin not active - skipping configuration");
            return false;
        }

        const basename = `slua_${version}`;
        const configPath = await this.host.config.getWorkspaceConfigPath();

        const saved = await SelenePlugin.saveSLuaSeleneConfig(
            configPath,
            basename + `.yml`,
            viewerSeleneYml,
            this.host,
        );

        if (saved) {
            await SelenePlugin.updateSeleneConfig(configPath, basename, this.host);
        }

        return saved;
    }

    private static async updateSeleneConfig(
        configPath: StringUri,
        basename: string,
        host: HostInterface,
    ): Promise<boolean> {
        let folders: StringUri[] = [];
        if (host.listWorkspaceFolders) {
            folders = await host.listWorkspaceFolders();
        } else {
            const ws = vscode.workspace.workspaceFolders;
            if (ws) folders = ws.map(f => filePathToStringUri(f.uri.fsPath));
        }
        if (folders.length === 0) {
            console.warn("No workspace folder found - cannot update selene.toml");
            return false;
        }
        let saved = false;
        for (const root of folders) {
            const tomlPath = resolveUri(root, "selene.toml");
            let seleneToml: any = {};
            seleneToml = (await host?.readTOML(tomlPath)) || {};
            const fullConfig = resolveUri(configPath, `${basename}`);
            const relativeConfig = vscode.workspace.asRelativePath(vscode.Uri.parse(fullConfig as string), false);
            seleneToml.std = "luau+" + relativeConfig;
            saved = await host.writeTOML(tomlPath, seleneToml);
        }

        const selene = vscode.workspace.getConfiguration("selene");
        await selene.update("warnRoblox", false);

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

    private async restartLuauLSP(
        defsFiles: {[k:string]:string},
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

        for(const defKey in luaulspDefs) {
            if(!defKey.startsWith("sl-")) {
                defsFiles[defKey] = luaulspDefs[defKey];
            }
        }

        await luaulsp.update("types.definitionFiles", defsFiles);
        await luaulsp.update("types.documentationFiles", [docsFile]);
        await luaulsp.update("platform.type", "standard");
        await luaulsp.update("sourcemap.enabled", false);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Execute luau-lsp's command to realod the language sever
        await vscode.commands.executeCommand("luau-lsp.reloadServer")
    }

    private async saveLuauLSPDefs(
        configPath: StringUri,
        version: any,
        defs: string,
    ): Promise<string> {
        const basename = `slua_${version}.d.luau`;
        const fullPath = resolveUri(configPath, basename);
        if (this.host.writeFile) {
            await this.host.writeFile(fullPath, defs);
        } else {
            await vscode.workspace.fs.writeFile(vscode.Uri.parse(fullPath as string), Buffer.from(defs, "utf8"));
        }
        const path = vscode.Uri.parse(fullPath as string);
        return vscode.workspace.asRelativePath(path, false);
    }

    private async saveLuauLSPConstantDefs(
        configPath: StringUri
    ) : Promise<string> {
        const basename = `slua_constants.d.luau`;
        const constants = [
            ["__LINE__", "number"],
            ["__FILE__", "string"],
            ["__SHORTFILE__", "string"],
            ["__AGENTID__", "string"],
            ["__AGENTKEY__", "string"],
            ["__AGENTNAME__", "string"],
            ["__DATE__", "string"],
            ["__TIME__", "string"],
            ["__TIMESTAMP__", "string"],
            ["__UNIXTIME__", "number"],
        ];
        const slua_constants:string[] = constants.reduce<string[]>((acc, cur) => {
            acc.push(`declare ${cur[0]} : ${cur[1]}`);
            return acc;
        },[]);
        const fullPath = resolveUri(configPath, basename);
        if (this.host.writeFile) {
            await this.host.writeFile(fullPath, slua_constants.join("\n"));
        } else {
            await vscode.workspace.fs.writeFile(vscode.Uri.parse(fullPath as string), Buffer.from(slua_constants.join("\n"), "utf8"));
        }

        const path = vscode.Uri.parse(fullPath as string);
        return vscode.workspace.asRelativePath(path, false);
    }

    private async saveLuauLSPDocs(
        configPath: StringUri,
        version: any,
        docs: string,
    ): Promise<string> {
        const basename = `slua_${version}.docs.json`;
        const fullPath = resolveUri(configPath, basename);
        if (this.host.writeFile) {
            await this.host.writeFile(fullPath, docs);
        } else {
            await vscode.workspace.fs.writeFile(vscode.Uri.parse(fullPath as string), Buffer.from(docs, "utf8"));
        }
        const path = vscode.Uri.parse(fullPath as string);
        return vscode.workspace.asRelativePath(path, false);
    }

    public async configureFromViewerCache(
        version: any,
        viewerDLuau: string,
        viewerDocsJson: string,
    ): Promise<boolean> {
        const configPath = await this.host.config.getWorkspaceConfigPath();

        const defsFiles: { [k: string]: string } = {};

        defsFiles["sl-slua"] = await this.saveLuauLSPDefs(
            configPath,
            version,
            viewerDLuau,
        );

        if (this.host.config.getConfig(ConfigKey.PreprocessorConstantsInSLua, false)) {
            defsFiles["sl-slua-consts"] = await this.saveLuauLSPConstantDefs(configPath);
        }

        const docsFileName = await this.saveLuauLSPDocs(
            configPath,
            version,
            viewerDocsJson,
        );

        await this.restartLuauLSP(defsFiles, docsFileName, this.host);
        return true;
    }

}
//#endregion Lua LSP Plugin Support
