/**
 * @file linemapper.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */

import { HostInterface, NormalizedPath } from "../interfaces/hostinterface";
import { ScriptLanguage } from "./languageservice";

//-------------------------------------------------------------
export interface LineMapping {
    processedLine: number;
    sourceFile: NormalizedPath;
    originalLine: number;
}

//-------------------------------------------------------------

export class LineMapper {

    public static parseLineMappingsFromContent(content: string, language: ScriptLanguage = "lsl", host: HostInterface): LineMapping[] {
        const lines = content.split('\n');
        const lineMappings: LineMapping[] = [];
        const commentPrefix = language === "lsl" ? "// @line" : "-- @line";

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Check if line starts with a line directive comment
            if (line.startsWith(commentPrefix)) {
                // Extract the content after the directive prefix
                const directiveContent = line.substring(commentPrefix.length).trim();

                console.log(`Have @line directive: ${directiveContent}`)
                // Parse line number and file path
                // Expected format: "123 \"uri-or-path\""
                const parts = directiveContent.split(' ');
                const lineNumber = parseInt(parts[0]);

                if (isNaN(lineNumber)) {
                    continue; // Skip invalid line numbers
                }

                // Extract file path/URI from quotes
                const quotedMatch = directiveContent.match(/"([^"]*)"/);
                if (!quotedMatch) {
                    continue; // Skip if no quoted file path found
                }

                const sourceFileString = quotedMatch[1];
                console.log(`quoted is: ${sourceFileString} `);
                const processedLine = i + 1; // Line numbers are 1-based

                // Convert URI to filename using host interface
                const sourceFileAbsolute: NormalizedPath = host.uriToFileName(sourceFileString);
                console.log(`absolute is ${sourceFileAbsolute}`);
                lineMappings.push({
                    processedLine: processedLine,
                    sourceFile: sourceFileAbsolute,
                    originalLine: lineNumber
                });
            }
        }

        return lineMappings;
    }

    /**
     * Converts an absolute line number in preprocessed output to its original source location
     * Line mappings are context change markers that indicate when processing switches to a
     * different file or line context. The function calculates the offset from the mapping
     * to determine the correct line within that file context.
     * @param lineMappings - Array of line mappings from preprocessing
     * @param absoluteLine - Line number in the preprocessed output (1-based)
     * @returns Object with source file URI and original line number, or null if not found
     */
    public static convertAbsoluteLineToSource(lineMappings: LineMapping[], absoluteLine: number): {
        source: NormalizedPath;
        line: number
    } | null {

        if (lineMappings.length === 0) {
            return null;
        }

        // Find the last mapping that is <= the target line
        let applicableMapping: LineMapping | null = null;

        for (const mapping of lineMappings) {
            if (mapping.processedLine <= absoluteLine) {
                applicableMapping = mapping;
            } else {
                break; // Mappings should be sorted by processedLine
            }
        }

        if (!applicableMapping) {
            return null;
        }

        // Calculate the offset from the mapping's processed line to the target line
        // and add it to the mapping's original line to get the correct line in the source
        const lineOffset = absoluteLine - applicableMapping.processedLine;
        const originalLine = applicableMapping.originalLine + lineOffset;

        return {
            source: applicableMapping.sourceFile,
            line: originalLine
        };
    }

    /**
     * Finds all line mappings that reference a specific source file
     * @param lineMappings - Array of line mappings to search
     * @param sourceFile - The source file to find mappings for (normalized path)
     * @returns Array of line mappings that reference the specified source file
     */
    public static findMappingsForSourceFile(lineMappings: LineMapping[], sourceFile: NormalizedPath): LineMapping[] {
        return lineMappings.filter(mapping => mapping.sourceFile === sourceFile);
    }

    /**
     * Finds all processed line numbers that correspond to a specific line in a source file
     * This is useful when a single source line generates multiple output lines (e.g., macro expansion)
     * @param lineMappings - Array of line mappings to search
     * @param sourceFile - The source file to search for (normalized path)
     * @param originalLine - The line number in the original source file
     * @returns Array of processed line numbers that map to the specified source location
     */
    public static findProcessedLines(lineMappings: LineMapping[], sourceFile: NormalizedPath, originalLine: number): number[] {
        return lineMappings
            .filter(mapping => mapping.sourceFile === sourceFile && mapping.originalLine === originalLine)
            .map(mapping => mapping.processedLine);
    }

}
