/**
 * Pure, VS Code-independent helpers for the "pull object to workspace" and
 * "push files to object" features.
 * Anything here must be unit-testable without the extension host.
 */
import {
    InventoryItemType,
    ObjectInventoryItem,
    PERM_COPY,
    PERM_MODIFY,
    PublishedObject,
    ScriptVM,
} from "#sl-ide-ws-client";
import {
    sanitiseSegment,
    splitExtension,
    uniqueInDirectory,
} from "./shared/sharedutils";

export interface PullWorkspaceRoot<T>
{
    label: string;
    value: T;
}

export interface PullDestinationPrompter<T>
{
    selectWorkspaceRoot(
        roots: readonly PullWorkspaceRoot<T>[],
    ): Promise<PullWorkspaceRoot<T> | undefined>;
    enterDestinationFolder(defaultName: string): Promise<string | undefined>;
}

export interface PullDestination<T>
{
    workspaceRoot: T;
    folderName: string;
}

export type PullCollisionMode = "skip" | "overwrite";

export interface PullCollisionSummary
{
    existingNames: readonly string[];
    dirtyNames: readonly string[];
}

export interface PullCollisionPrompter
{
    promptCollisionMode(message: string): Promise<PullCollisionMode | undefined>;
}

const MAX_NAMES_IN_PROMPT = 10;

function formatNameList(names: readonly string[]): string
{
    return names.length <= MAX_NAMES_IN_PROMPT
        ? names.join(", ")
        : `${names.length} files`;
}

/** Build the one aggregate-collision prompt message (decision 2, invocation flow step 7). */
export function buildCollisionPromptMessage(summary: PullCollisionSummary): string
{
    const lines: string[] = [
        `${summary.existingNames.length} file(s) already exist in the destination: ` +
        `${formatNameList(summary.existingNames)}.`,
    ];

    if (summary.dirtyNames.length > 0)
    {
        lines.push(
            `${summary.dirtyNames.length} of these are open with unsaved changes and ` +
            `cannot be overwritten: ${formatNameList(summary.dirtyNames)}.`,
        );
    }

    lines.push("Skip existing files, or overwrite them?");
    return lines.join("\n");
}

/**
 * Resolve the collision mode for a pull run. Proceeds without prompting when
 * nothing collides; otherwise shows one aggregate prompt. Returns `undefined`
 * when the user cancels, meaning the whole pull should be aborted.
 */
export async function resolvePullCollisionMode(
    summary: PullCollisionSummary,
    prompter: PullCollisionPrompter,
): Promise<PullCollisionMode | undefined>
{
    if (summary.existingNames.length === 0)
    {
        return "skip";
    }

    return prompter.promptCollisionMode(buildCollisionPromptMessage(summary));
}

export interface PullTargetItem
{
    item: PullExportItem;
    relativeDirectory: readonly string[];
    fileName: string;
}

export class UnsafePullPathError extends Error
{
}

export type PullPathProbeResult = "missing" | "directory" | "file" | "symlink";

export interface PullPathProbe
{
    probe(candidateName: string): Promise<PullPathProbeResult>;
}

/**
 * Resolve the name to use for one required directory segment. The exact name
 * is used when it is missing (to be created) or already a directory (to be
 * reused). When it is occupied by a file, try `name_2`, `name_3`, ... until an
 * acceptable candidate is found - unique-ify the directory name rather than
 * abort (Destination layout).
 */
export async function resolveDirectorySegmentName(
    name: string,
    probe: PullPathProbe,
): Promise<string>
{
    for (let suffix = 1; ; suffix++)
    {
        const candidate = suffix === 1 ? name : `${name}_${suffix}`;
        const result = await probe.probe(candidate);

        if (result === "symlink")
        {
            throw new UnsafePullPathError(
                `Refusing to traverse symbolic link or junction: ${candidate}`,
            );
        }

        if (result !== "file")
        {
            return candidate;
        }
    }
}

