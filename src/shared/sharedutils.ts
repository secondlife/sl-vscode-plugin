/**
 * @file sharedutils.ts
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
 * ==============================================================================
 *
 * Shared utilities, not specific to vscode APIs
 *
 */

import * as fs from "fs";
import * as yaml from "js-yaml";
import * as TOML from "@iarna/toml";
import { NormalizedPath, fileExists } from "../interfaces/hostinterface"; // migrated path abstractions

//=============================================================================
//#region General Utilities
// Utility to conditionally include properties in objects
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function maybe<K extends string, V>(
    key: K,
    value: V | undefined | null,
) {
    return value == null ? ({} as {}) : ({ [key]: value } as Record<K, V>);
}

//#endregion


//=============================================================================
//#region JSON Utilities

export function toJSON(obj: any): string | null {
    try {
        return JSON.stringify(obj, null, 2);
    } catch (error) {
        console.error("Error converting to JSON:", error);
        return null;
    }
}

export function fromJSON(jsonString: string): any | null {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        console.error("Error converting from JSON:", error);
        return null;
    }
}

export async function writeJSONFile(
    obj: any,
    filePath: NormalizedPath
): Promise<boolean> {
    try {
        const jsonContent = toJSON(obj);
        if (jsonContent === null) {
            return false;
        }

        const encoder = new TextEncoder();
        await fs.promises.writeFile(filePath, encoder.encode(jsonContent));
        return true;
    } catch (error) {
        console.error("Error saving JSON file:", error);
        return false;
    }
}

export async function readJSONFile(filePath: NormalizedPath): Promise<any | null> {

    if (!(await fileExists(filePath))) {
        // File doesn't exist or can't be accessed
        return null;
    }

    try {
        const content = await fs.promises.readFile(filePath);
        return fromJSON(content.toString());
    } catch (error) {
        console.error("Error loading JSON file:", error);
        return null;
    }
}

//#endregion

//#region YAML Utilities

export function toYAML(obj: any, options?: yaml.DumpOptions): string | null {
    try {
        return yaml.dump(obj, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            ...options,
        });
    } catch (error) {
        console.error("Error converting to YAML:", error);
        return null;
    }
}

export function fromYAML(yamlString: string): any | null {
    try {
        return yaml.load(yamlString);
    } catch (error) {
        console.error("Error converting from YAML:", error);
        return null;
    }
}

export async function writeYAMLFile(
    obj: any,
    filePath: NormalizedPath,
    options?: yaml.DumpOptions,
): Promise<boolean> {
    try {
        const yamlContent = toYAML(obj, options);
        if (yamlContent === null) {
            return false;
        }

        const encoder = new TextEncoder();
        await fs.promises.writeFile(filePath, encoder.encode(yamlContent));
        return true;
    } catch (error) {
        console.error("Error saving YAML file:", error);
        return false;
    }
}

export async function readYAMLFile(filePath: NormalizedPath): Promise<any | null> {
    if (!(await fileExists(filePath))) {
        // File doesn't exist or can't be accessed
        return null;
    }

    try {
        const content = await fs.promises.readFile(filePath);
        return fromYAML(content.toString());
    } catch (error) {
        console.error("Error loading YAML file:", error);
        return null;
    }
}

//#endregion

//#region TOML Utilities

export function toTOML(obj: any): string | null {
    try {
        return TOML.stringify(obj);
    } catch (error) {
        console.error("Error converting to TOML:", error);
        return null;
    }
}

export function fromTOML(tomlString: string): any | null {
    try {
        return TOML.parse(tomlString);
    } catch (error) {
        console.error("Error converting from TOML:", error);
        return null;
    }
}

export async function writeTOMLFile(
    obj: any,
    filePath: NormalizedPath,
): Promise<boolean> {
    try {
        const tomlContent = toTOML(obj);
        if (tomlContent === null) {
            return false;
        }

        await fs.promises.writeFile(filePath, tomlContent);
        return true;
    } catch (error) {
        console.error("Error saving TOML file:", error);
        return false;
    }
}

export async function readTOMLFile(filePath: NormalizedPath): Promise<any | null> {
    if (!(await fileExists(filePath))) {
        // File doesn't exist or can't be accessed
        return null;
    }

    try {
        const content = await fs.promises.readFile(filePath);
        return fromTOML(content.toString());
    } catch (error) {
        console.error("Error loading TOML file:", error);
        return null;
    }
}

//#endregion
