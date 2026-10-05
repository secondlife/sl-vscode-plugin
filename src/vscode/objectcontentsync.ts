/**
 * @file objectcontentsync.ts
 * VS Code-side workflow for pulling a published object's scripts and
 * notecards into a workspace folder. See doc/plan-pull-object-to-workspace.md.
 * Copyright (C) 2026, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { ObjectContentService, ObjectInventoryItem } from "#sl-ide-ws-client";
import { SynchService } from "../synchservice";
import {
    planPullExport,
    planPullTargets,
    PullSummary,
    resolveDirectorySegmentName,
    resolveFileSegmentName,
    resolvePullCollisionMode,
    resolvePullDestination,
    snapshotPullObject,
    stripGeneratedScriptMetadata,
    UnsafePullPathError,
} from "../objectsyncutils";
import { itemUri } from "./objectcontentprovider";

interface PullPathFilesystem
{
    stat(uri: vscode.Uri): Promise<vscode.FileStat>;
    createDirectory(uri: vscode.Uri): Promise<void>;
}

function commentPrefixForItem(item: ObjectInventoryItem): string
{
    if (item.type === "notecard")
    {
        return "";
    }

    return item.subtype === 1 ? "--" : "//";
}

async function statPullPath(
    uri: vscode.Uri,
    filesystem: PullPathFilesystem,
): Promise<vscode.FileStat | undefined>
{
    try
    {
        return await filesystem.stat(uri);
    }
    catch (error)
    {
        if (error instanceof vscode.FileSystemError && error.code === "FileNotFound")
        {
            return undefined;
        }

        throw error;
    }
}

function statToProbeResult(stat: vscode.FileStat | undefined): "missing" | "directory" | "file" | "symlink"
{
    if (!stat)
    {
        return "missing";
    }

    if ((stat.type & vscode.FileType.SymbolicLink) !== 0)
    {
        return "symlink";
    }

    return (stat.type & vscode.FileType.Directory) !== 0 ? "directory" : "file";
}

async function assertSafeDirectory(uri: vscode.Uri, filesystem: PullPathFilesystem): Promise<void>
{
    const result = statToProbeResult(await filesystem.stat(uri));

    if (result === "symlink")
    {
        throw new UnsafePullPathError(
            `Refusing to traverse symbolic link or junction: ${uri.toString()}`,
        );
    }

    if (result !== "directory")
    {
        throw new UnsafePullPathError(
            `Expected a directory but found a file: ${uri.toString()}`,
        );
    }
}

/**
 * Verify `root` is an existing, safe directory, then walk `segments`,
 * creating any missing directory and unique-ifying a segment name that is
 * occupied by a file rather than aborting (Destination layout). Never
 * traverses a symbolic link or junction (decision 16).
 */
async function ensureSafePullDirectory(
    root: vscode.Uri,
    segments: readonly string[],
    filesystem: PullPathFilesystem,
): Promise<vscode.Uri>
{
    await assertSafeDirectory(root, filesystem);

    let current = root;

    for (const segment of segments)
    {
        const parent = current;
        const resolvedName = await resolveDirectorySegmentName(segment, {
            async probe(candidateName)
            {
                return statToProbeResult(
                    await statPullPath(vscode.Uri.joinPath(parent, candidateName), filesystem),
                );
            },
        });

        current = vscode.Uri.joinPath(parent, resolvedName);

        if (!(await statPullPath(current, filesystem)))
        {
            await filesystem.createDirectory(current);
        }
    }

    return current;
}

/** Returns true when `target` resolves to `destination` or somewhere beneath it. */
function isPullPathContained(destination: vscode.Uri, target: vscode.Uri): boolean
{
    const destinationPath = destination.path.endsWith("/")
        ? destination.path
        : `${destination.path}/`;
    return (target.path + "/").startsWith(destinationPath);
}

function isTargetDirty(targetUri: vscode.Uri): boolean
{
    return vscode.workspace.textDocuments.some(
        (document) => document.uri.toString() === targetUri.toString() && document.isDirty,
    );
}

export class ObjectContentSync
{
    public constructor(
        private readonly contentService: ObjectContentService,
        private readonly synchService: SynchService,
        private readonly isViewerConnected: () => boolean,
        private readonly logInfo: (message: string) => void,
        private readonly logWarning: (message: string) => void,
    )
    {
    }