function appendNumericSuffixPreservingExtension(name: string, suffix: number): string
{
    const extensionIndex = name.lastIndexOf(".");

    if (extensionIndex <= 0)
    {
        return `${name}_${suffix}`;
    }

    return `${name.slice(0, extensionIndex)}_${suffix}${name.slice(extensionIndex)}`;
}

export interface PullFileSegmentResolution
{
    name: string;
    existingFile: boolean;
}

/**
 * Resolve the filename to use for one pull target. The exact name is used
 * when it is missing or already an ordinary file (an existing-file collision
 * candidate for the skip/overwrite decision). When it is occupied by a
 * directory, try a suffixed variant, preserving any extension, until an
 * acceptable candidate is found - unique-ify the filename rather than abort
 * (Destination layout).
 */
export async function resolveFileSegmentName(
    name: string,
    probe: PullPathProbe,
): Promise<PullFileSegmentResolution>
{
    for (let suffix = 1; ; suffix++)
    {
        const candidate = suffix === 1 ? name : appendNumericSuffixPreservingExtension(name, suffix);
        const result = await probe.probe(candidate);

        if (result === "symlink")
        {
            throw new UnsafePullPathError(
                `Refusing to traverse symbolic link or junction: ${candidate}`,
            );
        }

        if (result === "missing")
        {
            return { name: candidate, existingFile: false };
        }

        if (result === "file")
        {
            return { name: candidate, existingFile: true };
        }
    }
}

export interface PullSummary
{
    written: number;
    overwritten: number;
    skippedExists: number;
    skippedDirty: number;
    skippedAppeared: number;
    skippedNoCopy: number;
    skippedNoModify: number;
    skippedPermissionsUnavailable: number;
    unreadable: number;
    failed: number;
    cancelled: boolean;
    interrupted?: string;
    linked: number;
    copiedNotLinked: number;
    writtenNotLinked: number;
}

export interface PullSnapshotItem
{
    objectId: string;
    primId: string;
    primName: string;
    linkNumber: number;
    isRoot: boolean;
    item: ObjectInventoryItem;
}

export interface PullObjectSnapshot
{
    objectId: string;
    objectName: string;
    items: readonly PullSnapshotItem[];
}

export type PullSkipReason =
    | "no-copy"
    | "no-modify"
    | "permissions-unavailable";

export interface PullExportItem extends PullSnapshotItem
{
    canLink: boolean;
}

export interface PullSkippedItem
{
    item: PullSnapshotItem;
    reason: PullSkipReason;
}

export interface PullExportPlan
{
    exportable: readonly PullExportItem[];
    skipped: readonly PullSkippedItem[];
}

function snapshotInventoryItem(item: ObjectInventoryItem): ObjectInventoryItem
{
    return {
        ...item,
        permissions: item.permissions ? { ...item.permissions } : undefined,
    };
}

/** Deeply snapshot a published object so later inventory or naming updates do not alter an in-progress pull. */
export function snapshotPullObject(object: PublishedObject): PullObjectSnapshot
{
    const items: PullSnapshotItem[] = object.inventory.map((item) => ({
        objectId: object.object_id,
        primId: object.object_id,
        primName: object.object_name,
        linkNumber: 1,
        isRoot: true,
        item: snapshotInventoryItem(item),
    }));

    for (const linkedObject of object.linked_objects ?? [])
    {
        for (const item of linkedObject.inventory)
        {
            items.push({
                objectId: object.object_id,
                primId: linkedObject.link_id,
                primName: linkedObject.link_name,
                linkNumber: linkedObject.link_number,
                isRoot: false,
                item: snapshotInventoryItem(item),
            });
        }
    }

    return {
        objectId: object.object_id,
        objectName: object.object_name,
        items,
    };
}

/**
 * Apply the permission rules: skip no-copy items, skip no-modify scripts
 * (their source is unavailable), and skip items with absent permission data.
 * A readable no-modify notecard is exportable but not link-eligible.
 */
