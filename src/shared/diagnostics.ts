/**
 * @file diagnostics.ts
 * Diagnostic types and collection for preprocessor error reporting
 * Copyright (C) 2025, Linden Research, Inc.
 */

import { NormalizedPath } from "../interfaces/hostinterface";

//#region Diagnostic Types

/**
 * Diagnostic severity levels
 */
export enum DiagnosticSeverity {
    ERROR = 0,    // Prevents successful preprocessing
    WARNING = 1,  // Suspicious but processable
    INFO = 2,     // Informational messages
    HINT = 3      // Suggestions for improvement
}

/**
 * Related information for a diagnostic (e.g., where a macro was defined)
 */
export interface DiagnosticRelatedInfo {
    message: string;
    line: number;
    column: number;
    length: number;
    sourceFile: NormalizedPath;
}

/**
 * A preprocessor diagnostic (error, warning, info, or hint)
 */
export interface PreprocessorDiagnostic {
    severity: DiagnosticSeverity;
    message: string;
    line: number;
    column: number;
    length: number;
    sourceFile: NormalizedPath;
    code?: string;  // Optional error code (e.g., "PP001")
    relatedInfo?: DiagnosticRelatedInfo[];
}

/**
 * Location information for creating diagnostics
 */
export interface DiagnosticLocation {
    line: number;
    column: number;
    length: number;
    sourceFile: NormalizedPath;
}

//#endregion

//#region Diagnostic Collector

/**
 * Collects diagnostics during preprocessing
 */
export class DiagnosticCollector {
    private diagnostics: PreprocessorDiagnostic[] = [];

    /**
     * Add a diagnostic directly
     */
    add(diagnostic: PreprocessorDiagnostic): void {
        this.diagnostics.push(diagnostic);
    }

    /**
     * Add an error diagnostic
     */
    addError(message: string, location: DiagnosticLocation, code?: string, relatedInfo?: DiagnosticRelatedInfo[]): void {
        this.diagnostics.push({
            severity: DiagnosticSeverity.ERROR,
            message,
            line: location.line,
            column: location.column,
            length: location.length,
            sourceFile: location.sourceFile,
            code,
            relatedInfo,
        });
    }

    /**
     * Add a warning diagnostic
     */
    addWarning(message: string, location: DiagnosticLocation, code?: string, relatedInfo?: DiagnosticRelatedInfo[]): void {
        this.diagnostics.push({
            severity: DiagnosticSeverity.WARNING,
            message,
            line: location.line,
            column: location.column,
            length: location.length,
            sourceFile: location.sourceFile,
            code,
            relatedInfo,
        });
    }

    /**
     * Add an info diagnostic
     */
    addInfo(message: string, location: DiagnosticLocation, code?: string, relatedInfo?: DiagnosticRelatedInfo[]): void {
        this.diagnostics.push({
            severity: DiagnosticSeverity.INFO,
            message,
            line: location.line,
            column: location.column,
            length: location.length,
            sourceFile: location.sourceFile,
            code,
            relatedInfo,
        });
    }

    /**
     * Add a hint diagnostic
     */
    addHint(message: string, location: DiagnosticLocation, code?: string, relatedInfo?: DiagnosticRelatedInfo[]): void {
        this.diagnostics.push({
            severity: DiagnosticSeverity.HINT,
            message,
            line: location.line,
            column: location.column,
            length: location.length,
            sourceFile: location.sourceFile,
            code,
            relatedInfo,
        });
    }

    /**
     * Check if any errors have been collected
     */
    hasErrors(): boolean {
        return this.diagnostics.some(d => d.severity === DiagnosticSeverity.ERROR);
    }

    /**
     * Get all error diagnostics
     */
    getErrors(): PreprocessorDiagnostic[] {
        return this.diagnostics.filter(d => d.severity === DiagnosticSeverity.ERROR);
    }

    /**
     * Get all warning diagnostics
     */
    getWarnings(): PreprocessorDiagnostic[] {
        return this.diagnostics.filter(d => d.severity === DiagnosticSeverity.WARNING);
    }

    /**
     * Get all diagnostics
     */
    getAll(): PreprocessorDiagnostic[] {
        return [...this.diagnostics];
    }

    /**
     * Get count of diagnostics by severity
     */
    getCount(severity?: DiagnosticSeverity): number {
        if (severity === undefined) {
            return this.diagnostics.length;
        }
        return this.diagnostics.filter(d => d.severity === severity).length;
    }

    /**
     * Clear all diagnostics
     */
    clear(): void {
        this.diagnostics = [];
    }

    /**
     * Merge diagnostics from another collector
     */
    merge(other: DiagnosticCollector): void {
        this.diagnostics.push(...other.diagnostics);
    }
}

//#endregion

//#region Error Codes

/**
 * Standard error codes for preprocessor diagnostics
 */
export const ErrorCodes = {
    // Lexer errors (LEX prefix)
    UNTERMINATED_BLOCK_COMMENT: "LEX001",
    UNTERMINATED_STRING: "LEX002",
    INVALID_ESCAPE_SEQUENCE: "LEX003",
    INVALID_NUMBER_LITERAL: "LEX004",
    INVALID_CHARACTER: "LEX005",
    UNTERMINATED_VECTOR_LITERAL: "LEX006",

    // Parser errors (PAR prefix)
    MALFORMED_DIRECTIVE: "PAR001",
    MISSING_DIRECTIVE_ARGUMENT: "PAR002",
    INVALID_MACRO_DEFINITION: "PAR003",
    UNTERMINATED_CONDITIONAL: "PAR004",
    MISMATCHED_CONDITIONAL: "PAR005",
    INVALID_MACRO_INVOCATION: "PAR006",

    // Include errors (INC prefix)
    FILE_NOT_FOUND: "INC001",
    CIRCULAR_INCLUDE: "INC002",
    INCLUDE_DEPTH_EXCEEDED: "INC003",
    PATH_RESOLUTION_FAILED: "INC004",
    FILE_READ_ERROR: "INC005",

    // Macro errors (MAC prefix)
    UNDEFINED_MACRO: "MAC001",
    ARGUMENT_COUNT_MISMATCH: "MAC002",
    RECURSIVE_EXPANSION: "MAC003",
    INVALID_DEFINED_SYNTAX: "MAC004",

    // Conditional errors (COND prefix)
    INVALID_EXPRESSION: "COND001",
    TYPE_ERROR: "COND002",
    DIVISION_BY_ZERO: "COND003",
} as const;

//#endregion
