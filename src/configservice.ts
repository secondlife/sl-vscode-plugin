/**
 * @file configservice.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { hasWorkspace } from "./utils";
import { ConfigKey, ConfigScope, FullConfigInterface } from "./interfaces/configinterface";
import { normalizePath, NormalizedPath } from "./interfaces/hostinterface";

/** Number of seconds to display status bar messages */
export const STATUS_BAR_TIMEOUT_SECONDS = 3;
export const SCRIPT_FILE_PATTERN =
  /^sl_script_(.+)_([a-fA-F0-9]{32}|[a-fA-F0-9-]{36})\.(luau|lsl)$/;


export const configPrefix = "slVscodeEdit";
/**
 * Configuration keys
 * Note: Keys marked with '*' are not handled through the configuation UI
 */

export class ConfigService implements vscode.Disposable, FullConfigInterface {
    private static instance: ConfigService | undefined = undefined;
    private context: vscode.ExtensionContext;
    private SessionConfigs: any = {};
    private watcher: vscode.Disposable|null = null;

    private configHooks : [string,(configService:FullConfigInterface)=>void][] = []

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        ConfigService.instance = this;

        this.SessionConfigs[ConfigKey.ClientName] =
            context.extension.packageJSON.name;
        this.SessionConfigs[ConfigKey.ClientVersion] =
            context.extension.packageJSON.version;
        this.SessionConfigs[ConfigKey.ClientProtocolVersion] = "1.0";
        this.SessionConfigs[ConfigKey.FilesSupportedExtensions] = ["lsl", "luau"];
        this.SessionConfigs[ConfigKey.StorageGlobalPath] =
            context.globalStorageUri;

        //TODO: Cache the configuration values and listen for changes
    }

    dispose(): void {
        if(this.watcher) {
            this.watcher.dispose();
        }
    }

    public static getInstance(context?: vscode.ExtensionContext): ConfigService {
        if (!ConfigService.instance) {
            if (!context) {
                throw new Error(
                    "ConfigService not initialized. Context is required for first initialization.",
                );
            }
            ConfigService.instance = new ConfigService(context);
            ConfigService.instance.initialize();
        }
        return ConfigService.instance;
    }

    public initialize(): void {
        this.watcher = vscode.workspace.onDidChangeConfiguration((e) => {
            this.configHooks.filter(hook => e.affectsConfiguration(hook[0])).forEach(hook => hook[1](this));
        });
    }

    public on(config:ConfigKey, handler:(configService:FullConfigInterface) => void) : void {
        this.configHooks.push([`${configPrefix}.${config}`,handler]);
    }

    // ConfigInterface path methods -------------------------------------------------
    public async getExtensionInstallPath(): Promise<NormalizedPath> {
        return normalizePath(ConfigService.getExtensionPath().fsPath);
    }

    public async getGlobalConfigPath(): Promise<NormalizedPath> {
        return normalizePath((await ConfigService.getGlobalConfigPath()).fsPath);
    }

    public async getWorkspaceConfigPath(): Promise<NormalizedPath> {
        return normalizePath((await ConfigService.getConfigPath()).fsPath);
    }

    // Session value helpers -------------------------------------------------------
    public getSessionValue<T>(key: ConfigKey): T | undefined {
        return this.SessionConfigs[key] as T | undefined;
    }
    public setSessionValue<T>(key: ConfigKey, value: T): void {
        this.SessionConfigs[key] = value;
    }

    // LocalConfigDecider instance method
    public useLocalConfig(): boolean {
        return ConfigService.useLocalConfig();
    }

    public isEnabled() : boolean {
        return this.getConfig<boolean>(ConfigKey.Enabled) ?? true;
    }

    public getConfig<T>(config: ConfigKey, defaultValue?:T): T | undefined {
        if (config in this.SessionConfigs) {
            return this.SessionConfigs[config] as T;
        }
        const configuration = vscode.workspace.getConfiguration("slVscodeEdit");
        if(defaultValue) return configuration.get<T>(config, defaultValue);
        return configuration.get<T>(config);
    }

    public setConfig<T>(config: ConfigKey, value: T, scope?: ConfigScope): Promise<void> {
        if (config in this.SessionConfigs) {
            this.SessionConfigs[config] = value;
            return Promise.resolve();
        }
        return Promise.resolve(vscode.workspace.getConfiguration(configPrefix).update(config, value, scope?.target === 'global') as unknown as void);
    }

    public static async getLocalConfigPath(): Promise<vscode.Uri> {
        const that: ConfigService = ConfigService.getInstance();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri;
            const clientName =
                that.getConfig<string>(ConfigKey.ClientName) || "sl-vscode-plugin";
            const configDir = vscode.Uri.joinPath(
                workspaceRoot,
                ".vscode",
                clientName.toLowerCase().replace(/\s+/g, "-"),
            );
            // ensure that the configDir exists
            await vscode.workspace.fs.createDirectory(configDir);
            return configDir;
        }
        return await ConfigService.getGlobalConfigPath();
    }

    public static async getGlobalConfigPath(): Promise<vscode.Uri> {
        const that: ConfigService = ConfigService.getInstance();
        const globalStorage = that.getConfig<vscode.Uri>(ConfigKey.StorageGlobalPath) || vscode.Uri.file("/");

        await vscode.workspace.fs.createDirectory(globalStorage);
        return globalStorage;
    }

    public static getExtensionPath(): vscode.Uri {
        const that: ConfigService = ConfigService.getInstance();
        return that.context.extensionUri;
    }

    public static useLocalConfig(): boolean {
        return (
            (ConfigService.getInstance().getConfig<boolean>(ConfigKey.StorageUseLocalConfig) || false) &&
            hasWorkspace()
        );
    }

    public static async getConfigPath(): Promise<vscode.Uri> {
        if (ConfigService.useLocalConfig()) {
            return await ConfigService.getLocalConfigPath();
        } else {
            return await ConfigService.getGlobalConfigPath();
        }
    }


}
// Note: Free helper accessors removed; use injected host.config instead to
// encourage explicit dependency wiring and simplify future decoupling.
