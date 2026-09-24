import * as vscode from "vscode";
import { ScriptIdentity } from "../../../scriptsync";

export interface FileLinkFixture
{
    masterUri: vscode.Uri;
    temporaryUri: vscode.Uri;
    virtualUri: vscode.Uri;
    virtualIdentity: ScriptIdentity;
}

export function createFileLinkFixture(
    name = "example",
): FileLinkFixture
{
    const rootId = "11111111-1111-4111-8111-111111111111";
    const primId = "22222222-2222-4222-8222-222222222222";
    const itemId = "33333333-3333-4333-8333-333333333333";

    return {
        masterUri: vscode.Uri.file(`/workspace/${name}.luau`),
        temporaryUri: vscode.Uri.file(`/tmp/${name}-${itemId}.luau`),
        virtualUri: vscode.Uri.from({
            scheme: "sl",
            authority: "objects",
            path: `/${rootId}/${primId}/${name}.luau`,
        }),
        virtualIdentity: {
            rootId,
            primId,
            itemId,
        },
    };
}

export function createVirtualIdentity(
    overrides: Partial<ScriptIdentity> = {},
): ScriptIdentity
{
    return {
        rootId: "11111111-1111-4111-8111-111111111111",
        primId: "22222222-2222-4222-8222-222222222222",
        itemId: "33333333-3333-4333-8333-333333333333",
        ...overrides,
    };
}

export function createMasterUri(
    filePath = "/workspace/example.luau",
): vscode.Uri
{
    return vscode.Uri.file(filePath);
}

export function createTemporaryUri(
    filePath = "/tmp/example-33333333-3333-4333-8333-333333333333.luau",
): vscode.Uri
{
    return vscode.Uri.file(filePath);
}

export function createVirtualUri(
    displayName = "example.luau",
): vscode.Uri
{
    return vscode.Uri.from({
        scheme: "sl",
        authority: "objects",
        path: `/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/${displayName}`,
    });
}
