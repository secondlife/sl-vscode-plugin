import * as path from "path";
import {
    StringUri,
    filePathToStringUri,
} from "#sl-script-preprocessor";

export interface VirtualFileIdentity
{
    rootId: string;
    primId: string | null;
    itemId: string;
}

export function canonicalFileUri(filePath: string): StringUri
{
    const normalizedPath = path.normalize(path.resolve(filePath));
    return filePathToStringUri(normalizedPath);
}

export function virtualIdentityKey(
    identity: VirtualFileIdentity,
): string
{
    return JSON.stringify([
        identity.rootId,
        identity.primId,
        identity.itemId,
    ]);
}
