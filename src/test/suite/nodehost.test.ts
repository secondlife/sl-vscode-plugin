import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { describe, it, before, after } from 'mocha';
import { NodeHost } from '../../server/nodehost';
import { normalizePath, NormalizedPath } from '../../interfaces/hostinterface';
import { ConfigKey, FullConfigInterface } from '../../interfaces/configinterface';

// Minimal in-memory + passthrough config implementation for tests
class TestConfig implements FullConfigInterface {
    private data = new Map<ConfigKey, any>();
    private session = new Map<ConfigKey, any>();
    constructor(private root: string) {}
    isEnabled(): boolean {
        return true;
    }
    getConfig<T>(key: ConfigKey): T | undefined { return this.data.get(key); }
    async setConfig<T>(key: ConfigKey, value: T): Promise<void> { this.data.set(key, value); }
    getExtensionInstallPath(): Promise<NormalizedPath> { return Promise.resolve(normalizePath(this.root)); }
    getGlobalConfigPath(): Promise<NormalizedPath> { return Promise.resolve(normalizePath(path.join(this.root, '.global'))); }
    getWorkspaceConfigPath(): Promise<NormalizedPath> { return Promise.resolve(normalizePath(path.join(this.root, '.workspace'))); }
    getSessionValue<T>(key: ConfigKey): T | undefined { return this.session.get(key); }
    setSessionValue<T>(key: ConfigKey, value: T): void { this.session.set(key, value); }
    useLocalConfig(): boolean { return true; }
}

describe('NodeHost', () => {
    const tmpRoot = path.join(__dirname, '..', 'temp-nodehost');
    let host: NodeHost;

    before(async () => {
        await fs.promises.mkdir(tmpRoot, { recursive: true });
        const cfg = new TestConfig(tmpRoot);
        host = new NodeHost({ roots: [tmpRoot], config: cfg });
    });

    after(async () => {
        // Clean up created directory
        if (fs.existsSync(tmpRoot)) {
            await fs.promises.rm(tmpRoot, { recursive: true, force: true });
        }
    });

    it('writes and reads a file', async () => {
        const file = normalizePath(path.join(tmpRoot, 'alpha.txt'));
        const ok = await host.writeFile(file, 'hello');
        assert.strictEqual(ok, true);
        assert.strictEqual(await host.exists(file), true);
        const content = await host.readFile(file);
        assert.strictEqual(content, 'hello');
    });

    it('reads and writes JSON', async () => {
        const file = normalizePath(path.join(tmpRoot, 'data.json'));
        await host.writeJSON(file, { a: 1 });
        const obj = await host.readJSON(file);
        assert.deepStrictEqual(obj, { a: 1 });
    });

    it('reads and writes YAML', async () => {
        const file = normalizePath(path.join(tmpRoot, 'config.yaml'));
        const data = { foo: 'bar', n: 3 };
        await host.writeYAML(file, data);
        const loaded = await host.readYAML(file);
        assert.deepStrictEqual(loaded, data);
    });

    it('reads and writes TOML', async () => {
        const file = normalizePath(path.join(tmpRoot, 'config.toml'));
        const data = { key: 'value', num: 42 };
        await host.writeTOML(file, data);
        const loaded = await host.readTOML(file);
        assert.deepStrictEqual(loaded, data);
    });

    it('resolves direct include in same directory', async () => {
        const from = normalizePath(path.join(tmpRoot, 'main.lsl'));
        await host.writeFile(from, '// main');
        const inc = normalizePath(path.join(tmpRoot, 'lib.lsl'));
        await host.writeFile(inc, '// lib');
        const resolved = await host.resolveFile('lib.lsl', from, ['.lsl'], ['.']);
        assert.strictEqual(resolved, inc);
    });

    it('resolves include via relative include path', async () => {
        const subDir = path.join(tmpRoot, 'include');
        await fs.promises.mkdir(subDir, { recursive: true });
        const from = normalizePath(path.join(tmpRoot, 'main2.lsl'));
        await host.writeFile(from, '// main2');
        const inc = normalizePath(path.join(subDir, 'util.lsl'));
        await host.writeFile(inc, '// util');
        const resolved = await host.resolveFile('util', from, ['.lsl'], ['include']);
        assert.strictEqual(resolved, inc);
    });

    it('resolves include through wildcard pattern', async () => {
        const nested = path.join(tmpRoot, 'pkg', 'include');
        await fs.promises.mkdir(nested, { recursive: true });
        const from = normalizePath(path.join(tmpRoot, 'pkg', 'main3.lsl'));
        await host.writeFile(from, '// main3');
        const inc = normalizePath(path.join(nested, 'wild.lsl'));
        await host.writeFile(inc, '// wild');
        const resolved = await host.resolveFile('wild', from, ['.lsl'], ['**/include/']);
        // On Windows drive letter casing may differ; compare case-insensitive
        assert.ok(resolved && resolved.toLowerCase() === inc.toLowerCase(), `Expected ${resolved} to equal ${inc}`);
    });
});