export function planPullExport(snapshot: PullObjectSnapshot): PullExportPlan
{
    const exportable: PullExportItem[] = [];
    const skipped: PullSkippedItem[] = [];

    for (const item of snapshot.items)
    {
        const permissions = item.item.permissions;

        if (!permissions)
        {
            skipped.push({ item, reason: "permissions-unavailable" });
            continue;
        }

        if ((permissions.owner & PERM_COPY) === 0)
        {
            skipped.push({ item, reason: "no-copy" });
            continue;
        }

        const canModify = (permissions.owner & PERM_MODIFY) !== 0;

        if (item.item.type === "script" && !canModify)
        {
            skipped.push({ item, reason: "no-modify" });
            continue;
        }

        exportable.push({
            ...item,
            canLink: canModify,
        });
    }

    return { exportable, skipped };
}

/**
 * Sanitised equivalent of displayName() in src/vscode/objectcontentprovider.ts —
 * mirrored here (rather than imported) so this module stays free of a "vscode"
 * import and remains testable under plain Node. Shared by pull's target-naming
 * and push's decision 10 name match.
 */
export function sanitisedDisplayName(item: ObjectInventoryItem): string
{
    if (item.type === "notecard")
    {
        return sanitiseSegment(item.name);
    }

    const extension = item.subtype === 1 ? "luau" : "lsl";
    return sanitiseSegment(`${item.name}.${extension}`);
}

/**
 * Compute the deterministic target layout: root items go directly in the
 * destination, each child prim gets a `name_linknumber` subfolder (always
 * suffixed, not only on collision — decision 6), and filename collisions
 * within one prim are resolved in ascending item-ID order (decision 7).
 */
export function planPullTargets(plan: PullExportPlan): readonly PullTargetItem[]
{
    const itemsByPrim = new Map<string, PullExportItem[]>();

    for (const item of plan.exportable)
    {
        const items = itemsByPrim.get(item.primId) ?? [];
        items.push(item);
        itemsByPrim.set(item.primId, items);
    }

    const targets: PullTargetItem[] = [];

    for (const items of itemsByPrim.values())
    {
        const taken = new Set<string>();
        const sortedItems = [...items].sort((left, right) =>
            left.item.item_id.localeCompare(right.item.item_id),
        );

        for (const item of sortedItems)
        {
            const fileName = uniqueInDirectory(sanitisedDisplayName(item.item), taken);
            taken.add(fileName);
            const relativeDirectory = item.isRoot
                ? []
                : [sanitiseSegment(`${item.primName}_${item.linkNumber}`)];

            targets.push({
                item,
                relativeDirectory,
                fileName,
            });
        }
    }

    return targets;
}

/**
 * Resolve the single destination folder for a pull: use the only workspace
 * root automatically, prompt when multiple roots exist, then prompt for one
 * folder name pre-filled with the sanitised object name. The entered value
 * is sanitised as a single path segment, so separators cannot create nested
 * folders (decision 5).
 */
export async function resolvePullDestination<T>(
    workspaceRoots: readonly PullWorkspaceRoot<T>[],
    objectName: string,
    prompter: PullDestinationPrompter<T>,
): Promise<PullDestination<T> | undefined>
{
    if (workspaceRoots.length === 0)
    {
        return undefined;
    }

    let selectedRoot = workspaceRoots[0];

    if (workspaceRoots.length > 1)
    {
        const selected = await prompter.selectWorkspaceRoot(workspaceRoots);

        if (!selected)
        {
            return undefined;
        }

        selectedRoot = selected;
    }

    const enteredFolderName = await prompter.enterDestinationFolder(
        sanitiseSegment(objectName),
    );

    if (enteredFolderName === undefined)
    {
        return undefined;
    }

    return {
        workspaceRoot: selectedRoot.value,
        folderName: sanitiseSegment(enteredFolderName),
    };
}

interface ContentLine
{
    text: string;
    lineEnding: string;
}

const METADATA_BLOCK_OPEN =
    "================ sl-vscode-plugin meta ================";
const METADATA_BLOCK_CLOSE =
    "=======================================================";

function splitContentLines(content: string): ContentLine[]
{
    const parts = content.split(/(\r\n|\r|\n)/);
    const lines: ContentLine[] = [];

    for (let index = 0; index < parts.length; index += 2)
    {
        lines.push({
            text: parts[index],
            lineEnding: parts[index + 1] ?? "",
        });
    }

    return lines;
}

