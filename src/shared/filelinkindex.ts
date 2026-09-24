import { StringUri } from "#sl-script-preprocessor";

export class FileLinkIndex<T>
{
    private readonly masters = new Map<StringUri, T>();
    private readonly temporaryFiles = new Map<StringUri, T>();
    private readonly virtualFiles = new Map<string, T>();

    public clear(): void
    {
        this.masters.clear();
        this.temporaryFiles.clear();
        this.virtualFiles.clear();
    }

    public setMaster(uri: StringUri, owner: T): void
    {
        this.masters.set(uri, owner);
    }

    public setTemporaryFile(uri: StringUri, owner: T): void
    {
        this.temporaryFiles.set(uri, owner);
    }

    public setVirtualFile(identityKey: string, owner: T): void
    {
        this.virtualFiles.set(identityKey, owner);
    }

    public getMaster(uri: StringUri): T | undefined
    {
        return this.masters.get(uri);
    }

    public getTemporaryFile(uri: StringUri): T | undefined
    {
        return this.temporaryFiles.get(uri);
    }

    public getVirtualFile(identityKey: string): T | undefined
    {
        return this.virtualFiles.get(identityKey);
    }

    public deleteMaster(uri: StringUri): boolean
    {
        return this.masters.delete(uri);
    }

    public deleteTemporaryFile(uri: StringUri): boolean
    {
        return this.temporaryFiles.delete(uri);
    }

    public deleteVirtualFile(identityKey: string): boolean
    {
        return this.virtualFiles.delete(identityKey);
    }
}
