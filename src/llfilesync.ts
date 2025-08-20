/**
 * @file llfilesync.ts
 *
 * $LicenseInfo:firstyear=2025&license=viewerlgpl$
 * Second Life Viewer Extension Source Code
 * Copyright (C) 2025, Linden Research, Inc.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation;
 * version 2.1 of the License only.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Linden Research, Inc., 945 Battery Street, San Francisco, CA  94111  USA
 * $/LicenseInfo$
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { STATUS_BAR_TIMEOUT_SECONDS } from './configvals';

/**
 * Encapsulates all the objects and state for syncing a single script file
 */
class ScriptSync implements vscode.Disposable {
    private saveListener: vscode.Disposable | undefined;
    private deleteListener: vscode.Disposable | undefined;
    private watcher: vscode.FileSystemWatcher | undefined;
    private disposed = false;

    constructor(
        public readonly tempFilePath: string,
        public readonly masterFilePath: string,
        public readonly scriptName: string,
        public readonly extension: string,
        private readonly parentSync: LLFileSync
    ) {}

    /**
     * Sets up the file watchers and listeners for this script sync
     */
    public async setup(): Promise<void> {
        if (this.disposed) {
            throw new Error('Cannot setup disposed ScriptSync');
        }

        // Set up a listener to copy the master file to the temp file when it's saved
        this.saveListener = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
            if (savedDoc.fileName === this.masterFilePath) {
                await this.syncMasterToTemp();
            }
        });

        // Watch for deletion and recreation of the temp file
        const tempDir = path.dirname(this.tempFilePath);
        const tempName = path.basename(this.tempFilePath);
        this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(tempDir, tempName));

        // Stop syncing and close the window if the temp file is deleted
        this.deleteListener = this.watcher.onDidDelete((uri) => {
            if (uri.fsPath === this.tempFilePath) {
                this.handleTempFileDeleted();
            }
        });
    }

    /**
     * Syncs the master file content to the temp file
     */
    private async syncMasterToTemp(): Promise<void> {
        try {
            const data = await fs.promises.readFile(this.masterFilePath, 'utf8');
            await fs.promises.writeFile(this.tempFilePath, data);
            vscode.window.setStatusBarMessage(`Synced ${this.scriptName} to Second Life`, STATUS_BAR_TIMEOUT_SECONDS * 1000);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error syncing file: ${err.message}`);
        }
    }

    /**
     * Handles cleanup when the temporary file is deleted
     */
    private handleTempFileDeleted(): void {
        vscode.window.setStatusBarMessage(`Temporary file deleted. Sync stopped for ${this.scriptName}`, STATUS_BAR_TIMEOUT_SECONDS * 1000);
        this.dispose();
        this.parentSync.removeSync(this.tempFilePath);
    }

    /**
     * Disposes of all resources associated with this script sync
     */
    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.saveListener?.dispose();
        this.deleteListener?.dispose();
        this.watcher?.dispose();

        this.saveListener = undefined;
        this.deleteListener = undefined;
        this.watcher = undefined;
        this.disposed = true;
    }
}

export class LLFileSync {
    // Tracks all active sync relationships between temp files and master files
    private activeSyncs = new Map<string, ScriptSync>();
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Activates the file sync functionality
     */
    public activate(): void {
        // Run sync setup when a document is opened
        const onDidOpenListener = vscode.workspace.onDidOpenTextDocument((document) =>
        {
            console.debug(`Document opened: ${document.fileName}`);
            this.setupSync(document.fileName);
        });

        this.context.subscriptions.push(onDidOpenListener);
    }

    /**
     * Removes a script sync from the active syncs map
     * @param tempFilePath - The temp file path to remove
     */
    public removeSync(tempFilePath: string): void {
        console.debug(`Removing sync for temp file: ${tempFilePath}`);
        this.activeSyncs.delete(tempFilePath);
    }

    /**
     * Sets up syncing from a master script to a SL temp script file
     * @param tempFilePath - Full path to the SL temporary script file
     */
    private async setupSync(tempFilePath: string): Promise<void> {
        const openedBase = path.basename(tempFilePath);

        // Match file names like: sl_script_<scriptName>_<uuid>.luau or .lsl
        const match = openedBase.match(/^sl_script_(.+)_([a-fA-F0-9]{32}|[a-fA-F0-9-]{36})\.(luau|lsl)$/);
        if (!match)
        {
            return; // Not a valid SL temp script file
        }

        const scriptName = match[1]; // extracted script name
        const extension = match[3];  // either "lsl" or "luau"

        // Remove any previous syncs for this temp file to avoid duplicates
        if (this.activeSyncs.has(tempFilePath)) {
            this.activeSyncs.get(tempFilePath)?.dispose();
            this.activeSyncs.delete(tempFilePath);
        }

        // Look for a file in the workspace with the same name as the master script
        const files = await vscode.workspace.findFiles(`**/${scriptName}.${extension}`);
        if (files.length === 0) {
            vscode.window.showWarningMessage(`No master script found for: ${scriptName}.${extension}`);
            return;
        }

        const masterUri = files[0];
        const masterPath = masterUri.fsPath;

        // Open the master script file in the editor
        vscode.window.showInformationMessage(`Opening master copy: ${path.basename(masterPath)}`);
        const masterDoc = await vscode.workspace.openTextDocument(masterUri);
        await vscode.window.showTextDocument(masterDoc, { preview: false });

        // Create and setup the script sync
        const scriptSync = new ScriptSync(tempFilePath, masterPath, scriptName, extension, this);
        await scriptSync.setup();

        this.activeSyncs.set(tempFilePath, scriptSync);
        this.context.subscriptions.push(scriptSync);
    }

    /**
     * Deactivates the file sync functionality
     */
    public deactivate(): void {
        // Dispose of all active syncs
        for (const [, scriptSync] of this.activeSyncs) {
            scriptSync.dispose();
        }
        this.activeSyncs.clear();
    }
}
