// Webview-side script for the Second Life inworld explorer.
// NOTE: No imports/exports — runs as a global script in the webview context.

declare const acquireVsCodeApi: () => {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

export {};

// ============================================
// Types
// ============================================

interface PublishedObject {
    object_id: string;
    object_name: string;
    object_description?: string;
    region?: string;
    can_save_back?: boolean;
    inventory: InventoryItem[];
    linked_objects?: LinkedObject[];
}

interface InventoryItem {
    item_id: string;
    name: string;
    description?: string;
    type: "script" | "notecard";
    subtype?: number;
    vm?: string;
    running?: boolean;
    permissions?: { owner: number; next_owner: number };
}

interface LinkedObject {
    link_id: string;
    link_number: number;
    link_name: string;
    link_description?: string;
    inventory: InventoryItem[];
}

interface PinnedObjectView {
    object_id: string;
    object_name: string;
    unavailableReason?: "not_found" | "error";
}

interface ExplorerState {
    objects: PublishedObject[];
    pinnedObjects: PinnedObjectView[];
    connected: boolean;
    expanded: string[];
    filter: string;
    pinnedObjectIds: string[];
    focusedId?: string;
}

// ============================================
// Constants
// ============================================

const PERM_MODIFY = 0x4000;
const PERM_COPY = 0x8000;
const PERM_TRANSFER = 0x2000;

// ============================================
// State
// ============================================

const vscode = acquireVsCodeApi();

let state: ExplorerState = {
    objects: [],
    pinnedObjects: [],
    connected: false,
    expanded: [],
    filter: "",
    pinnedObjectIds: [],
};

const savedState = vscode.getState() as ExplorerState | undefined;
if (savedState) {
    state = { ...state, ...savedState };
}

// Active context menu element, if any
let activeMenu: HTMLElement | null = null;
let menuDeactivationTimer: number | null = null;
let activeSubmenu: HTMLElement | null = null;

function isAnyMenuHovered(): boolean {
    return !!document.querySelector(".context-menu:hover");
}

function stopMenuDeactivationWatchdog(): void {
    if (menuDeactivationTimer !== null) {
        window.clearInterval(menuDeactivationTimer);
        menuDeactivationTimer = null;
    }
}

function maybeCloseMenuOnDeactivation(): void {
    if (!activeMenu) {
        stopMenuDeactivationWatchdog();
        return;
    }
    if (!document.hasFocus() && !isAnyMenuHovered()) {
        closeMenu();
    }
}

function startMenuDeactivationWatchdog(): void {
    stopMenuDeactivationWatchdog();
    menuDeactivationTimer = window.setInterval(() => {
        maybeCloseMenuOnDeactivation();
    }, 100);
}

let viewerCommands = new Set<string>();

// Keyboard navigation
let treeHasFocus = false;

// ============================================
// Initialization
// ============================================

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-refresh")?.addEventListener("click", () => {
        vscode.postMessage({ command: "refresh", payload: {} });
    });

    document.getElementById("filter-input")?.addEventListener("input", (e) => {
        state.filter = (e.target as HTMLInputElement).value.toLowerCase();
        saveState();
        renderTree();
    });

    // Dismiss context menu when clicking outside or pressing Escape
    document.addEventListener("click", () => closeMenu());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); } });

    // Fast-path close for common deactivation events.
    window.addEventListener("blur", () => {
        window.setTimeout(() => {
            maybeCloseMenuOnDeactivation();
        }, 0);
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            maybeCloseMenuOnDeactivation();
        }
    });

    // Keyboard focus tracking
    document.getElementById("tree-container")?.addEventListener("mousedown", () => { treeHasFocus = true; });
    document.addEventListener("mousedown", (e) => {
        if (!(e.target as HTMLElement).closest("#tree-container")) { treeHasFocus = false; }
    });

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
        if (!treeHasFocus || activeMenu) { return; }
        const rows = Array.from(document.querySelectorAll<HTMLElement>(".node-header"));
        if (rows.length === 0) { return; }
        const focusedEl = document.querySelector<HTMLElement>(".node-header.focused");
        const currentIdx = focusedEl ? rows.indexOf(focusedEl) : -1;

        const expand = () => {
            if (!focusedEl) { return; }
            const toggle = focusedEl.dataset["toggle"];
            if (!toggle) { return; }
            if (state.expanded.includes(toggle)) {
                const next = rows[currentIdx + 1];
                if (next) { setFocus(next); }
            } else {
                state.expanded.push(toggle);
                saveState();
                renderTree();
            }
        };

        const collapse = () => {
            if (!focusedEl) { return; }
            const toggle = focusedEl.dataset["toggle"];
            if (!toggle) { return; }
            const idx = state.expanded.indexOf(toggle);
            if (idx >= 0) {
                state.expanded.splice(idx, 1);
                saveState();
                renderTree();
            }
        };

        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setFocus(rows[currentIdx === -1 ? 0 : Math.min(currentIdx + 1, rows.length - 1)]);
                break;
            case "ArrowUp":
                e.preventDefault();
                setFocus(rows[Math.max(0, currentIdx - 1)]);
                break;
            case "ArrowRight":
            case "+":
                e.preventDefault();
                expand();
                break;
            case "ArrowLeft":
            case "-":
                e.preventDefault();
                collapse();
                break;
            case "Enter": {
                e.preventDefault();
                if (!focusedEl) { break; }
                const itemEl = focusedEl.closest<HTMLElement>(".item");
                if (itemEl) {
                    const type = itemEl.dataset["type"];
                    const canModify = itemEl.dataset["canModify"] === "true";
                    if (type === "script" && !canModify) { break; }
                    const uri = itemEl.dataset["uri"];
                    if (uri) { vscode.postMessage({ command: "openItem", payload: { uri, preview: false } }); }
                } else {
                    const toggle = focusedEl.dataset["toggle"];
                    if (toggle) {
                        const idx = state.expanded.indexOf(toggle);
                        if (idx >= 0) { state.expanded.splice(idx, 1); } else { state.expanded.push(toggle); }
                        saveState();
                        renderTree();
                    }
                }
                break;
            }
            case "Delete": {
                e.preventDefault();
                if (!focusedEl) { break; }
                const itemEl = focusedEl.closest<HTMLElement>(".item");
                if (!itemEl) { break; }
                vscode.postMessage({ command: "deleteItem", payload: {
                    object_id: itemEl.dataset["object"]!,
                    prim_id: itemEl.dataset["prim"]!,
                    item_id: itemEl.dataset["item"]!,
                } });
                break;
            }
        }
    });

    // Right-click context menu via event delegation on the stable container
    document.getElementById("tree-container")?.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const target = e.target as HTMLElement;
        const pos = { x: e.clientX, y: e.clientY };
        const itemEl = target.closest<HTMLElement>(".item");
        if (itemEl) { showItemMenu(pos, itemEl); return; }
        const primEl = target.closest<HTMLElement>(".tree-node.linked-prim");
        if (primEl) { showPrimMenu(pos, primEl); return; }
        const objectEl = target.closest<HTMLElement>(".tree-node.object");
        if (objectEl) { showObjectMenu(pos, objectEl); return; }
    });

    render();
});

