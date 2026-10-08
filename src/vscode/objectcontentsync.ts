/**
 * @file objectcontentsync.ts
 * VS Code-side workflow for pulling a published object's scripts and
 * notecards into a workspace folder. See doc/plan-pull-object-to-workspace.md.
 * Copyright (C) 2026, Linden Research, Inc.
 */
import * as vscode from "vscode";
import * as path from "path";
import { ScriptLanguage } from "#sl-script-preprocessor";
import { ObjectContentService, ObjectInventoryItem, PERM_MODIFY } from "#sl-ide-ws-client";
import { logTrace } from "../utils";
import { SynchService } from "../synchservice";
import {
    buildPushConfirmationMessage,
    findAmbiguousPushEntries,
    findConflictingPushEntries,
    findPushCollisions,
    findPushPermissionFailures,
    planPullExport,
    planPullTargets,
    planPushSet,
    PullSummary,
    PushEntry,
    PushFile,
    PushExclusionCounts,
    PushInventoryItem,
    PushPlanOutcome,
    PushResolvedEntry,
    PushSelectionIntake,
    PushSummary,
    PushTargetSelection,
    PushCollision,
    PushValidationFailure,
    resolveDirectorySegmentName,
    resolveFileSegmentName,
    resolvePullCollisionMode,
    resolvePullDestination,
    resolvePushDestinations,
    resolvePushTarget,
    snapshotPullObject,
    stripGeneratedScriptMetadata,
    summarizePushTargets,
    UnsafePullPathError,
} from "../objectsyncutils";
import { createUri, itemUri } from "./objectcontentprovider";

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

    /**
     * Intake a File Explorer selection for push: expand directories one level
     * (files only, nested directories counted), drop files that do not decode as
     * UTF-8, and derive the push set (decisions 1, 12; steps 12, 13). Called by
     * pushFilesToObject(), which carries the selection through target selection,
     * planning, confirmation and execution.
     */
    public async pushSelectedFiles(selection: readonly vscode.Uri[]): Promise<PushSelectionIntake>
    {
        const fileUris: vscode.Uri[] = [];
        let nestedDirectories = 0;

        for (const uri of selection)
        {
            let stat: vscode.FileStat;

            try
            {
                stat = await vscode.workspace.fs.stat(uri);
            }
            catch (error)
            {
                this.logWarning(
                    `[push] Could not read selection entry ${uri.toString()}: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
                continue;
            }

            if ((stat.type & vscode.FileType.Directory) === 0)
            {
                fileUris.push(uri);
                continue;
            }

            let dirEntries: [string, vscode.FileType][];

            try
            {
                dirEntries = await vscode.workspace.fs.readDirectory(uri);
            }
            catch (error)
            {
                this.logWarning(
                    `[push] Could not read directory ${uri.toString()}: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
                continue;
            }

            for (const [name, type] of dirEntries)
            {
                if ((type & vscode.FileType.Directory) !== 0)
                {
                    nestedDirectories++;
                    continue;
                }

                fileUris.push(vscode.Uri.joinPath(uri, name));
            }
        }

        const files: PushFile[] = [];
        let skippedNotText = 0;

        for (const fileUri of fileUris)
        {
            let bytes: Uint8Array;

            try
            {
                bytes = await vscode.workspace.fs.readFile(fileUri);
            }
            catch (error)
            {
                this.logWarning(
                    `[push] Could not read ${fileUri.toString()}: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
                continue;
            }

            try
            {
                new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            }
            catch
            {
                skippedNotText++;
                this.logInfo(`[push] Skipped non-text file: ${fileUri.toString()}`);
                continue;
            }

            files.push({
                id: vscode.workspace.asRelativePath(fileUri, false),
                masterId: fileUri.fsPath,
                fileName: path.basename(fileUri.fsPath),
            });
        }

        const entries = planPushSet(files);

        this.logInfo(
            `[push] Derived ${entries.length} entr${entries.length === 1 ? "y" : "ies"} from the ` +
            `selection (${nestedDirectories} nested director${nestedDirectories === 1 ? "y" : "ies"} ` +
            `ignored, ${skippedNotText} file(s) skipped as not text).`,
        );

        return { entries, nestedDirectories, skippedNotText };
    }

    /**
     * Prompt for the push destination: a published object, then one of its
     * prims (steps 15–16). Revalidates both still exist immediately before
     * returning, since the object or prim can vanish between the two
     * sequential, asynchronous picks (step 17).
     */
    public async promptPushTarget(): Promise<PushTargetSelection | undefined>
    {
        const objects = summarizePushTargets(
            this.contentService.getObjects().map((entry) => entry.object),
        );

        const selection = await resolvePushTarget(objects, {
            async selectObject(choices)
            {
                const picked = await vscode.window.showQuickPick(
                    choices.map((choice) => ({
                        label: choice.label,
                        detail: choice.detail,
                        value: choice.value,
                    })),
                    { placeHolder: "Select the published object to push to" },
                );
                return picked?.value;
            },
            async selectPrim(choices)
            {
                const picked = await vscode.window.showQuickPick(
                    choices.map((choice) => ({ label: choice.label, value: choice.value })),
                    { placeHolder: "Select the target prim" },
                );
                return picked?.value;
            },
        });

        if (!selection)
        {
            return undefined;
        }

        const current = this.contentService.getObject(selection.objectId);
        const stillHasPrim = current && (
            current.object.object_id === selection.primId ||
            (current.object.linked_objects ?? []).some((linked) => linked.link_id === selection.primId)
        );

        if (!stillHasPrim)
        {
            this.logWarning(
                `[push] Target ${selection.objectName} / ${selection.primLabel} no longer exists; aborting.`,
            );
            return undefined;
        }

        return selection;
    }

    /**
     * Snapshot the target prim's inventory and resolve each entry's destination
     * set against it via the Phase 1 module (step 18). Ownership-based
     * link-first resolution is wired in by step 19; every item here is
     * currently unowned.
     */
    /**
     * Snapshot the target prim's inventory and resolve each entry's destination
     * set against it, stamping ownership first: for each entry, look up its
     * master's active sync (if any) and mark the items it already tracks on
     * this prim (step 19). `entry.masterId` must be a raw filesystem path —
     * `findSyncByMasterFilePath` canonicalizes internally; passing an
     * already-canonical URI here would double-canonicalize and silently fail
     * to match.
     */
    public resolvePushEntries(
        objectId: string,
        primId: string,
        entries: readonly PushEntry[],
    ): readonly PushResolvedEntry[]
    {
        const normalizedPrimId = primId === objectId ? null : primId;

        const inventory: PushInventoryItem[] = (this.contentService.getInventory(objectId, primId) ?? [])
            .map((item) => {
                const owningSync = this.synchService.findSyncByIdentity({
                    rootId: objectId,
                    primId: normalizedPrimId,
                    itemId: item.item_id,
                });

                return {
                    item,
                    linkedMasterId: owningSync?.getMasterFilePath(),
                };
            });

        return resolvePushDestinations(entries, inventory);
    }

    /**
     * Resolve entries against the target prim, then run the collision check
     * (step 20). Aborts before anything downstream — confirmation, validation,
     * execution — ever sees a colliding batch.
     */
    public planPush(
        objectId: string,
        primId: string,
        entries: readonly PushEntry[],
    ): PushPlanOutcome
    {
        const resolved = this.resolvePushEntries(objectId, primId, entries);
        const collisions = findPushCollisions(resolved);

        if (collisions.length > 0)
        {
            return { outcome: "collision", collisions };
        }

        if (!this.isViewerConnected())
        {
            return { outcome: "invalid", failure: { reason: "not-connected" } };
        }

        const current = this.contentService.getObject(objectId);

        if (!current)
        {
            return { outcome: "invalid", failure: { reason: "object-not-published" } };
        }

        const primPermissions = current.object.object_id === primId
            ? current.object.permissions
            : current.object.linked_objects?.find((linked) => linked.link_id === primId)?.permissions;
        const primCanModify = primPermissions !== undefined && (primPermissions.owner & PERM_MODIFY) !== 0;

        if (!primCanModify)
        {
            return { outcome: "invalid", failure: { reason: "no-modify-on-prim" } };
        }

        const itemIds = findPushPermissionFailures(resolved);

        if (itemIds.length > 0)
        {
            return { outcome: "invalid", failure: { reason: "no-modify-on-items", itemIds } };
        }

        return { outcome: "resolved", resolved };
    }

    /**
     * Show the single aggregate confirmation, built from the already-tested
     * buildPushConfirmationMessage(). Only called when there's something to
     * confirm — a conflicting (non-create) destination. "Skip" proceeds with
     * only the non-conflicting entries; "Cancel" (including Escape) writes
     * nothing.
     */
    public async confirmPush(
        target: PushTargetSelection,
        resolved: readonly PushResolvedEntry[],
        exclusions: PushExclusionCounts,
    ): Promise<"overwrite" | "skip" | "cancel">
    {
        const message = buildPushConfirmationMessage(
            { objectName: target.objectName, region: target.region, primLabel: target.primLabel },
            resolved,
            exclusions,
        );

        const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Overwrite", "Skip");

        if (choice === "Overwrite")
        {
            return "overwrite";
        }

        if (choice === "Skip")
        {
            return "skip";
        }

        return "cancel";
    }

    /**
     * Split dirty, selected files into those safe to save and those that are
     * already a tracked master. Saving an already-tracked master would fire
     * the same global `onDidSaveTextDocument` listener a user's Ctrl+S does,
     * which calls `ScriptSync.handleMasterSaved()` and fans out to every
     * virtual file that master is linked to — including ones on prims or
     * objects this push was never asked to touch. There is no way to save
     * such a document "quietly," so it is excluded, not saved.
     */
    public partitionDirtyPushFiles(
        entries: readonly PushEntry[],
    ): { safeToSave: readonly vscode.Uri[]; alreadyLinked: readonly vscode.Uri[] }
    {
        const dirtyUris = entries
            .map((entry) => vscode.Uri.file(entry.masterId))
            .filter((uri) => isTargetDirty(uri));

        const safeToSave: vscode.Uri[] = [];
        const alreadyLinked: vscode.Uri[] = [];

        for (const uri of dirtyUris)
        {
            if (this.synchService.findSyncByMasterFilePath(uri.fsPath))
            {
                alreadyLinked.push(uri);
            }
            else
            {
                safeToSave.push(uri);
            }
        }

        return { safeToSave, alreadyLinked };
    }

    /**
     * Offer one aggregate "save all" for files that are safe to save (step
     * 23). Declining proceeds with on-disk content as is. An already-linked
     * master is never included here (see partitionDirtyPushFiles) — its
     * current editor buffer, not a forced disk save, is what execution
     * (Phase 5) must read for it instead.
     */
    public async offerSaveDirtyPushFiles(entries: readonly PushEntry[]): Promise<void>
    {
        const { safeToSave, alreadyLinked } = this.partitionDirtyPushFiles(entries);

        if (safeToSave.length === 0)
        {
            return;
        }

        const note = alreadyLinked.length > 0
            ? ` ${alreadyLinked.length} already-linked file(s) will be pushed from their open editor content instead.`
            : "";
        const choice = await vscode.window.showWarningMessage(
            `${safeToSave.length} selected file(s) have unsaved changes. Save them before pushing?${note}`,
            { modal: true },
            "Save All",
        );

        if (choice !== "Save All")
        {
            return;
        }

        await Promise.all(
            safeToSave.map(async (uri) => {
                const document = vscode.workspace.textDocuments.find(
                    (doc) => doc.uri.toString() === uri.toString(),
                );
                await document?.save();
            }),
        );
    }

    /**
     * Produce push-ready content for one entry (step 24): scripts are
     * preprocessed and hashed/headered exactly as a normal master save would
     * produce them; notecards are sent verbatim, with no preprocessing and no
     * ScriptSync involvement at all. A preprocessor error fails only this
     * entry — the content is never delivered — it does not abort the run.
     * Prefers an already-open document's live buffer over a disk read, per
     * the step-23 forward reference, so a file excluded from "save all"
     * because it is already linked elsewhere still pushes what the user is
     * actually looking at.
     */
    public async producePushContent(entry: PushEntry): Promise<{ success: boolean; content: string }>
    {
        const masterUri = vscode.Uri.file(entry.masterId);
        logTrace(`[push] producePushContent: ${entry.id} (${entry.type}) from ${masterUri.fsPath}`);
        const originalContent = await this.readMasterContent(masterUri);

        if (entry.type === "notecard")
        {
            logTrace(`[push] ${entry.id} is a notecard; using content verbatim`);
            return { success: true, content: originalContent };
        }

        // Language is a property of the source file, never of the compile target: an
        // LSL file can target lsl2, mono, or luau, so `vm` alone can't disambiguate it.
        const language: ScriptLanguage = entry.matchName.toLowerCase().endsWith(".luau")
            ? "luau"
            : "lsl";
        logTrace(`[push] ${entry.id} derived language=${language} from matchName=${entry.matchName}`);
        const masterDocument = await vscode.workspace.openTextDocument(masterUri);
        const { sync, created } = await this.synchService.getOrCreateSync(masterDocument, language);
        const preprocessed = await sync.preProcessContentWithResult(originalContent);
        logTrace(`[push] ${entry.id} preprocessing ${preprocessed.success ? "succeeded" : "failed"}`);

        if (!preprocessed.success)
        {
            this.synchService.releaseUnattachedSync(sync, created);
            return { success: false, content: "" };
        }

        return { success: true, content: sync.finalizeSaveContent(preprocessed.content).content };
    }

    private async readMasterContent(masterUri: vscode.Uri): Promise<string>
    {
        const openDocument = vscode.workspace.textDocuments.find(
            (doc) => doc.uri.toString() === masterUri.toString(),
        );

        if (openDocument)
        {
            logTrace(`[push] Reading ${masterUri.fsPath} from its open editor buffer`);
            return openDocument.getText();
        }

        logTrace(`[push] Reading ${masterUri.fsPath} from disk`);
        const bytes = await vscode.workspace.fs.readFile(masterUri);
        return Buffer.from(bytes).toString("utf-8");
    }

    /**
     * Write pass for destinations that already exist: update, reuse and
     * relink entries (step 25). Unconditional — no hash comparison before
     * writing. Skips `create` destinations entirely; the create pass (step 26)
     * handles those. Content is produced once per entry and reused across all
     * of that entry's destinations, so a master linked to two items on the
     * target prim is preprocessed once and written twice. `writeContent` is
     * injectable for testing; production call sites can omit it.
     */
    public async pushUpdates(
        objectId: string,
        primId: string,
        resolved: readonly PushResolvedEntry[],
        summary: PushSummary,
        token: vscode.CancellationToken,
        writeContent: (uri: vscode.Uri, content: string) => Promise<void> = async (uri, content) =>
        {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
        },
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
        total?: number,
        linkedMasterUris: vscode.Uri[] = [],
    ): Promise<void>
    {
        const increment = total ? 100 / total : undefined;

        for (const { entry, destinations } of resolved)
        {
            const existing = destinations.filter((destination) => destination.disposition !== "create");

            if (existing.length === 0)
            {
                continue;
            }

            logTrace(`[push] pushUpdates: entry ${entry.id} has ${existing.length} destination(s)`);

            if (this.shouldStop(token, objectId, summary))
            {
                return;
            }

            const produced = await this.producePushContent(entry);

            if (!produced.success)
            {
                summary.preprocessorError++;
                for (const destination of existing)
                {
                    progress?.report({ message: `Skipped ${destination.item.name}: preprocessing failed`, increment });
                }
                continue;
            }

            const masterUri = vscode.Uri.file(entry.masterId);

            for (const destination of existing)
            {
                const targetUri = itemUri(objectId, primId, destination.item.item_id);
                logTrace(`[push] Writing ${destination.item.name} (${destination.disposition}) -> ${targetUri.toString()}`);

                try
                {
                    await writeContent(targetUri, produced.content);
                    summary.updated++;
                    this.logInfo(`[push] Updated ${destination.item.name}`);
                    progress?.report({ message: `Updated ${destination.item.name}`, increment });

                    if (destination.disposition !== "linked-update")
                    {
                        await this.linkPushedItem(
                            targetUri, produced.content, masterUri, destination.item.name, linkedMasterUris,
                        );
                    }
                }
                catch (error)
                {
                    summary.failed++;
                    this.logWarning(
                        `[push] Could not write ${destination.item.name}: ` +
                        `${error instanceof Error ? error.message : String(error)}`,
                    );
                    progress?.report({ message: `Failed to update ${destination.item.name}`, increment });
                }
            }
        }
    }

    /**
     * Full push command flow: intake the selection, prompt for a target,
     * plan and validate, confirm once, offer to save dirty files, then
     * execute. Each stage already has its own tests; this just assembles
     * them — the one piece previously missing end to end.
     */
    public async pushFilesToObject(selection: readonly vscode.Uri[]): Promise<void>
    {
        logTrace(`[push] pushFilesToObject: ${selection.length} selected entr${selection.length === 1 ? "y" : "ies"}`);
        const intake = await this.pushSelectedFiles(selection);
        logTrace(
            `[push] Intake: ${intake.entries.length} entries, ` +
            `${intake.nestedDirectories} nested director${intake.nestedDirectories === 1 ? "y" : "ies"} ignored, ` +
            `${intake.skippedNotText} skipped as not text`,
        );

        if (intake.entries.length === 0)
        {
            void vscode.window.showInformationMessage("Push: nothing to push from the selected files.");
            return;
        }

        logTrace("[push] Prompting for target object and prim...");
        const target = await this.promptPushTarget();

        if (!target)
        {
            logTrace("[push] Target selection cancelled.");
            return;
        }

        logTrace(`[push] Target: object="${target.objectName}" (${target.objectId}), prim="${target.primLabel}" (${target.primId})`);

        const outcome = this.planPush(target.objectId, target.primId, intake.entries);
        logTrace(`[push] Plan outcome: ${outcome.outcome}`);

        if (outcome.outcome === "invalid")
        {
            void vscode.window.showErrorMessage(`Push: ${this.describePushValidationFailure(outcome.failure)}`);
            return;
        }

        if (outcome.outcome === "collision")
        {
            void vscode.window.showErrorMessage(
                `Push: cancelled, colliding destinations (${this.describePushCollisions(outcome.collisions)}).`,
            );
            return;
        }

        logTrace(`[push] Resolved ${outcome.resolved.length} entr${outcome.resolved.length === 1 ? "y" : "ies"}`);

        const conflicts = findConflictingPushEntries(outcome.resolved);
        let entriesToExecute = outcome.resolved;

        if (conflicts.length > 0)
        {
            logTrace(
                `[push] ${conflicts.length} conflicting entr${conflicts.length === 1 ? "y" : "ies"}; ` +
                `requesting confirmation...`,
            );
            const choice = await this.confirmPush(target, outcome.resolved, {
                nestedDirectories: intake.nestedDirectories,
                notText: intake.skippedNotText,
            });
            logTrace(`[push] Confirmation: ${choice}`);

            if (choice === "cancel")
            {
                return;
            }

            if (choice === "skip")
            {
                entriesToExecute = outcome.resolved.filter((r) => !conflicts.includes(r));
            }
        }

        const executingEntries = entriesToExecute.map((r) => r.entry);

        logTrace("[push] Offering to save dirty files...");
        await this.offerSaveDirtyPushFiles(executingEntries);

        logTrace("[push] Executing push...");
        await this.executePush(target, entriesToExecute, {
            nestedDirectories: intake.nestedDirectories,
            skippedNotText: intake.skippedNotText,
        });
        logTrace("[push] pushFilesToObject complete.");
    }

    private describePushValidationFailure(failure: PushValidationFailure): string
    {
        switch (failure.reason)
        {
            case "not-connected": return "not connected to the viewer.";
            case "object-not-published": return "the target object is no longer published.";
            case "no-modify-on-prim": return "you do not have modify permission on the target prim.";
            case "no-modify-on-items": return "you do not have modify permission on one or more destination items.";
        }
    }

    private describePushCollisions(collisions: readonly PushCollision[]): string
    {
        return collisions
            .map((c) => c.kind === "overlapping-destination"
                ? `${c.entryIds.join(", ")} would all write the same item`
                : `${c.entryIds.join(", ")} would all create "${c.targetName}"`)
            .join("; ");
    }

    /**
     * Create pass for entries with no existing destination (step 26). The
     * provider's `/+create/` write only delivers content for notecards — a
     * created script is a server-generated template, ignoring whatever was
     * written — so a script needs a second, ordinary write to the new item
     * once it exists. The created item is identified by diffing the prim's
     * inventory before and after, not by name, since the simulator may
     * rename it on creation. Creates run strictly one at a time.
     */
    public async pushCreates(
        objectId: string,
        primId: string,
        resolved: readonly PushResolvedEntry[],
        summary: PushSummary,
        token: vscode.CancellationToken,
        writeContent: (uri: vscode.Uri, content: string) => Promise<void> = async (uri, content) =>
        {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
        },
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
        total?: number,
        linkedMasterUris: vscode.Uri[] = [],
    ): Promise<void>
    {
        const increment = total ? 100 / total : undefined;

        for (const { entry, destinations } of resolved)
        {
            if (!destinations.some((destination) => destination.disposition === "create"))
            {
                continue;
            }

            logTrace(`[push] pushCreates: entry ${entry.id} will create "${entry.matchName}"`);

            if (this.shouldStop(token, objectId, summary))
            {
                return;
            }

            const produced = await this.producePushContent(entry);

            if (!produced.success)
            {
                summary.preprocessorError++;
                progress?.report({ message: `Skipped ${entry.matchName}: preprocessing failed`, increment });
                continue;
            }

            const masterUri = vscode.Uri.file(entry.masterId);
            const before = new Set(
                (this.contentService.getInventory(objectId, primId) ?? []).map((item) => item.item_id),
            );
            const createTargetUri = createUri(objectId, primId, entry.matchName);
            this.logInfo(`[push] Creating ${entry.matchName} at ${createTargetUri.toString()}`);

            try
            {
                await writeContent(createTargetUri, produced.content);
            }
            catch (error)
            {
                summary.failed++;
                const errorDetail = error instanceof vscode.FileSystemError
                    ? `${error.name} (code=${error.code}): ${error.message}`
                    : error instanceof Error
                        ? `${error.name}: ${error.message}`
                        : String(error);
                this.logWarning(
                    `[push] Could not create ${entry.matchName} at ${createTargetUri.toString()}: ${errorDetail}`,
                );
                progress?.report({ message: `Failed to create ${entry.matchName}`, increment });
                continue;
            }

            const createdItem = (this.contentService.getInventory(objectId, primId) ?? [])
                .find((item) => !before.has(item.item_id));

            if (!createdItem)
            {
                summary.failed++;
                this.logWarning(`[push] Created ${entry.matchName}, but could not identify the new item`);
                progress?.report({ message: `Failed to create ${entry.matchName}`, increment });
                continue;
            }

            logTrace(`[push] Identified created item ${createdItem.item_id} ("${createdItem.name}") for ${entry.id}`);

            if (entry.type === "notecard")
            {
                summary.created++;
                this.logInfo(`[push] Created ${createdItem.name}`);
                progress?.report({ message: `Created ${createdItem.name}`, increment });
                await this.linkPushedItem(
                    itemUri(objectId, primId, createdItem.item_id), produced.content, masterUri, createdItem.name,
                    linkedMasterUris,
                );
                continue;
            }

            try
            {
                await writeContent(itemUri(objectId, primId, createdItem.item_id), produced.content);
                summary.created++;
                this.logInfo(`[push] Created ${createdItem.name}`);
                progress?.report({ message: `Created ${createdItem.name}`, increment });
            }
            catch (error)
            {
                summary.createdContentSaveFailed++;
                this.logWarning(
                    `[push] Created ${createdItem.name}, but saving its content failed: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
                progress?.report({ message: `Created ${createdItem.name}, but saving content failed`, increment });
            }

            await this.linkPushedItem(
                itemUri(objectId, primId, createdItem.item_id), produced.content, masterUri, createdItem.name,
                linkedMasterUris,
            );
        }
    }

    /**
     * Attach a written or created destination to its master (step 29),
     * exactly as pull does. Non-fatal: the file write already succeeded, so a
     * linking failure is logged, not counted as a failure.
     */
    private async linkPushedItem(
        targetUri: vscode.Uri,
        content: string,
        masterUri: vscode.Uri,
        itemName: string,
        linkedMasterUris: vscode.Uri[],
    ): Promise<void>
    {
        logTrace(`[push] Linking ${itemName} (${targetUri.toString()}) to master ${masterUri.fsPath}`);

        try
        {
            await this.synchService.linkSlItemToMaster(
                targetUri, content, masterUri, { reveal: false, refreshDecorator: false },
            );
            linkedMasterUris.push(masterUri);
        }
        catch (error)
        {
            this.logWarning(
                `[push] Wrote ${itemName} but linking failed: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Run the update pass then the create pass under one progress
     * notification (step 27), reporting once per destination written rather
     * than once per file, since a single entry may write to more than one
     * destination. Updates always run before creates.
     */
    public async executePush(
        target: PushTargetSelection,
        resolved: readonly PushResolvedEntry[],
        intake?: Pick<PushSelectionIntake, "nestedDirectories" | "skippedNotText">,
    ): Promise<PushSummary>
    {
        const summary: PushSummary = {
            updated: 0,
            created: 0,
            createdContentSaveFailed: 0,
            compileFailed: 0,
            preprocessorError: 0,
            skippedNotText: intake?.skippedNotText ?? 0,
            skippedNestedDirectory: intake?.nestedDirectories ?? 0,
            skippedTypeMismatch: 0,
            failed: 0,
            cancelled: false,
        };

        for (const ambiguous of findAmbiguousPushEntries(resolved))
        {
            summary.skippedTypeMismatch++;
            this.logWarning(
                `[push] Skipped ${ambiguous.entry.matchName}: a ${ambiguous.ambiguousType} with that name already exists`,
            );
        }

        const total = resolved.reduce((sum, r) => sum + r.destinations.length, 0);
        const linkedMasterUris: vscode.Uri[] = [];

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Pushing to ${target.objectName}`,
                cancellable: true,
            },
            async (progress, token) =>
            {
                await this.pushUpdates(
                    target.objectId, target.primId, resolved, summary, token, undefined, progress, total,
                    linkedMasterUris,
                );
                await this.pushCreates(
                    target.objectId, target.primId, resolved, summary, token, undefined, progress, total,
                    linkedMasterUris,
                );
            },
        );

        if (linkedMasterUris.length > 0)
        {
            this.synchService.refreshSyncedFileDecorator(linkedMasterUris);
        }

        this.showPushSummary(target.objectName, summary);
        return summary;
    }

    /**
     * Emit one summary notification plus full detail in the plugin log (step
     * 33). `created, content save failed` and `failed` get explicit
     * prominence: naming the count alone isn't enough since the former means
     * an empty item is now sitting in-world, so both upgrade the
     * notification from information to a warning.
     */
    private showPushSummary(objectName: string, summary: PushSummary): void
    {
        const interruption = summary.cancelled
            ? " cancelled"
            : summary.interrupted
                ? ` stopped: ${summary.interrupted}`
                : " complete";
        const message =
            `Push${interruption} for ${objectName}: ` +
            `${summary.updated} updated, ${summary.created} created, ` +
            `${summary.createdContentSaveFailed} created but content save failed, ` +
            `${summary.compileFailed} compile failed, ` +
            `${summary.preprocessorError} preprocessor error, ` +
            `${summary.skippedTypeMismatch} skipped (type mismatch), ` +
            `${summary.skippedNotText} skipped (not text), ` +
            `${summary.skippedNestedDirectory} skipped (nested directory), ` +
            `${summary.failed} failed.`;

        this.logInfo(`[push] ${message}`);

        if (summary.createdContentSaveFailed > 0 || summary.failed > 0)
        {
            void vscode.window.showWarningMessage(message);
        }
        else
        {
            void vscode.window.showInformationMessage(message);
        }
    }

    private shouldStop(
        token: vscode.CancellationToken,
        objectId: string,
        summary: { cancelled: boolean; interrupted?: string },
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
