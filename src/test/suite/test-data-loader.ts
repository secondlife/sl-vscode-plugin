import * as fs from 'fs';
import * as path from 'path';

/**
 * Utility functions for loading test data in unit tests
 */
export class TestDataLoader {
    private static readonly TEST_DATA_DIR = path.join(__dirname, 'data');

    /**
     * Load the minimal sl-lua-defs.json test data
     * @returns Parsed JSON object with type definitions
     */
    public static loadMinimalLuaTypes(): any {
        const filePath = path.join(this.TEST_DATA_DIR, 'sl-lua-defs.json');
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    }

    /**
     * Get the path to the test data directory
     * @returns Absolute path to test data directory
     */
    public static getTestDataPath(): string {
        return this.TEST_DATA_DIR;
    }

    /**
     * Load any JSON file from the test data directory
     * @param filename Name of the JSON file (with or without .json extension)
     * @returns Parsed JSON object
     */
    public static loadTestJson(filename: string): any {
        if (!filename.endsWith('.json')) {
            filename += '.json';
        }
        const filePath = path.join(this.TEST_DATA_DIR, filename);
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    }

    /**
     * Check if a test data file exists
     * @param filename Name of the file to check
     * @returns True if file exists
     */
    public static hasTestFile(filename: string): boolean {
        const filePath = path.join(this.TEST_DATA_DIR, filename);
        return fs.existsSync(filePath);
    }
}

/**
 * Type definitions for the minimal test data structure
 */
export interface TestLuaTypeDefinition {
    $schema: string;
    aliases: { [key: string]: any };
    functions: { [key: string]: any };
    classes: { [key: string]: any };
    modules: { [key: string]: any };
}

/**
 * Helper to get typed test data
 */
export function getTestLuaTypes(): TestLuaTypeDefinition {
    return TestDataLoader.loadMinimalLuaTypes();
}
