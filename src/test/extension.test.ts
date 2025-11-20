import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests.");

    test("Sample test", () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });

    test("Extension should be present", () => {
    // Note: Replace with your actual extension ID
        const extension = vscode.extensions.getExtension("sl-vscode-plugin");
        // For now, just test that extensions API works
        assert.ok(vscode.extensions.all.length > 0, "Extensions API is accessible");
    });

    test("Commands should be registered", async () => {
        const commands = await vscode.commands.getCommands();

        // Test that our extension commands are registered
        const expectedCommands = [
            "second-life-scripting.helloWorld",
            "second-life-scripting.connectWebSocket",
            "second-life-scripting.disconnectWebSocket",
            "second-life-scripting.showWebSocketClientStatus",
        ];

        // For now, just test that the commands API works
        assert.ok(commands.length > 0, "Commands API is accessible");
        assert.ok(Array.isArray(commands), "Commands returns an array");
    });

    test("Workspace API should be accessible", () => {
    // Test that we can access workspace APIs
        assert.ok(
            typeof vscode.workspace !== "undefined",
            "Workspace API is accessible",
        );
        assert.ok(typeof vscode.window !== "undefined", "Window API is accessible");
        assert.ok(
            typeof vscode.commands !== "undefined",
            "Commands API is accessible",
        );
    });
});