function commentContent(line: string, commentPrefix: string): string | undefined
{
    const withoutIndentation = line.trimStart();

    if (!withoutIndentation.startsWith(commentPrefix))
    {
        return undefined;
    }

    return withoutIndentation.slice(commentPrefix.length).trimStart();
}

function metadataBlockEnd(
    lines: readonly ContentLine[],
    commentPrefix: string,
): number
{
    if (
        commentContent(lines[0]?.text ?? "", commentPrefix)?.trim() !==
        METADATA_BLOCK_OPEN
    )
    {
        return -1;
    }

    return lines.findIndex(
        (line, index) =>
            index > 0 &&
            commentContent(line.text, commentPrefix)?.trim() ===
                METADATA_BLOCK_CLOSE,
    );
}

/**
 * Remove the generated plugin metadata block and every `@`-tagged generated
 * comment line (`@line`, `@file`, `@hash`, `@date`, `@creator`, `@creatorID`,
 * `@module`) from pulled script content. Notecards pass `commentPrefix === ""`
 * and are returned unchanged, since they have no comment syntax.
 */
export function stripGeneratedScriptMetadata(
    content: string,
    commentPrefix: string,
): string
{
    if (commentPrefix.length === 0)
    {
        return content;
    }

    const lines = splitContentLines(content);
    const blockEnd = metadataBlockEnd(lines, commentPrefix);
    const output: string[] = [];

    for (let index = 0; index < lines.length; index++)
    {
        if (index <= blockEnd)
        {
            continue;
        }

        const line = lines[index];
        const contentAfterComment = commentContent(line.text, commentPrefix);

        if (contentAfterComment?.startsWith("@"))
        {
            continue;
        }

        output.push(`${line.text}${line.lineEnding}`);
    }

    return output.join("");
}

// ============================================================================
// Push: pure planning helpers for "push files to object"
// ============================================================================

/** How a destination was resolved (decisions 10, 11/12, Finding 4's relink). */
export type PushDisposition = "linked-update" | "reuse" | "create" | "relink";

export type PushDestination =
    | { disposition: "linked-update" | "reuse"; item: ObjectInventoryItem }
    | { disposition: "relink"; item: ObjectInventoryItem; relinkedFromMasterId: string }
    | { disposition: "create" };

/** One selected file, after type/VM/name derivation (planPushSet). */
export interface PushEntry
{
    id: string;
    /** Opaque id of this entry's master file, compared against an inventory item's current owner to detect relink. */
    masterId: string;
    type: InventoryItemType;
    vm?: ScriptVM;
    targetName: string;
    /** Sanitised full filename (extension included even for scripts), compared against sanitisedDisplayName(item) — decision 10. Distinct from targetName, which has a script's synthetic extension already stripped for creation/display. */
    matchName: string;
}

export interface PushSummary
{
    updated: number;
    created: number;
    createdContentSaveFailed: number;
    compileFailed: number;
    preprocessorError: number;
    skippedNotText: number;
    skippedNestedDirectory: number;
    skippedTypeMismatch: number;
    failed: number;
    cancelled: boolean;
    interrupted?: string;
}

/**
 * Mirrors typeAndVmFromExtension() in src/vscode/objectcontentprovider.ts; duplicated
 * here (rather than imported) so this module stays free of a "vscode" import and
 * remains testable under plain Node.
 */
function typeAndVmFromExtension(extension: string): { type: InventoryItemType; vm?: ScriptVM }
{
    switch (extension.toLowerCase())
    {
        case ".luau": return { type: "script", vm: "luau" };
        case ".lsl":  return { type: "script", vm: "mono" };
        default:      return { type: "notecard" };
    }
}

export interface PushFile
{
    id: string;
    masterId: string;
    fileName: string;
}

/** Result of intaking a File Explorer selection: the derived push set plus exclusion counts (step 12/13). */
export interface PushSelectionIntake
{
    entries: readonly PushEntry[];
    nestedDirectories: number;
    skippedNotText: number;
}

