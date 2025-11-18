/**
 * @file nodehost.ts
 * Non-VSCode runtime HostInterface implementation intended for a future
 * standalone language server environment. Provides filesystem-based include
 * resolution, JSON/YAML/TOML helpers, and workspace root awareness without
 * relying on VS Code APIs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { HostInterface, NormalizedPath, normalizePath } from '../interfaces/hostinterface';
import { FullConfigInterface } from '../interfaces/configinterface';
import * as yaml from 'js-yaml';
import * as toml from '@iarna/toml';

interface Logger {
    debug: (...a: any[]) => void;
    info: (...a: any[]) => void;
    warn: (...a: any[]) => void;
    error: (...a: any[]) => void;
}

export interface NodeHostOptions {
    /** Workspace root directories (at least one). */
    roots: string[];
    /** Injected configuration provider. */
    config: FullConfigInterface;
    /** Optional override for file system (for tests). */
    fsModule?: typeof fs;
    /** Optional logger (partial). */
    logger?: Partial<Logger>;
}

/** Minimal pattern test for wildcard detection. */
function hasWildcard(p: string): boolean { return /[*?]/.test(p); }

export class NodeHost implements HostInterface {
    public readonly config: FullConfigInterface;
    private readonly roots: NormalizedPath[];
    private readonly fs: typeof fs;
    private readonly log: Logger;

    constructor(opts: NodeHostOptions) {
        if (!opts.roots || opts.roots.length === 0) {
            throw new Error('NodeHost requires at least one root directory');
        }
        this.config = opts.config;
        this.roots = opts.roots.map(r => normalizePath(path.resolve(r)));
        this.fs = opts.fsModule || fs;
        const noOp = (): void => {};
        this.log = {
            debug: opts.logger?.debug || noOp,
            info: opts.logger?.info || noOp,
            warn: opts.logger?.warn || noOp,
            error: opts.logger?.error || noOp
        };
    }

    // ---------------------------------------------------------------------
    async exists(p: NormalizedPath, _unsafe?: boolean): Promise<boolean> {
        try {
            const st = await this.fs.promises.stat(p);
            return st.isFile();
        } catch { return false; }
    }

    async readFile(p: NormalizedPath, _unsafe?: boolean): Promise<string | null> {
        try { return await this.fs.promises.readFile(p, 'utf8'); } catch { return null; }
    }

    async writeFile(p: NormalizedPath, content: string | Uint8Array): Promise<boolean> {
        try {
            await this.ensureDir(path.dirname(p));
            await this.fs.promises.writeFile(p, content);
            return true;
        } catch (err) {
            this.log.error('writeFile failed', p, err);
            return false;
        }
    }

    async readJSON<T = any>(p: NormalizedPath, unsafe?: boolean): Promise<T | null> {
        const txt = await this.readFile(p, unsafe);
        if (txt == null) return null;
        try { return JSON.parse(txt) as T; } catch { return null; }
    }

    async writeJSON(p: NormalizedPath, data: any, pretty: boolean = true): Promise<boolean> {
        try {
            const serialized = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
            return await this.writeFile(p, serialized);
        } catch (err) {
            this.log.error('writeJSON failed', p, err);
            return false;
        }
    }

    async readYAML<T = any>(p: NormalizedPath, unsafe?: boolean): Promise<T | null> {
        const txt = await this.readFile(p, unsafe);
        if (txt == null) return null;
        try { return yaml.load(txt) as T; } catch { return null; }
    }

    async writeYAML(p: NormalizedPath, data: any): Promise<boolean> {
        try { return await this.writeFile(p, yaml.dump(data)); } catch { return false; }
    }

    async readTOML<T = any>(p: NormalizedPath, unsafe?: boolean): Promise<T | null> {
        const txt = await this.readFile(p, unsafe);
        if (txt == null) return null;
        try { return toml.parse(txt) as T; } catch { return null; }
    }

    async writeTOML(p: NormalizedPath, data: Record<string, any>): Promise<boolean> {
        try { return await this.writeFile(p, toml.stringify(data)); } catch { return false; }
    }

    async listWorkspaceFolders(): Promise<NormalizedPath[]> { return this.roots; }

    isExtensionAvailable(_id: string): boolean { return false; }

