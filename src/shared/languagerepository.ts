/**
 * @file languagerepository.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import { HostInterface, StringUri, resolveUri } from '../interfaces/hostinterface';
import { LanguageTransformer } from './languagetransformer';
import { JSONRPCInterface } from '../websockclient';
import { SyntaxCacheFile, SyntaxCacheGetRequest, SyntaxCacheList } from '../viewereditwsclient';
import { LSLKeywords } from "./lslkeywords";
import { LuaTypeDefinitions } from "./luadefsinterface";
import { sortObjectKeysRecursive } from '../utils';

export interface LanguageInfo {
    id: string;
    lsl?: LSLKeywords;
    slua?: LuaTypeDefinitions;
}

export interface FetchOptions {
    force?: boolean; // bypass cache when true
    socket?: JSONRPCInterface; // viewer connection for remote fetch
    syntaxCacheSupported?: boolean;
}

export class LanguageRepository {
    public syntaxCacheFiles: string[] = [];

    constructor(private readonly host: HostInterface) {}

    public async getSyntax(version: string, opts: FetchOptions = {}): Promise<LanguageInfo | null> {
        const { force, socket } = opts;
        let syntax: LanguageInfo | null = null;
        if (!force) {
            syntax = await this.loadCachedSyntaxFile(version);
        }
        if (!syntax && socket) {
            syntax = await this.requestSyntaxFromViewer(version, socket);
            if (syntax) {
                await this.saveSyntaxToCache(version, syntax);
            }
        }
        if (!syntax) {
            return null;
        }
        if (syntax.lsl && syntax.slua)
        {
            LanguageTransformer.processCombinedDefinitions(syntax.lsl, syntax.slua);
        }

        return syntax;
    }

    public async getCachedSyntaxFileName(syntaxId: string): Promise<StringUri> {
        let base: StringUri;
        if (!syntaxId || syntaxId === 'default') {
            base = resolveUri(await this.host.config.getExtensionInstallPath(), 'data');
        } else {
            base = await this.host.config.getGlobalConfigPath();
        }
        return resolveUri(base, `syntax_def_${syntaxId}.json`);
    }

    public async hasCachedSyntaxFile(syntaxId: string): Promise<boolean> {
        const filePath = await this.getCachedSyntaxFileName(syntaxId);
        return await this.host.exists(filePath, true);
    }

    public async loadCachedSyntaxFile(syntaxId: string): Promise<LanguageInfo | null> {
        const cachePath = await this.getCachedSyntaxFileName(syntaxId);
        const exists = await this.host.exists(cachePath, true);
        if (!exists) return null;
        return await this.host.readJSON<LanguageInfo>(cachePath, true);
    }

    public async saveSyntaxToCache(syntaxId: string, syntax: LanguageInfo): Promise<boolean> {
        const cachePath = await this.getCachedSyntaxFileName(syntaxId);
        return await this.host.writeJSON(cachePath, syntax);
    }

    private async requestSyntaxFromViewer(languageId: string, socket: JSONRPCInterface): Promise<LanguageInfo | null> {
        const version = await this.requestLanguageSyntaxId(socket);
        if (!version) {
            console.warn('No language version received from language server');
            return null;
        }
        if (version !== languageId) {
            console.warn(`Language version mismatch: expected ${languageId}, got ${version}`);
        }
        let syntax: LanguageInfo = { id: version };
        let response: any;

        response = await this.requestLanguageSyntax(socket, 'defs.lsl');
        if (response && response.success !== true) {
            console.warn(`No LSL definitions received from language server: ${response.error}`);
            return null;
        } else {
            syntax.id = response.id;
            syntax.lsl = response.defs as LSLKeywords;
        }

        response = await this.requestLanguageSyntax(socket, 'defs.lua');
        if (response && response.success !== true) {
            console.warn(`No Lua definitions received from language server: ${response.error}`);
            return null;
        } else if (response.id === version) {
            syntax.slua = response.defs as LuaTypeDefinitions;
        }
        return sortObjectKeysRecursive(syntax);
    }

    public async requestLanguageSyntaxId(socket: JSONRPCInterface): Promise<string | null> {
        try {
            const result = await socket.call('language.syntax.id');
            return result['id'];
        } catch (error) {
            console.error('Error calling language.syntax.id:', error);
            return null;
        }
    }

    public async requestSyntaxCacheList(socket: JSONRPCInterface): Promise<string[] | null> {
        try {
            const result = await socket.call('language.syntax.cache') as SyntaxCacheList;
            if (result && result.success === true && Array.isArray(result.files)) {
                this.syntaxCacheFiles = result.files;
                return this.syntaxCacheFiles;
            }
            this.syntaxCacheFiles = [];
            return null;
        } catch (error) {
            console.error('Error calling language.syntax.cache:', error);
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
            const result = await socket.call('language.syntax.get', params) as SyntaxCacheFile;
            if (result && result.success === true && result.content !== undefined) {
                return result.content;
            }
            return null;
        } catch (error) {
            console.error(`Error calling language.syntax.get for ${filename}:`, error);
            return null;
        }
    }

    private async requestLanguageSyntax(socket: JSONRPCInterface, kind: string): Promise<any | null> {
        const params = { kind };
        try {
            return await socket.call('language.syntax', params);
        } catch (error) {
            console.error('Error calling language.syntax:', error);
            return null;
        }
    }
}