export interface PushPrimSummary
{
    primId: string;
    /** Pre-formatted: "root prim" or "Name (link N)" — matches PushConfirmationContext.primLabel. */
    primLabel: string;
}

export interface PushPublishedObjectSummary
{
    objectId: string;
    objectName: string;
    region?: string;
    prims: readonly PushPrimSummary[];
}

export interface PushTargetSelection
{
    objectId: string;
    objectName: string;
    region?: string;
    primId: string;
    primLabel: string;
}

export type PushPlanOutcome =
    | { outcome: "invalid"; failure: PushValidationFailure }
    | { outcome: "collision"; collisions: readonly PushCollision[] }
    | { outcome: "resolved"; resolved: readonly PushResolvedEntry[] };

export type PushValidationFailureReason =
    | "not-connected"
    | "object-not-published"
    | "no-modify-on-prim"
    | "no-modify-on-items";

export interface PushValidationFailure
{
    reason: PushValidationFailureReason;
    /** Populated only for "no-modify-on-items". */
    itemIds?: readonly string[];
}

/**
 * Destination items (create has none) lacking PERM_MODIFY on their owner mask
 * (step 21). Absent permission data fails closed, matching pull's own
 * conservative precedent in planPullExport().
 */
export function findPushPermissionFailures(resolved: readonly PushResolvedEntry[]): readonly string[]
{
    const itemIds: string[] = [];

    for (const r of resolved)
    {
        for (const destination of r.destinations)
        {
            if (destination.disposition === "create")
            {
                continue;
            }

            const permissions = destination.item.permissions;
            const canModify = permissions !== undefined && (permissions.owner & PERM_MODIFY) !== 0;

            if (!canModify)
            {
                itemIds.push(destination.item.item_id);
            }
        }
    }

    return itemIds;
}

export interface PushTargetChoice<T>
{
    label: string;
    detail?: string;
    value: T;
}

export interface PushTargetPrompter
{
    selectObject(
        choices: readonly PushTargetChoice<PushPublishedObjectSummary>[],
    ): Promise<PushPublishedObjectSummary | undefined>;
    selectPrim(
        choices: readonly PushTargetChoice<PushPrimSummary>[],
    ): Promise<PushPrimSummary | undefined>;
}

/** Build object/prim summaries for the target picker: root prim first, then every linked prim, in order. */
export function summarizePushTargets(
    objects: readonly PublishedObject[],
): readonly PushPublishedObjectSummary[]
{
    return objects.map((object) => ({
        objectId: object.object_id,
        objectName: object.object_name,
        region: object.region,
        prims: [
            { primId: object.object_id, primLabel: "root prim" },
            ...(object.linked_objects ?? []).map((linked) => ({
                primId: linked.link_id,
                primLabel: `${linked.link_name} (link ${linked.link_number})`,
            })),
        ],
    }));
}

/**
 * Resolve the push destination via two sequential quick picks: a published
 * object, then one of its prims (decision 4). Returns undefined, before
 * anything downstream is touched, if there are no published objects or either
 * pick is dismissed.
 */
export async function resolvePushTarget(
    objects: readonly PushPublishedObjectSummary[],
    prompter: PushTargetPrompter,
): Promise<PushTargetSelection | undefined>
{
    if (objects.length === 0)
    {
        return undefined;
    }

    const selectedObject = await prompter.selectObject(
        objects.map((object) => ({
            label: object.objectName,
            detail: object.region,
            value: object,
        })),
    );

    if (!selectedObject)
    {
        return undefined;
    }

    const selectedPrim = await prompter.selectPrim(
        selectedObject.prims.map((prim) => ({
            label: prim.primLabel,
            value: prim,
        })),
    );

    if (!selectedPrim)
    {
        return undefined;
    }

    return {
        objectId: selectedObject.objectId,
        objectName: selectedObject.objectName,
        region: selectedObject.region,
        primId: selectedPrim.primId,
        primLabel: selectedPrim.primLabel,
    };
}