    // ---------------------------------------------------------------------
    /** Resolve include/require file akin to VSCode host but purely on filesystem. */
    async resolveFile(
        filename: string,
        from: NormalizedPath,
        extensions: string[],
        includePaths?: string[]
    ): Promise<NormalizedPath | null> {
        const fromDir = path.dirname(from);
        const hasExt = path.extname(filename).length > 0;
        const candidateExts = hasExt ? [''] : extensions.map(e => e.startsWith('.') ? e : `.${e}`);

        const searchGlobs = (includePaths && includePaths.length > 0) ? includePaths : ['.'];

        const candidateDirs: string[] = [];
        const wildcardGlobs: string[] = [];
        for (const raw of searchGlobs) {
            const g = raw.trim();
            if (!g) continue;
            if (hasWildcard(g)) { wildcardGlobs.push(g); continue; }
            if (g === '.') { candidateDirs.push(fromDir); continue; }
            if (g.startsWith('./')) { candidateDirs.push(path.join(fromDir, g.substring(2))); continue; }
            if (path.isAbsolute(g)) { candidateDirs.push(g); continue; }
            for (const root of this.roots) { candidateDirs.push(path.join(root, g)); }
        }

        const isExplicitRelative = filename.startsWith('./') || filename.startsWith('../');
        if (isExplicitRelative && !candidateDirs.includes(fromDir)) candidateDirs.unshift(fromDir);
        const containsPath = /[\\/]/.test(filename);

        const tryCandidate = async (absPath: string): Promise<NormalizedPath | null> => {
            if (!this.isInsideRoots(absPath)) return null;
            try {
                const st = await this.fs.promises.stat(absPath);
                if (st.isFile()) return normalizePath(absPath);
            } catch { /* ignore */ }
            return null;
        };

        for (const dir of candidateDirs) {
            const baseDir = path.normalize(dir);
            let baseCandidate: string;
            if (containsPath) {
                baseCandidate = path.isAbsolute(filename) ? path.normalize(filename) : path.join(baseDir, filename);
            } else {
                baseCandidate = path.join(baseDir, filename);
            }
            for (const ext of candidateExts) {
                const full = ext === '' ? baseCandidate : baseCandidate + ext;
                const found = await tryCandidate(full);
                if (found) return found;
            }
        }

        // Wildcard patterns: treat each as directory glob in which filename (+ext variants) is appended
        for (const pattern of wildcardGlobs) {
            for (const root of this.roots) {
                for (const ext of candidateExts) {
                    const finalName = hasExt || ext === '' ? filename : filename + ext;
                    const joined = path.isAbsolute(pattern)
                        ? path.join(pattern, finalName)
                        : path.join(root, pattern, finalName);
                    const unixPattern = joined.split(path.sep).join('/');
                    try {
                        const matches = await glob(unixPattern, { nodir: true, absolute: true });
                        if (matches && matches.length > 0) {
                            const candidate = path.normalize(matches[0]);
                            const found = await tryCandidate(candidate);
                            if (found) return found;
                        }
                    } catch (err) {
                        this.log.debug('glob error', pattern, err);
                    }
                }
            }
        }

        return null;
    }

    // ---------------------------------------------------------------------
    private isInsideRoots(absPath: string): boolean {
        const norm = path.normalize(absPath).toLowerCase();
        return this.roots.some(r => norm.startsWith(r.toLowerCase() + path.sep));
    }

    private async ensureDir(dir: string): Promise<void> {
        await this.fs.promises.mkdir(dir, { recursive: true });
    }

    /**
     * Convert a normalized file path to a file:// URI for NodeHost
     */
    fileNameToUri(fileName: NormalizedPath): string {
        // For NodeHost, we just use file:// URIs with absolute paths
        const absPath = path.resolve(fileName);
        // Convert Windows backslashes to forward slashes for URI
        const uriPath = absPath.split(path.sep).join('/');
        // Ensure proper file:// URI format
        return 'file:///' + (uriPath.startsWith('/') ? uriPath.slice(1) : uriPath);
    }

    /**
     * Convert a URI back to a normalized file path
     */
    uriToFileName(uri: string): NormalizedPath {
        // Handle file:// URIs
        if (uri.startsWith('file:///')) {
            let filePath = uri.substring('file:///'.length);
            // On Windows, we need to handle drive letters
            if (process.platform === 'win32' && /^[a-zA-Z]:/.test(filePath)) {
                // Already has drive letter, just normalize
                return normalizePath(filePath);
            }
            // On Unix or if missing drive letter on Windows, add leading slash
            if (!filePath.startsWith('/')) {
                filePath = '/' + filePath;
            }
            return normalizePath(filePath);
        }
        // If not a recognized URI scheme, treat as a path
        return normalizePath(uri);
    }
}

export default NodeHost;