// ============================================
// Message Handling
// ============================================

window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as { type: string; payload: Record<string, unknown> };

    switch (message.type) {
        case "refresh":
            state.objects = message.payload["objects"] as PublishedObject[];
            state.pinnedObjects = (message.payload["pinnedObjects"] as PinnedObjectView[]) ?? [];
            state.connected = message.payload["connected"] as boolean;
            state.pinnedObjectIds = (message.payload["pinnedObjectIds"] as string[]) ?? [];
            render();
            break;

        case "connectionState": {
            const nowConnected = message.payload["connected"] as boolean;
            if (nowConnected && !state.connected)
            {
                // Clear any selection carried over from before this connection.
                state.focusedId = undefined;
            }
            state.connected = nowConnected;
            render();
            break;
        }

        case "updateItem":
            updateItemRunningState(
                message.payload["item_id"] as string,
                message.payload["running"] as boolean
            );
            break;

        case "updateItemVM":
            updateItemVmState(message.payload["item_id"] as string, message.payload["vm"] as string);
            break;

        case "viewerCommands":
            viewerCommands = new Set<string>(message.payload["commands"] as string[]);
            break;
    }

    saveState();
});

// ============================================
// Rendering
// ============================================

function render(): void {
    updateConnectionStatus();
    renderTree();
}

function getConnectedRegionLabel(): string {
    const region = state.objects
        .map((o) => o.region?.trim())
        .find((r): r is string => Boolean(r && r.length > 0));

    if (!region) {
        return "";
    }

    return ` - ${region}`;
}

function updateConnectionStatus(): void {
    const el = document.getElementById("connection-status");
    if (!el) { return; }
    if (state.connected) {
        const regionSuffix = getConnectedRegionLabel();
        el.innerHTML =
            `<span class="status-dot connected"></span> Connected${escapeHtml(regionSuffix)}`;
        el.className = "connected";
    } else {
        el.innerHTML = '<span class="status-dot disconnected"></span> Disconnected';
        el.className = "disconnected";
    }
}