/** Derive {type, vm, targetName} per file (decisions 6, 7, 8). Scripts drop the synthetic extension; notecards keep the filename verbatim. */
export function planPushSet(files: readonly PushFile[]): readonly PushEntry[]
{
    return files.map((file) =>
    {
        const { stem, extension } = splitExtension(file.fileName);
        const { type, vm } = typeAndVmFromExtension(extension);

        return {
            id: file.id,
            masterId: file.masterId,
            type,
            vm,
            targetName: type === "notecard" ? file.fileName : stem,
            matchName: sanitiseSegment(file.fileName),
        };
    });
}

export interface PushInventoryItem
{
    item: ObjectInventoryItem;
    /** Opaque id of the master currently linked to this item on the target prim, if any. */
    linkedMasterId?: string;
}

export interface PushResolvedEntry
{
    entry: PushEntry;
    /** One or more destinations this entry writes; empty when the entry is ambiguous and excluded. */
    destinations: readonly PushDestination[];
    /** Set when a same-named item of a different type exists; the entry is excluded rather than written or created. */
    ambiguousType?: InventoryItemType;
}

/**
 * Resolve each entry's destination set against a snapshot of the target prim's
 * inventory (decisions 10, 11/12). Every item already linked to this entry's
 * master becomes the whole destination set, skipping name matching and creation
 * entirely. Otherwise a type-qualified name match is reused; a same-named item of
 * the other type marks the entry ambiguous instead of being written or created
 * alongside. Otherwise the destination is a new item to create.
 */
export function resolvePushDestinations(
    entries: readonly PushEntry[],
    inventory: readonly PushInventoryItem[],
): readonly PushResolvedEntry[]
{
    return entries.map((entry): PushResolvedEntry =>
    {
        const linked = inventory.filter((candidate) => candidate.linkedMasterId === entry.masterId);

        if (linked.length > 0)
        {
            return {
                entry,
                destinations: linked.map((candidate): PushDestination => ({
                    disposition: "linked-update",
                    item: candidate.item,
                })),
            };
        }

        const nameMatch = inventory.find(
            (candidate) => sanitisedDisplayName(candidate.item) === entry.matchName,
        );

        if (!nameMatch)
        {
            return { entry, destinations: [{ disposition: "create" }] };
        }

        if (nameMatch.item.type !== entry.type)
        {
            return { entry, destinations: [], ambiguousType: nameMatch.item.type };
        }

        if (nameMatch.linkedMasterId !== undefined)
        {
            return {
                entry,
                destinations: [{
                    disposition: "relink",
                    item: nameMatch.item,
                    relinkedFromMasterId: nameMatch.linkedMasterId,
                }],
            };
        }

        return { entry, destinations: [{ disposition: "reuse", item: nameMatch.item }] };
    });
}

export type PushCollisionKind = "overlapping-destination" | "duplicate-create-name";

export interface PushCollision
{
    kind: PushCollisionKind;
    entryIds: readonly string[];
    itemId?: string;
    targetName?: string;
}

/**
 * Report two entries that would write the same item, or two entries that would
 * both create the same target name (decisions 11, 13). Two entries sharing only a
 * target name, each resolved through its own links to a different item, is not a
 * collision.
 */
export function findPushCollisions(resolved: readonly PushResolvedEntry[]): readonly PushCollision[]
{
    const collisions: PushCollision[] = [];
    const entryIdsByItemId = new Map<string, string[]>();

    for (const r of resolved)
    {
        for (const destination of r.destinations)
        {
            if (destination.disposition === "create")
            {
                continue;
            }

            const ids = entryIdsByItemId.get(destination.item.item_id) ?? [];
            ids.push(r.entry.id);
            entryIdsByItemId.set(destination.item.item_id, ids);
        }
    }

    for (const [itemId, entryIds] of entryIdsByItemId)
    {
        const uniqueEntryIds = Array.from(new Set(entryIds));

        if (uniqueEntryIds.length > 1)
        {
            collisions.push({ kind: "overlapping-destination", entryIds: uniqueEntryIds, itemId });
        }
    }

    const creatingEntryIdsByName = new Map<string, string[]>();

    for (const r of resolved)
    {
        if (r.destinations.some((destination) => destination.disposition === "create"))
        {
            const ids = creatingEntryIdsByName.get(r.entry.targetName) ?? [];
            ids.push(r.entry.id);
            creatingEntryIdsByName.set(r.entry.targetName, ids);
        }
    }

    for (const [targetName, entryIds] of creatingEntryIdsByName)
    {
        if (entryIds.length > 1)
        {
            collisions.push({ kind: "duplicate-create-name", entryIds, targetName });
        }
    }

    return collisions;
}

