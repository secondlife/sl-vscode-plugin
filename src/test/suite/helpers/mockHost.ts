/**
 * @file mockHost.ts
 * Shared mock HostInterface and MockConfig factory for tests.
 * Copyright (C) 2025, Linden Research, Inc.
 */

import { HostInterface, StringUri, filePathToStringUri } from '../../../interfaces/hostinterface';
import { FullConfigInterface, ConfigKey } from '../../../interfaces/configinterface';

// ─── MockConfig ───────────────────────────────────────────────────────────────

export class MockConfig implements FullConfigInterface {
    private values: Map<ConfigKey, any> = new Map();

    constructor(values?: Map<ConfigKey, any> | Partial<Record<string, any>>) {
        if (values instanceof Map) {
            this.values = new Map(values);
        } else if (values) {
            for (const [k, v] of Object.entries(values)) {
                this.values.set(k as ConfigKey, v);
            }
        }
    }

    isEnabled(): boolean { return true; }

    getConfig<T>(key: ConfigKey): T | undefined;
    getConfig<T>(key: ConfigKey, defaultValue: T): T;
    getConfig<T>(key: ConfigKey, defaultValue?: T): T | undefined {
        const value = this.values.get(key);
        if (value !== undefined) { return value as T; }
        return defaultValue;
    }

    async setConfig<T>(key: ConfigKey, value: T): Promise<void> { this.values.set(key, value); }
    async getWorkspaceConfigPath(): Promise<StringUri> { return filePathToStringUri('d:/test/config'); }
    async getGlobalConfigPath(): Promise<StringUri> { return filePathToStringUri('d:/test/global'); }
    async getExtensionInstallPath(): Promise<StringUri> { return filePathToStringUri('d:/test/extension'); }
    getSessionValue<T>(_key: ConfigKey): T | undefined { return undefined; }
    setSessionValue<T>(_key: ConfigKey, _value: T): void {}
    useLocalConfig(): boolean { return false; }
}

// ─── MockFileSystem ───────────────────────────────────────────────────────────

/** In-memory file system: maps StringUri → file content */
export type MockFileSystem = Map<StringUri, string>;

// ─── Factory functions ────────────────────────────────────────────────────────

/**
 * Creates a no-op mock host. All reads return null/false.
 * Optionally accepts a pre-built FullConfigInterface.
 */
export function createMockHost(config?: FullConfigInterface): HostInterface {
    const cfg = config ?? new MockConfig();
    return {
        config: cfg,
        async readFile(_uri: StringUri): Promise<string | null> { return null; },
        async exists(_uri: StringUri): Promise<boolean> { return false; },
        async resolveFile(_f: string, _from: StringUri): Promise<StringUri | null> { return null; },
        async writeFile(_uri: StringUri, _content: string | Uint8Array): Promise<boolean> { return false; },
        async readJSON<T>(_uri: StringUri): Promise<T | null> { return null; },
        async readYAML<T>(_uri: StringUri): Promise<T | null> { return null; },
        async readTOML<T>(_uri: StringUri): Promise<T | null> { return null; },
        async writeJSON(_uri: StringUri, _data: unknown): Promise<boolean> { return false; },
        async writeYAML(_uri: StringUri, _data: unknown): Promise<boolean> { return false; },
        async writeTOML(_uri: StringUri, _data: Record<string, unknown>): Promise<boolean> { return false; },
        async existsInSameWorkspace(_known: string, _desired: string): Promise<boolean> { return false; },
    };
}

/**
 * Creates a mock host backed by an in-memory file map.
 * resolveFile performs a simple directory-relative lookup within the map.
 * Files can be added/removed from the map after construction to simulate
 * file system changes during a test.
 */
export function createMockHostWithFiles(
    files: MockFileSystem,
    config?: FullConfigInterface
): HostInterface {
    const cfg = config ?? new MockConfig();
    return {
        config: cfg,
        async readFile(uri: StringUri): Promise<string | null> {
            return files.get(uri) ?? null;
        },
        async exists(uri: StringUri): Promise<boolean> {
            return files.has(uri);
        },
        async resolveFile(filename: string, from: StringUri): Promise<StringUri | null> {
            // Strip the last path component to get the containing directory
            const dir = from.replace(/\/[^/]*$/, '/');
            const candidate = (dir + filename) as StringUri;
            return files.has(candidate) ? candidate : null;
        },
        async writeFile(uri: StringUri, content: string | Uint8Array): Promise<boolean> {
            files.set(uri, typeof content === 'string' ? content : new TextDecoder().decode(content));
            return true;
        },
        async readJSON<T>(uri: StringUri): Promise<T | null> {
            const text = files.get(uri);
            return text != null ? JSON.parse(text) as T : null;
        },
        async readYAML<T>(_uri: StringUri): Promise<T | null> { return null; },
        async readTOML<T>(_uri: StringUri): Promise<T | null> { return null; },
        async writeJSON(uri: StringUri, data: unknown, pretty = true): Promise<boolean> {
            files.set(uri, JSON.stringify(data, null, pretty ? 2 : 0));
            return true;
        },
        async writeYAML(_uri: StringUri, _data: unknown): Promise<boolean> { return false; },
        async writeTOML(_uri: StringUri, _data: Record<string, unknown>): Promise<boolean> { return false; },
        async existsInSameWorkspace(_known: string, _desired: string): Promise<boolean> { return false; },
    };
}