function renderTree(): void {
    const container = document.getElementById("tree-container");
    if (!container) { return; }

    if (!state.connected) {
        const pinnedFiltered = state.filter
            ? state.pinnedObjects.filter((obj) => obj.object_name.toLowerCase().includes(state.filter) || obj.object_id.toLowerCase().includes(state.filter))
            : state.pinnedObjects;

        if (pinnedFiltered.length > 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>Viewer disconnected</p>
                    <p class="hint">Pinned objects are shown offline</p>
                    <button id="btn-connect">Connect</button>
                </div>
                <div class="offline-pinned-list">
                    ${pinnedFiltered.map((obj) => renderPinnedObject(obj)).join("")}
                </div>`;
            document.getElementById("btn-connect")?.addEventListener("click", () => {
                vscode.postMessage({ command: "connect", payload: {} });
            });
            attachEventListeners();
            return;
        }

        container.innerHTML = `
            <div class="empty-state">
                <p>Connect to viewer to see in-world objects</p>
                <button id="btn-connect">Connect</button>
            </div>`;
        document.getElementById("btn-connect")?.addEventListener("click", () => {
            vscode.postMessage({ command: "connect", payload: {} });
        });
        return;
    }

    const expandedSet = new Set(state.expanded);
    const filtered = state.filter
        ? state.objects.filter((obj) => matchesFilter(obj))
        : state.objects;

    const connectedObjectIds = new Set(state.objects.map((obj) => obj.object_id));
    const unavailablePinned = state.pinnedObjects.filter((obj) => {
        if (connectedObjectIds.has(obj.object_id)) {
            return false;
        }
        if (!state.filter) {
            return true;
        }
        return obj.object_name.toLowerCase().includes(state.filter) || obj.object_id.toLowerCase().includes(state.filter);
    });

    if (filtered.length === 0 && unavailablePinned.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No objects explored</p>
                <p class="hint">Use "Explore Object" in the viewer</p>
            </div>`;
        return;
    }

    container.innerHTML =
        filtered.map((obj) => renderObject(obj, expandedSet)).join("") +
        unavailablePinned.map((obj) => renderPinnedObject(obj)).join("");
    attachEventListeners();
    restoreFocus();
}

function updateItemRunningState(item_id: string, running: boolean): void {
    const itemEl = document.querySelector<HTMLElement>(`[data-item="${item_id}"]`);
    if (!itemEl) { return; }
    const indicator = itemEl.querySelector(".running-indicator");
    if (indicator) {
        indicator.classList.toggle("active", running);
    }
    const toggleBtn = itemEl.querySelector<HTMLElement>(".toggle-run");
    if (toggleBtn) {
        toggleBtn.dataset["running"] = String(running);
        toggleBtn.innerHTML = running ? "&#9632;" : "&#9654;";
        toggleBtn.title = running ? "Stop script" : "Start script";
    }
    itemEl.classList.toggle("running", running);
}

function updateItemVmState(item_id: string, vm: string): void {
    const itemEl = document.querySelector<HTMLElement>(`[data-item="${item_id}"]`);
    if (itemEl) { itemEl.dataset["vm"] = vm; }
    for (const obj of state.objects) {
        const patch = (inv: InventoryItem[]) => { const i = inv.find((x) => x.item_id === item_id); if (i) { i.vm = vm; } };
        patch(obj.inventory);
        for (const lo of obj.linked_objects ?? []) { patch(lo.inventory); }
    }
    saveState();
}

function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Display Helpers
// ============================================

function itemDisplayName(item: InventoryItem): string {
    if (item.type === "notecard") { return item.name; }
    return item.name + (item.subtype === 1 ? ".luau" : ".lsl");
}

function itemUri(object_id: string, prim_id: string, item: InventoryItem): string {
    const name = itemDisplayName(item);
    if (prim_id === object_id) {
        return `sl://objects/${object_id}/${encodeURIComponent(name)}`;
    }
    return `sl://objects/${object_id}/${prim_id}/${encodeURIComponent(name)}`;
}

function permissionIcons(item: InventoryItem): string {
    const perms = item.permissions;
    if (!perms) { return ""; }
    let icons = "";
    if ((perms.owner & PERM_MODIFY) === 0) { icons += `<span class="perm-icon perm-icon-no-mod" title="No Modify"></span>`; }
    if ((perms.owner & PERM_COPY) === 0) { icons += `<span class="perm-icon perm-icon-no-copy" title="No Copy"></span>`; }
    if ((perms.owner & PERM_TRANSFER) === 0) { icons += `<span class="perm-icon perm-icon-no-trans" title="No Transfer"></span>`; }
    return icons;
}

function matchesFilter(obj: PublishedObject): boolean {
    const f = state.filter;
    const parts = [
        obj.object_name,
        obj.region ?? "",
        ...obj.inventory.map(itemDisplayName),
        ...(obj.linked_objects ?? []).flatMap((lo) => lo.inventory.map(itemDisplayName)),
    ];
    return parts.some((s) => s.toLowerCase().includes(f));
}

// ============================================
// Tree Render Functions
// ============================================

function renderObject(obj: PublishedObject, expandedSet: Set<string>): string {
    const isExpanded = expandedSet.has(obj.object_id);
    const hasLinkedPrims = obj.linked_objects?.some((lo) => lo.inventory.length > 0) ?? false;
    const isPinned = state.pinnedObjectIds.includes(obj.object_id);
    const pinTitle = isPinned ? "Unpin object" : "Pin object";
    const iconClass = hasLinkedPrims ? "file-icon-object-multi" : "file-icon-object";
    return `
        <div class="tree-node object"
             data-object-id="${obj.object_id}">
            <div class="node-header" data-toggle="${obj.object_id}"
                 title="${escapeHtml([obj.object_name, obj.object_description].filter(Boolean).join('\n'))}">
                <span class="expand-icon">${isExpanded ? "\u25BC" : "\u25B6"}</span>
                <span class="file-icon ${iconClass}"></span>
                <span class="label">${escapeHtml(obj.object_name)}</span>
                <button class="action-btn more" title="More actions" aria-label="More actions">\u22EE</button>
                <button class="action-btn pin-object" title="${pinTitle}" aria-label="${pinTitle}">
                    <span class="codicon ${isPinned ? "codicon-pinned" : "codicon-pin"}" aria-hidden="true"></span>
                </button>
            </div>
            ${obj.object_description ? `<div class="node-meta">${escapeHtml(obj.object_description)}</div>` : ""}
            ${isExpanded ? renderObjectContents(obj, expandedSet) : ""}
        </div>`;
}

function renderPinnedObject(obj: PinnedObjectView): string {
    const isPinned = state.pinnedObjectIds.includes(obj.object_id);
    const pinTitle = isPinned ? "Unpin object" : "Pin object";
    const unavailableError = state.connected && obj.unavailableReason === "error";
    const rowClass = unavailableError
        ? "tree-node object disconnected unavailable-error"
        : "tree-node object disconnected";
    const metaText = unavailableError ? "Pinned object (unavailable)" : "Pinned object (offline)";
    return `
        <div class="${rowClass}"
             data-object-id="${obj.object_id}">
            <div class="node-header" title="${obj.object_name} (offline)">
                <span class="expand-icon"></span>
                <span class="file-icon file-icon-object"></span>
                <span class="label">${escapeHtml(obj.object_name)}</span>
                ${unavailableError ? '<span class="perm-icons"><span class="perm-icon perm-icon-no-mod" title="No modify / inaccessible"></span></span>' : ""}
                <button class="action-btn more" title="More actions" aria-label="More actions" disabled aria-disabled="true">\u22EE</button>
                <button class="action-btn pin-object" title="${pinTitle}" aria-label="${pinTitle}">
                    <span class="codicon ${isPinned ? "codicon-pinned" : "codicon-pin"}" aria-hidden="true"></span>
                </button>
            </div>
            <div class="node-meta">${metaText}</div>
        </div>`;
}

function renderObjectContents(obj: PublishedObject, expandedSet: Set<string>): string {
    const sorted = [...obj.inventory].sort((a, b) => itemDisplayName(a).localeCompare(itemDisplayName(b)));
    const items = sorted.map((item) => renderItem(obj.object_id, obj.object_id, item)).join("");
    const linkedPrims = (obj.linked_objects ?? [])
        .filter((lo) => lo.inventory.length > 0)
        .map((lo) => renderLinkedPrim(obj.object_id, lo, expandedSet))
        .join("");
    return `<div class="children">${linkedPrims}${items}</div>`;
}

function renderLinkedPrim(object_id: string, lo: LinkedObject, expandedSet: Set<string>): string {
    const isExpanded = expandedSet.has(lo.link_id);
    return `
        <div class="tree-node linked-prim"
             data-object-id="${object_id}"
             data-prim-id="${lo.link_id}">
            <div class="node-header" data-toggle="${lo.link_id}"
                 title="${[lo.link_name, `Link #${lo.link_number}`, lo.link_description].filter(Boolean).join('\n')}">
                <span class="expand-icon">${isExpanded ? "\u25BC" : "\u25B6"}</span>
                <span class="file-icon file-icon-object"></span>
                <span class="label">${escapeHtml(lo.link_name)} (link #${lo.link_number})</span>
            </div>
            ${lo.link_description ? `<div class="node-meta">${escapeHtml(lo.link_description)}</div>` : ""}
            ${isExpanded ? `<div class="children">${[...lo.inventory].sort((a, b) => itemDisplayName(a).localeCompare(itemDisplayName(b))).map((item) => renderItem(object_id, lo.link_id, item)).join("")}</div>` : ""}
        </div>`;
}

function renderItem(object_id: string, prim_id: string, item: InventoryItem): string {
    const isScript = item.type === "script";
    const iconClass = item.type === "notecard" ? "file-icon-notecard" : (item.subtype === 1 ? "file-icon-script-luau" : "file-icon-script-lsl");
    const label = itemDisplayName(item);
    const nameLabel = item.name;
    const uri = itemUri(object_id, prim_id, item);
    const canModify = !item.permissions || (item.permissions.owner & PERM_MODIFY) !== 0;
    const permIcons = permissionIcons(item);
    const languageLabel = item.subtype === 1 ? "Luau Script" : "LSL Script";
    const typeLabel = item.type === "notecard" ? "Notecard" : languageLabel;

    return `
        <div class="tree-node item${item.running ? " running" : ""}"
             data-object="${object_id}"
             data-prim="${prim_id}"
             data-item="${item.item_id}"
             data-uri="${uri}"
             data-type="${item.type}"
             data-subtype="${item.subtype ?? 0}"
             data-vm="${item.vm ?? ""}"
             data-name="${item.name}"
             data-can-modify="${canModify}">
            <div class="node-header item-row"
                 title="${[label, typeLabel, item.description].filter(Boolean).join('\n')}">
                <span class="file-icon ${iconClass}"></span>
                <span class="label">${escapeHtml(nameLabel)}</span>
                ${permIcons ? `<span class="perm-icons">${permIcons}</span>` : ""}
                ${isScript ? `<span class="running-indicator${item.running ? " active" : ""}"></span>` : ""}
                ${isScript ? `<button class="action-btn toggle-run" data-running="${item.running ?? false}" title="${item.running ? "Stop script" : "Start script"}">${item.running ? "&#9632;" : "&#9654;"}</button>` : ""}
                <button class="action-btn more" title="More actions">\u22EE</button>
            </div>
        </div>`;
}

function attachEventListeners(): void {
    // Expand/collapse
    document.querySelectorAll<HTMLElement>("[data-toggle]").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = el.dataset["toggle"]!;
            const idx = state.expanded.indexOf(id);
            if (idx >= 0) {
                state.expanded.splice(idx, 1);
            } else {
                state.expanded.push(id);
            }
            saveState();
            renderTree();
        });
    });

    // Open item on single click as preview, double-click for full editor
    document.querySelectorAll<HTMLElement>(".item .node-header").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const itemEl = el.closest<HTMLElement>(".item");
            if (!itemEl) { return; }
            const type = itemEl.dataset["type"];
            const canModify = itemEl.dataset["canModify"] === "true";
            if (type === "script" && !canModify) { return; }
            const uri = itemEl.dataset["uri"];
            if (!uri) { return; }
            vscode.postMessage({ command: "openItem", payload: { uri, preview: true } });
        });
        el.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            const itemEl = el.closest<HTMLElement>(".item");
            if (!itemEl) { return; }
            const type = itemEl.dataset["type"];
            const canModify = itemEl.dataset["canModify"] === "true";
            if (type === "script" && !canModify) { return; }
            const uri = itemEl.dataset["uri"];
            if (!uri) { return; }
            vscode.postMessage({ command: "openItem", payload: { uri, preview: false } });
        });
    });

    // Play/stop toggle
    document.querySelectorAll<HTMLElement>(".toggle-run").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const itemEl = btn.closest<HTMLElement>(".item");
            if (!itemEl) { return; }
            const running = btn.dataset["running"] === "true";
            vscode.postMessage({
                command: "toggleRunning",
                payload: {
                    object_id: itemEl.dataset["object"]!,
                    prim_id: itemEl.dataset["prim"]!,
                    item_id: itemEl.dataset["item"]!,
                    running: !running,
                },
            });
        });
    });

    // Pin/unpin (provider-authoritative)
    document.querySelectorAll<HTMLElement>(".action-btn.pin-object").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const objectEl = btn.closest<HTMLElement>(".tree-node.object");
            if (!objectEl) { return; }
            const object_id = objectEl.dataset["objectId"];
            if (!object_id) { return; }
            vscode.postMessage({ command: "togglePinObject", payload: { object_id } });
        });
    });

    // Click to focus
    document.querySelectorAll<HTMLElement>(".node-header").forEach((el) => {
        el.addEventListener("click", () => setFocus(el));
    });

    // More-actions menu
    document.querySelectorAll<HTMLElement>(".action-btn.more").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const itemEl = el.closest<HTMLElement>(".item");
            if (itemEl) { showItemMenu(el, itemEl); return; }
            const primEl = el.closest<HTMLElement>(".tree-node.linked-prim");
            if (primEl) { showPrimMenu(el, primEl); return; }
            const objectEl = el.closest<HTMLElement>(".tree-node.object");
            if (objectEl) { showObjectMenu(el, objectEl); return; }
        });
    });
}

function setFocus(header: HTMLElement): void {
    document.querySelectorAll<HTMLElement>(".node-header.focused").forEach((el) => el.classList.remove("focused"));
    header.classList.add("focused");
    header.scrollIntoView({ block: "nearest" });
    const toggle = header.dataset["toggle"];
    const itemEl = header.closest<HTMLElement>(".item");
    if (toggle) {
        state.focusedId = "t:" + toggle;
    } else if (itemEl?.dataset["item"]) {
        state.focusedId = "i:" + itemEl.dataset["item"];
    }
    saveState();
}

function restoreFocus(): void {
    if (!state.focusedId) { return; }
    if (state.focusedId.startsWith("t:")) {
        const id = state.focusedId.slice(2);
        const header = document.querySelector<HTMLElement>(`[data-toggle="${id}"]`);
        if (header) { header.classList.add("focused"); }
    } else if (state.focusedId.startsWith("i:")) {
        const id = state.focusedId.slice(2);
        const itemEl = document.querySelector<HTMLElement>(`[data-item="${id}"]`);
        itemEl?.querySelector<HTMLElement>(".node-header")?.classList.add("focused");
    }
}

// ============================================
// Context Menu
// ============================================

type MenuEntry =
    | { label: string; action: () => void; disabled?: boolean }
    | { label: string; submenu: MenuEntry[] }
    | { separator: true };

type MenuAnchor = HTMLElement | { x: number; y: number };

function showMenu(anchor: MenuAnchor, entries: MenuEntry[]): void {
    closeMenu();

    const menu = document.createElement("div");
    menu.className = "context-menu";

    for (const entry of entries) {
        if ("separator" in entry) {
            const sep = document.createElement("div");
            sep.className = "menu-separator";
            sep.addEventListener("mouseenter", () => closeSubmenu());
            menu.appendChild(sep);
        } else if ("submenu" in entry) {
            const btn = document.createElement("button");
            btn.className = "menu-item has-submenu";
            btn.textContent = entry.label + " \u25B6";
            btn.addEventListener("mouseenter", () => showSubmenu(btn, entry.submenu));
            menu.appendChild(btn);
        } else {
            const btn = document.createElement("button");
            btn.className = "menu-item" + (entry.disabled ? " disabled" : "");
            btn.textContent = entry.label;
            btn.addEventListener("mouseenter", () => closeSubmenu());
            if (!entry.disabled) {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    closeMenu();
                    entry.action();
                });
            }
            menu.appendChild(btn);
        }
    }

    document.body.appendChild(menu);
    activeMenu = menu;
    startMenuDeactivationWatchdog();

    // Position at anchor; flip then clamp to stay within all four viewport edges
    let top: number, left: number;
    if (anchor instanceof HTMLElement) {
        const rect = anchor.getBoundingClientRect();
        top = rect.bottom;
        left = rect.left;
    } else {
        top = anchor.y;
        left = anchor.x;
    }
    const mr = menu.getBoundingClientRect();
    if (left + mr.width > window.innerWidth) { left -= mr.width; }
    if (top + mr.height > window.innerHeight) { top -= mr.height; }
    menu.style.left = `${Math.max(0, Math.min(left, window.innerWidth - mr.width))}px`;
    menu.style.top = `${Math.max(0, Math.min(top, window.innerHeight - mr.height))}px`;
}

function closeMenu(): void {
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }
    closeSubmenu();
    stopMenuDeactivationWatchdog();
}

function closeSubmenu(): void {
    if (activeSubmenu) {
        activeSubmenu.remove();
        activeSubmenu = null;
    }
}

function showSubmenu(parentEl: HTMLElement, entries: MenuEntry[]): void {
    closeSubmenu();
    const sub = document.createElement("div");
    sub.className = "context-menu";
    for (const entry of entries) {
        if ("separator" in entry) {
            const sep = document.createElement("div");
            sep.className = "menu-separator";
            sub.appendChild(sep);
        } else if (!("submenu" in entry)) {
            const btn = document.createElement("button");
            btn.className = "menu-item" + (entry.disabled ? " disabled" : "");
            btn.textContent = entry.label;
            if (!entry.disabled) {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    closeMenu();
                    entry.action();
                });
            }
            sub.appendChild(btn);
        }
    }
    document.body.appendChild(sub);
    activeSubmenu = sub;
    const rect = parentEl.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    let subLeft = rect.right;
    let subTop = rect.top;
    if (subLeft + sr.width > window.innerWidth) { subLeft = rect.left - sr.width; }
    if (subTop + sr.height > window.innerHeight) { subTop = rect.bottom - sr.height; }
    sub.style.left = `${Math.max(0, Math.min(subLeft, window.innerWidth - sr.width))}px`;
    sub.style.top = `${Math.max(0, Math.min(subTop, window.innerHeight - sr.height))}px`;
}



function showItemMenu(anchor: MenuAnchor, itemEl: HTMLElement): void {
    const object_id = itemEl.dataset["object"]!;
    const prim_id = itemEl.dataset["prim"]!;
    const item_id = itemEl.dataset["item"]!;
    const type = itemEl.dataset["type"] as "script" | "notecard";
    const canModify = itemEl.dataset["canModify"] === "true";
    const uri = itemEl.dataset["uri"]!;
    const toggleBtn = itemEl.querySelector<HTMLElement>(".toggle-run");
    const running = toggleBtn?.dataset["running"] === "true";
    const subtype = parseInt(itemEl.dataset["subtype"] ?? "0", 10);
    const currentVm = itemEl.dataset["vm"] ?? "";

    const entries: MenuEntry[] = [
        {
            label: "Open",
            disabled: type === "script" && !canModify,
            action: () => vscode.postMessage({ command: "openItem", payload: { uri } }),
        },
    ];

    if (type === "script") {
        entries.push({ separator: true });
        entries.push({
            label: running ? "Stop" : "Start",
            action: () => vscode.postMessage({
                command: "toggleRunning",
                payload: { object_id, prim_id, item_id, running: !running },
            }),
        });
        entries.push({
            label: "Restart",
            action: () => vscode.postMessage({
                command: "restartScript",
                payload: { object_id, prim_id, item_id },
            }),
        });
        entries.push({ separator: true });
        const isLuauScript = subtype === 1;
        entries.push({
            label: "Select VM",
            submenu: (
                [
                    { vm: "lsl2", label: "LSL2" },
                    { vm: "mono", label: "Mono" },
                    { vm: "luau", label: "Luau" },
                ] as Array<{ vm: string; label: string }>
            ).map(({ vm, label }) => ({
                label: label + (currentVm === vm ? " \u2713" : ""),
                disabled: isLuauScript && vm !== "luau",
                action: () => vscode.postMessage({
                    command: "setScriptVM",
                    payload: { object_id, prim_id, item_id, vm },
                }),
            })),
        });
    }

    entries.push({ separator: true });
    entries.push({
        label: "Rename...",
        action: () => beginRenameItem(itemEl),
    });
    entries.push({
        label: "Delete",
        action: () => vscode.postMessage({ command: "deleteItem", payload: { object_id, prim_id, item_id } }),
    });

    showMenu(anchor, entries);
}

function beginCreateItem(object_id: string, prim_id: string): void {
    closeMenu();
    const isRoot = prim_id === object_id;
    const toggleId = isRoot ? object_id : prim_id;

    // Expand if needed
    if (!state.expanded.includes(toggleId)) {
        state.expanded.push(toggleId);
        saveState();
        renderTree();
    }

    // Find children container
    const containerSelector = isRoot
        ? `.tree-node.object[data-object-id="${object_id}"] > .children`
        : `.tree-node.linked-prim[data-object-id="${object_id}"][data-prim-id="${prim_id}"] > .children`;
    const childrenEl = document.querySelector<HTMLElement>(containerSelector);
    if (!childrenEl) { return; }

    // Remove any existing inline input
    document.querySelector(".inline-create-row")?.remove();

    // Build the row
    const row = document.createElement("div");
    row.className = "tree-node inline-create-row";
    row.innerHTML = `
        <div class="node-header item-row">
            <span class="file-icon file-icon-script-lsl"></span>
            <input class="inline-name-input" type="text" placeholder="filename.lsl" spellcheck="false" autocomplete="off" />
        </div>`;
    childrenEl.insertBefore(row, childrenEl.firstElementChild);

    const input = row.querySelector<HTMLInputElement>(".inline-name-input")!;
    const iconEl = row.querySelector<HTMLElement>(".file-icon")!;

    // Update icon as user types
    input.addEventListener("input", () => {
        const val = input.value.toLowerCase();
        iconEl.className = "file-icon " + (
            val.endsWith(".luau") ? "file-icon-script-luau" :
            val.endsWith(".lsl")  ? "file-icon-script-lsl" :
                                    "file-icon-script-lsl"
        );
    });

    let finished = false;
    const commit = () => {
        if (finished) { return; }
        finished = true;
        const filename = input.value.trim();
        row.remove();
        if (!filename) { return; }
        vscode.postMessage({ command: "createItem", payload: { object_id, prim_id, filename } });
    };

    const cancel = () => {
        if (finished) { return; }
        finished = true;
        row.remove();
    };

    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter")  { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });

    // Defer blur handler slightly to avoid cancelling on immediate focus loss.
    // On blur, commit if user entered a name (closer to file-tree rename/create behavior).
    setTimeout(() => {
        input.addEventListener("blur", () => {
            if (input.value.trim().length > 0) {
                commit();
            } else {
                cancel();
            }
        });
    }, 150);

    input.focus();
}

function beginRenameItem(itemEl: HTMLElement): void {
    closeMenu();
    const object_id = itemEl.dataset["object"]!;
    const prim_id   = itemEl.dataset["prim"]!;
    const item_id   = itemEl.dataset["item"]!;
    const header    = itemEl.querySelector<HTMLElement>(".node-header")!;
    const labelEl   = header.querySelector<HTMLElement>(".label")!;
    const currentName = itemEl.dataset["name"] ?? (labelEl.textContent ?? "");

    const input = document.createElement("input");
    input.className = "inline-name-input";
    input.type = "text";
    input.value = currentName;
    input.spellcheck = false;
    input.autocomplete = "off";

    const btns = header.querySelectorAll<HTMLElement>(".action-btn");
    btns.forEach((b) => { b.style.display = "none"; });

    labelEl.replaceWith(input);

    let finished = false;
    const restore = () => {
        input.replaceWith(labelEl);
        btns.forEach((b) => { b.style.display = ""; });
    };
    const commit = () => {
        if (finished) { return; }
        finished = true;
        const newName = input.value.trim();
        restore();
        if (!newName || newName === currentName) { return; }
        vscode.postMessage({ command: "renameItem", payload: { object_id, prim_id, item_id, newName } });
    };
    const cancel = () => {
        if (finished) { return; }
        finished = true;
        restore();
    };

    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter")  { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    setTimeout(() => {
        input.addEventListener("blur", () => {
            if (input.value.trim().length > 0) { commit(); } else { cancel(); }
        });
    }, 150);

    input.select();
    input.focus();
}

function beginRenameObject(nodeEl: HTMLElement): void {
    closeMenu();
    const object_id = nodeEl.dataset["objectId"]!;
    const prim_id   = nodeEl.dataset["primId"] ?? object_id;
    const header    = nodeEl.querySelector<HTMLElement>(":scope > .node-header")!;
    const labelEl   = header.querySelector<HTMLElement>(".label")!;
    const currentName = labelEl.textContent ?? "";

    const input = document.createElement("input");
    input.className = "inline-name-input";
    input.type = "text";
    input.value = currentName;
    input.spellcheck = false;
    input.autocomplete = "off";

    const btns = header.querySelectorAll<HTMLElement>(".action-btn");
    btns.forEach((b) => { b.style.display = "none"; });

    labelEl.replaceWith(input);

    let finished = false;
    const restore = () => {
        input.replaceWith(labelEl);
        btns.forEach((b) => { b.style.display = ""; });
    };
    const commit = () => {
        if (finished) { return; }
        finished = true;
        const newName = input.value.trim();
        restore();
        if (!newName || newName === currentName) { return; }
        vscode.postMessage({ command: "renameObject", payload: { object_id, prim_id, newName } });
    };
    const cancel = () => {
        if (finished) { return; }
        finished = true;
        restore();
    };

    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter")  { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    setTimeout(() => {
        input.addEventListener("blur", () => {
            if (input.value.trim().length > 0) { commit(); } else { cancel(); }
        });
    }, 150);

    input.select();
    input.focus();
}

function showObjectMenu(anchor: MenuAnchor, objectEl: HTMLElement): void {
    // Unavailable/disconnected pinned objects should not expose object actions.
    if (objectEl.classList.contains("disconnected")) {
        return;
    }

    const object_id = objectEl.dataset["objectId"]!;
    const objectEntry = state.objects.find((obj) => obj.object_id === object_id);
    const canSaveBack = objectEntry?.can_save_back === true;
    const saveBackCommandAvailable = viewerCommands.has("viewer.object.save_back_to_contents");
    const saveBackEnabled = saveBackCommandAvailable && canSaveBack;

    showMenu(anchor, [
        {
            label: "Rename...",
            action: () => beginRenameObject(objectEl),
        },
        {
            label: "New File...",
            action: () => beginCreateItem(object_id, object_id),
        },
        { separator: true },
        {
            label: "Unexplore",
            action: () => vscode.postMessage({ command: "unpublishObject", payload: { object_id } }),
        },
        { separator: true },
        {
            label: "Save Back to Contents",
            disabled: !saveBackEnabled,
            action: () => vscode.postMessage({ command: "saveBackToObjectContents", payload: { object_id } }),
        },
        { separator: true },
        {
            label: "Teleport To",
            disabled: !viewerCommands.has("viewer.teleport"),
            action: () => vscode.postMessage({ command: "teleportToObject", payload: { object_id } }),
        },
        {
            label: "Zoom In",
            disabled: !viewerCommands.has("viewer.camera.focus"),
            action: () => vscode.postMessage({ command: "zoomInOnObject", payload: { object_id } }),
        },
    ]);
}

function showPrimMenu(anchor: MenuAnchor, primEl: HTMLElement): void {
    const object_id = primEl.dataset["objectId"]!;
    const prim_id = primEl.dataset["primId"]!;

    showMenu(anchor, [
        {
            label: "Rename...",
            action: () => beginRenameObject(primEl),
        },
        {
            label: "New File...",
            action: () => beginCreateItem(object_id, prim_id),
        },
    ]);
}

function saveState(): void {
    vscode.setState(state);
}