/**
 * Entries excluded because a same-named item of a different type already
 * exists on the target prim (ambiguousType set by resolvePushDestinations) —
 * never written or created, and otherwise silently dropped from the summary.
 */
export function findAmbiguousPushEntries(
    resolved: readonly PushResolvedEntry[],
): readonly PushResolvedEntry[]
{
    return resolved.filter((r) => r.ambiguousType !== undefined);
}

/**
 * Entries that would overwrite something already in-world — any destination
 * other than `create` (update, reuse, relink). Used to decide whether the
 * single aggregate confirmation needs to be shown at all: a batch of pure
 * creates has nothing to conflict with and can proceed without a prompt.
 */
export function findConflictingPushEntries(
    resolved: readonly PushResolvedEntry[],
): readonly PushResolvedEntry[]
{
    return resolved.filter((r) => r.destinations.some((d) => d.disposition !== "create"));
}

export interface PushConfirmationContext
{
    objectName: string;
    region?: string;
    /** Pre-formatted by the caller: "root prim" or "Name (link N)". */
    primLabel: string;
}

export interface PushExclusionCounts
{
    nestedDirectories: number;
    notText: number;
}

const SIMPLE_DISPOSITION_LABELS: Record<"linked-update" | "reuse", string> = {
    "linked-update": "linked update",
    reuse: "reuse",
};

/**
 * Build the single aggregate confirmation shown before any push mutation
 * (decisions 2, 14, 16). Leads with the destination, then one line per
 * destination naming its disposition and in-world name, then exclusion counts.
 * Ambiguous entries are derived from `resolved` rather than supplied separately,
 * since PushResolvedEntry already carries that state. `entry.id` is used as the
 * display label, so callers should assign something display-worthy there.
 */
export function buildPushConfirmationMessage(
    context: PushConfirmationContext,
    resolved: readonly PushResolvedEntry[],
    exclusions: PushExclusionCounts,
): string
{
    const lines: string[] = [
        `Push to ${context.objectName}${context.region ? ` (${context.region})` : ""}`,
        `Target: ${context.primLabel}`,
        "",
    ];

    for (const r of resolved)
    {
        for (const destination of r.destinations)
        {
            if (destination.disposition === "create")
            {
                lines.push(`${r.entry.id}: create "${r.entry.targetName}"`);
                continue;
            }

            const name = sanitisedDisplayName(destination.item);

            if (destination.disposition === "relink")
            {
                lines.push(
                    `${r.entry.id}: relink "${name}" (currently updated by ${destination.relinkedFromMasterId})`,
                );
                continue;
            }

            lines.push(`${r.entry.id}: ${SIMPLE_DISPOSITION_LABELS[destination.disposition]} "${name}"`);
        }
    }

    const exclusionLines: string[] = [];

    if (exclusions.nestedDirectories > 0)
    {
        exclusionLines.push(
            `${exclusions.nestedDirectories} nested director${exclusions.nestedDirectories === 1 ? "y" : "ies"} ignored`,
        );
    }

    if (exclusions.notText > 0)
    {
        exclusionLines.push(`${exclusions.notText} file(s) skipped (not text)`);
    }

    for (const r of resolved)
    {
        if (r.ambiguousType !== undefined)
        {
            exclusionLines.push(
                `${r.entry.id}: skipped, found existing ${r.ambiguousType} named "${r.entry.targetName}"`,
            );
        }
    }

    if (exclusionLines.length > 0)
    {
        lines.push("", ...exclusionLines);
    }

    return lines.join("\n");
}