    public async pullObjectToWorkspace(objectId: string): Promise<PullSummary>
    {
        const summary: PullSummary = {
            written: 0,
            overwritten: 0,
            skippedExists: 0,
            skippedDirty: 0,
            skippedAppeared: 0,
            skippedNoCopy: 0,
            skippedNoModify: 0,
            skippedPermissionsUnavailable: 0,
            unreadable: 0,
            failed: 0,
            cancelled: false,
            linked: 0,
            copiedNotLinked: 0,
            writtenNotLinked: 0,
        };
        const entry = this.contentService.getObject(objectId);

        if (!entry)
        {
            await vscode.window.showErrorMessage(
                "Cannot pull object: it is no longer published.",
            );
            return summary;
        }

        if (!this.isViewerConnected())
        {
            await vscode.window.showErrorMessage(
                "Cannot pull object: not connected to the Second Life viewer.",
            );
            return summary;
        }

        const snapshot = snapshotPullObject(entry.object);
        const exportPlan = planPullExport(snapshot);

        for (const skipped of exportPlan.skipped)
        {
            switch (skipped.reason)
            {
                case "no-copy":
                    summary.skippedNoCopy++;
                    break;
                case "no-modify":
                    summary.skippedNoModify++;
                    break;
                case "permissions-unavailable":
                    summary.skippedPermissionsUnavailable++;
                    break;
            }
        }

        if (exportPlan.exportable.length === 0)
        {
            this.showSummary(snapshot.objectName, summary);
            return summary;
        }

        const destination = await resolvePullDestination(
            (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
                label: folder.name,
                value: folder,
            })),
            snapshot.objectName,
            {
                async selectWorkspaceRoot(roots)
                {
                    return vscode.window.showQuickPick(roots, {
                        placeHolder: "Select the workspace for pulled object files",
                    });
                },
                async enterDestinationFolder(defaultName)
                {
                    return vscode.window.showInputBox({
                        prompt: "Enter destination folder name",
                        value: defaultName,
                    });
                },
            },
        );

        if (!destination)
        {
            if (!(vscode.workspace.workspaceFolders?.length ?? 0))
            {
                await vscode.window.showErrorMessage(
                    "Cannot pull object: no workspace folder is open.",
                );
            }
            return summary;
        }

        const filesystem: PullPathFilesystem = {
            stat: (uri) => Promise.resolve(vscode.workspace.fs.stat(uri)),
            createDirectory: (uri) =>
                Promise.resolve(vscode.workspace.fs.createDirectory(uri)),
        };

        let destinationUri: vscode.Uri;

        try
        {
            destinationUri = await ensureSafePullDirectory(
                destination.workspaceRoot.uri,
                [destination.folderName],
                filesystem,
            );
        }
        catch (error)
        {
            await vscode.window.showErrorMessage(
                `Cannot pull object: ${error instanceof Error ? error.message : String(error)}`,
            );
            return summary;
        }

        const targets = planPullTargets(exportPlan);
        const preflightTargets: {
            target: typeof targets[number];
            targetUri: vscode.Uri;
            existingFile: boolean;
            dirty: boolean;
        }[] = [];

        for (const target of targets)
        {
            const item = target.item.item;

            try
            {
                const directoryUri = await ensureSafePullDirectory(
                    destinationUri,
                    target.relativeDirectory,
                    filesystem,
                );
                const resolvedFile = await resolveFileSegmentName(target.fileName, {
                    async probe(candidateName)
                    {
                        return statToProbeResult(
                            await statPullPath(
                                vscode.Uri.joinPath(directoryUri, candidateName),
                                filesystem,
                            ),
                        );
                    },
                });
                const targetUri = vscode.Uri.joinPath(directoryUri, resolvedFile.name);

                if (!isPullPathContained(destinationUri, targetUri))
                {
                    summary.failed++;
                    this.logWarning(
                        `[pull] Target for ${item.name} resolves outside the destination.`,
                    );
                    continue;
                }

                preflightTargets.push({
                    target,
                    targetUri,
                    existingFile: resolvedFile.existingFile,
                    dirty: resolvedFile.existingFile && isTargetDirty(targetUri),
                });
            }
            catch (error)
            {
                summary.failed++;
                this.logWarning(
                    `[pull] Unsafe path for ${item.name}: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }

        const collisionMode = await resolvePullCollisionMode(
            {
                existingNames: preflightTargets
                    .filter((preflightTarget) => preflightTarget.existingFile)
                    .map((preflightTarget) => preflightTarget.target.fileName),
                dirtyNames: preflightTargets
                    .filter((preflightTarget) => preflightTarget.dirty)
                    .map((preflightTarget) => preflightTarget.target.fileName),
            },
            {
                async promptCollisionMode(message)
                {
                    const choice = await vscode.window.showWarningMessage(
                        message,
                        { modal: true },
                        "Skip Existing",
                        "Overwrite Existing",
                    );

                    if (choice === "Skip Existing")
                    {
                        return "skip";
                    }

                    if (choice === "Overwrite Existing")
                    {
                        return "overwrite";
                    }

                    return undefined;
                },
            },
        );

        if (collisionMode === undefined)
        {
            summary.cancelled = true;
            this.showSummary(snapshot.objectName, summary);
            return summary;
        }

        const linkedMasterUris: vscode.Uri[] = [];

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Pulling ${snapshot.objectName}`,
                cancellable: true,
            },
            async (progress, token) =>
            {
                for (let index = 0; index < preflightTargets.length; index++)
                {
                    if (
                        this.shouldStop(token, objectId, summary)
                    )
                    {
                        break;
                    }

                    const { target, targetUri, existingFile, dirty } = preflightTargets[index];
                    const item = target.item.item;
                    progress.report({
                        message: `${index + 1}/${preflightTargets.length}: ${item.name}`,
                        increment: 100 / preflightTargets.length,
                    });

                    if (existingFile && collisionMode === "skip")
                    {
                        summary.skippedExists++;
                        this.logInfo(`[pull] Skipped existing file: ${targetUri.toString()}`);
                        continue;
                    }

                    // Dirty-buffer check at preflight: known dirty before fetching anything.
                    if (existingFile && dirty)
                    {
                        summary.skippedDirty++;
                        this.logInfo(`[pull] Skipped open and modified file: ${targetUri.toString()}`);
                        continue;
                    }

                    let content: string;
                    const sourceUri = itemUri(objectId, target.item.primId, item.item_id);

                    try
                    {
                        const source = Buffer.from(
                            await vscode.workspace.fs.readFile(sourceUri),
                        ).toString("utf-8");
                        content = stripGeneratedScriptMetadata(
                            source,
                            commentPrefixForItem(item),
                        );
                    }
                    catch (error)
                    {
                        summary.unreadable++;
                        this.logWarning(
                            `[pull] Could not read ${item.name}: ` +
                            `${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }

                    if (
                        this.shouldStop(token, objectId, summary)
                    )
                    {
                        break;
                    }

                    // A file appearing here that was not already known about at preflight
                    // was not approved for overwrite and is skipped in either mode.
                    if (!existingFile)
                    {
                        if (await this.fileExists(targetUri))
                        {
                            summary.skippedAppeared++;
                            this.logInfo(
                                `[pull] Skipped file that appeared during pull: ${targetUri.toString()}`,
                            );
                            continue;
                        }
                    }
                    // Dirty-buffer check immediately before overwrite: the buffer may have
                    // become dirty since preflight.
                    else if (isTargetDirty(targetUri))
                    {
                        summary.skippedDirty++;
                        this.logInfo(`[pull] Skipped open and modified file: ${targetUri.toString()}`);
                        continue;
                    }

                    try
                    {
                        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, "utf-8"));
                        if (existingFile)
                        {
                            summary.overwritten++;
                            this.logInfo(`[pull] Overwrote ${targetUri.toString()}`);
                        }
                        else
                        {
                            summary.written++;
                            this.logInfo(`[pull] Wrote ${targetUri.toString()}`);
                        }
                    }
                    catch (error)
                    {
                        summary.failed++;
                        this.logWarning(
                            `[pull] Could not write ${targetUri.toString()}: ` +
                            `${error instanceof Error ? error.message : String(error)}`,
                        );
                        continue;
                    }

                    if (!target.item.canLink)
                    {
                        summary.copiedNotLinked++;
                        continue;
                    }

                    try
                    {
                        await this.synchService.linkSlItemToMaster(
                            sourceUri,
                            content,
                            targetUri,
                            { reveal: false, refreshDecorator: false },
                        );
                        summary.linked++;
                        linkedMasterUris.push(targetUri);
                        this.logInfo(`[pull] Linked ${targetUri.toString()}`);
                    }
                    catch (error)
                    {
                        summary.writtenNotLinked++;
                        this.logWarning(
                            `[pull] Wrote ${targetUri.toString()} but linking failed: ` +
                            `${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                }
            },
        );

        if (linkedMasterUris.length > 0)
        {
            this.synchService.refreshSyncedFileDecorator(linkedMasterUris);
        }

        this.showSummary(snapshot.objectName, summary);
        return summary;
    }

    private shouldStop(
        token: vscode.CancellationToken,
        objectId: string,
        summary: PullSummary,
    ): boolean
    {
        if (token.isCancellationRequested)
        {
            summary.cancelled = true;
            return true;
        }

        if (!this.isViewerConnected())
        {
            summary.interrupted = "viewer disconnected";
            return true;
        }

        if (!this.contentService.getObject(objectId))
        {
            summary.interrupted = "object was unpublished";
            return true;
        }

        return false;
    }

    private async fileExists(uri: vscode.Uri): Promise<boolean>
    {
        try
        {
            await vscode.workspace.fs.stat(uri);
            return true;
        }
        catch (error)
        {
            if (error instanceof vscode.FileSystemError && error.code === "FileNotFound")
            {
                return false;
            }

            throw error;
        }
    }

    private showSummary(objectName: string, summary: PullSummary): void
    {
        const interruption = summary.cancelled
            ? " cancelled"
            : summary.interrupted
                ? ` stopped: ${summary.interrupted}`
                : " complete";
        void vscode.window.showInformationMessage(
            `Pull${interruption} for ${objectName}: ` +
            `${summary.written} written, ${summary.skippedExists} skipped (exists), ` +
            `${summary.overwritten} overwritten, ` +
            `${summary.skippedDirty} skipped (open and modified), ` +
            `${summary.skippedAppeared} skipped (appeared during pull), ` +
            `${summary.skippedNoCopy} skipped (no copy), ` +
            `${summary.skippedNoModify} skipped (no modify), ` +
            `${summary.skippedPermissionsUnavailable} skipped (permissions unavailable), ` +
            `${summary.unreadable} unreadable, ${summary.failed} failed, ` +
            `${summary.linked} linked, ${summary.copiedNotLinked} copied (not linked), ` +
            `${summary.writtenNotLinked} written (not linked).`,
        );
    }
}
