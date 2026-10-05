/**
 * Pure, VS Code-independent helpers for the "pull object to workspace" feature.
 * Anything here must be unit-testable without the extension host.
 */
import {
    ObjectInventoryItem,
    PERM_COPY,
    PERM_MODIFY,
    PublishedObject,
} from "#sl-ide-ws-client";
import {
    sanitiseSegment,
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

export interface PullTargetItem
{
    item: PullExportItem;
    relativeDirectory: readonly string[];
    fileName: string;
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

function pulledFileName(item: PullExportItem): string
{
    if (item.item.type === "notecard")
    {
        return sanitiseSegment(item.item.name);
    }

    // Mirrors languageForItem() in src/vscode/objectcontentprovider.ts; duplicated
    // here (rather than imported) so this module stays free of a "vscode" import
    // and remains testable under plain Node.
    const extension = item.item.subtype === 1 ? "luau" : "lsl";
    return sanitiseSegment(`${item.item.name}.${extension}`);
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
            const fileName = uniqueInDirectory(pulledFileName(item), taken);
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
