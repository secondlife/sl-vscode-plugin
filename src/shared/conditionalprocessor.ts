/**
 * @file conditionalprocessor.ts
 * Conditional compilation processor for lexing-based preprocessor
 * Copyright (C) 2025, Linden Research, Inc.
 *
 * Handles #if, #ifdef, #ifndef, #elif, #else, #endif directives
 * with proper nesting and state tracking.
 */

import { Token, TokenType, getLanguageConfig, type LanguageLexerConfig } from './lexer';
import { ScriptLanguage } from './languageservice';
import type { MacroProcessor } from './macroprocessor';
import { PreprocessorDiagnostic, DiagnosticLocation, ErrorCodes } from './diagnostics';
import { NormalizedPath } from '../interfaces/hostinterface';

//#region Conditional State

/**
 * State for a single conditional block (#if/#ifdef/#ifndef)
 */
interface ConditionalBlock {
    /** Whether the parent context is including code */
    parentActive: boolean;
    /** Result of the condition evaluation for current branch */
    branchActive: boolean;
    /** Whether we're in an else branch */
    inElse: boolean;
    /** Whether we're in an elif branch */
    inElif: boolean;
    /** Whether any branch in this if/elif/else chain was satisfied */
    anyBranchTaken: boolean;
    /** Line number where this block started (for error reporting) */
    startLine: number;
    /** Directive type that started this block (#if, #ifdef, #ifndef) */
    directive: string;
}

/**
 * Result of processing a conditional directive
 */
export interface ConditionalResult {
    /** Whether the directive was processed successfully */
    success: boolean;
    /** Whether code should be included after this directive */
    shouldInclude: boolean;
    /** Error or warning message if applicable */
    message?: string;
    /** Diagnostic information if an error/warning occurred */
    diagnostic?: PreprocessorDiagnostic;
}

//#endregion

//#region Conditional Processor

/**
 * Processor for conditional compilation directives
 * Maintains a stack of nested conditional blocks and tracks active state
 */
export class ConditionalProcessor {
    private stack: ConditionalBlock[] = [];
    private language: ScriptLanguage;
    private config: LanguageLexerConfig;

    constructor(language: ScriptLanguage) {
        this.language = language;
        this.config = getLanguageConfig(language);
    }

    //#region Public API

    /**
     * Get whether code should be included at the current position
     * Code is included only if all nested conditional blocks are active
     */
    public isActive(): boolean {
        if (this.stack.length === 0) {
            return true; // No conditionals active, include everything
        }

        // Check all levels - if any is inactive, we don't include
        for (const block of this.stack) {
            if (!block.parentActive || !block.branchActive) {
                return false;
            }
        }

        return true;
    }

    /**
     * Get the current nesting depth
     */
    public getDepth(): number {
        return this.stack.length;
    }

    /**
     * Check if there are unclosed conditional blocks
     */
    public hasUnclosedBlocks(): boolean {
        return this.stack.length > 0;
    }

    /**
     * Get information about unclosed blocks for error reporting
     */
    public getUnclosedBlocks(): Array<{directive: string, line: number}> {
        return this.stack.map(block => ({
            directive: block.directive,
            line: block.startLine,
        }));
    }

    /**
     * Reset the processor state (useful for processing new files)
     */
    public reset(): void {
        this.stack = [];
    }

    //#endregion

    //#region Directive Handlers

    /**
     * Process #ifdef directive
     * @param macroName - The macro name to check
     * @param macros - Macro processor for looking up definitions
     * @param line - Line number for error reporting
     * @param sourceFile - Source file for diagnostics (unused, for consistency)
     * @param column - Column number for diagnostics (unused, for consistency)
     */
    public processIfdef(
        macroName: string,
        macros: MacroProcessor,
        line: number,
        _sourceFile?: NormalizedPath,
        _column: number = 1
    ): ConditionalResult {
        const condition = macros.isDefined(macroName);
        return this.enterConditionalBlock(condition, line, '#ifdef');
    }

    /**
     * Process #ifndef directive
     * @param macroName - The macro name to check
     * @param macros - Macro processor for looking up definitions
     * @param line - Line number for error reporting
     * @param sourceFile - Source file for diagnostics
     * @param column - Column number for diagnostics
     */
    public processIfndef(
        macroName: string,
        macros: MacroProcessor,
        line: number,
        _sourceFile?: NormalizedPath,
        _column: number = 1
    ): ConditionalResult {
        const condition = !macros.isDefined(macroName);
        return this.enterConditionalBlock(condition, line, '#ifndef');
    }

    /**
     * Process #if directive
     * @param tokens - Tokens representing the condition expression
     * @param macros - Macro processor for macro expansion
     * @param line - Line number for error reporting
     * @param sourceFile - Source file for diagnostics (unused, for consistency)
     * @param column - Column number for diagnostics (unused, for consistency)
     */
    public processIf(
        tokens: Token[],
        macros: MacroProcessor,
        line: number,
        _sourceFile?: NormalizedPath,
        _column: number = 1
    ): ConditionalResult {
        const condition = this.evaluateCondition(tokens, macros);
        return this.enterConditionalBlock(condition, line, '#if');
    }

    /**
     * Process #elif directive
     * @param tokens - Tokens representing the condition expression
     * @param macros - Macro processor for macro expansion
     * @param line - Line number for error reporting
     * @param sourceFile - Source file for diagnostics
     * @param column - Column number for diagnostics
     */
    public processElif(
        tokens: Token[],
        macros: MacroProcessor,
        line: number,
        sourceFile?: NormalizedPath,
        column: number = 1
    ): ConditionalResult {
        if (this.stack.length === 0) {
            const diagnostic = sourceFile ? this.createDiagnostic(
                '#elif without matching #if',
                { line, column, length: 5, sourceFile },
                ErrorCodes.MISMATCHED_CONDITIONAL
            ) : undefined;

            return {
                success: false,
                shouldInclude: false,
                message: '#elif without matching #if',
                diagnostic,
            };
        }

        const currentBlock = this.stack[this.stack.length - 1];

        if (currentBlock.inElse) {
            const diagnostic = sourceFile ? this.createDiagnostic(
                '#elif after #else',
                { line, column, length: 5, sourceFile },
                ErrorCodes.MISMATCHED_CONDITIONAL
            ) : undefined;

            return {
                success: false,
                shouldInclude: false,
                message: '#elif after #else',
                diagnostic,
            };
        }

        // Mark that we're in an elif branch
        currentBlock.inElif = true;

        // Evaluate the condition
        const condition = this.evaluateCondition(tokens, macros);

        // Activate this branch only if:
        // 1. Parent is active
        // 2. No previous branch was taken
        // 3. This condition is true
        const shouldActivate = currentBlock.parentActive &&
                               !currentBlock.anyBranchTaken &&
                               condition;

        currentBlock.branchActive = shouldActivate;

        if (shouldActivate) {
            currentBlock.anyBranchTaken = true;
        }

        return {
            success: true,
            shouldInclude: this.isActive(),
        };
    }

    /**
     * Process #else directive
     * @param line - Line number for error reporting
     * @param sourceFile - Source file for diagnostics
     * @param column - Column number for diagnostics
     */
    public processElse(
        line: number,
        sourceFile?: NormalizedPath,
        column: number = 1
    ): ConditionalResult {
        if (this.stack.length === 0) {
            const diagnostic = sourceFile ? this.createDiagnostic(
                '#else without matching #if',
                { line, column, length: 5, sourceFile },
                ErrorCodes.MISMATCHED_CONDITIONAL
            ) : undefined;

            return {
                success: false,
                shouldInclude: false,
                message: '#else without matching #if',
                diagnostic,
            };
        }

        const currentBlock = this.stack[this.stack.length - 1];

        if (currentBlock.inElse) {
            console.log('Multiple #else directives for same #if');
            const diagnostic = sourceFile ? this.createDiagnostic(
                'Multiple #else directives for same #if',
                { line, column, length: 5, sourceFile },
                ErrorCodes.MISMATCHED_CONDITIONAL
            ) : undefined;

            return {
                success: false,
                shouldInclude: false,
                message: 'Multiple #else directives for same #if',
                diagnostic,
            };
        }

        // Mark that we're in an else branch
        currentBlock.inElse = true;

        // Activate else only if parent is active and no previous branch was taken
        currentBlock.branchActive = currentBlock.parentActive && !currentBlock.anyBranchTaken;

        return {
            success: true,
            shouldInclude: this.isActive(),
        };
    }

    /**
     * Process #endif directive
     * @param line - Line number for error reporting
     * @param sourceFile - Source file for diagnostics
     * @param column - Column number for diagnostics
     */
    public processEndif(
        line: number,
        sourceFile?: NormalizedPath,
        column: number = 1
    ): ConditionalResult {
        if (this.stack.length === 0) {
            const diagnostic = sourceFile ? this.createDiagnostic(
                '#endif without matching #if',
                { line, column, length: 6, sourceFile },
                ErrorCodes.MISMATCHED_CONDITIONAL
            ) : undefined;

            return {
                success: false,
                shouldInclude: false,
                message: '#endif without matching #if',
                diagnostic,
            };
        }

        this.stack.pop();

        return {
            success: true,
            shouldInclude: this.isActive(),
        };
    }

    //#endregion

    //#region Private Helpers

    /**
     * Enter a new conditional block
     */
    private enterConditionalBlock(
        condition: boolean,
        line: number,
        directive: string,
    ): ConditionalResult {
        const parentActive = this.isActive();
        const branchActive = parentActive && condition;

        const block: ConditionalBlock = {
            parentActive,
            branchActive,
            inElse: false,
            inElif: false,
            anyBranchTaken: branchActive,
            startLine: line,
            directive,
        };

        this.stack.push(block);

        return {
            success: true,
            shouldInclude: this.isActive(),
        };
    }

    /**
     * Evaluate a condition expression from tokens
     * @param tokens - The condition tokens
     * @param macros - Macro processor for expansion
     * @returns True if condition is satisfied
     */
    private evaluateCondition(tokens: Token[], macros: MacroProcessor): boolean {
        // If no tokens, condition is false
        if (tokens.length === 0) {
            return false;
        }

        // First, process defined() operators by delegating to MacroProcessor
        let processedTokens = macros.processDefined(tokens);

        // Then expand macros in the result (empty macros become 1)
        processedTokens = this.expandMacrosInTokens(processedTokens, macros);

        // Filter out whitespace for easier processing
        processedTokens = processedTokens.filter(t =>
            t.type !== TokenType.WHITESPACE && t.type !== TokenType.NEWLINE
        );

        // Handle simple cases: single token
        if (processedTokens.length === 1) {
            const token = processedTokens[0];

            // Numeric literal
            if (token.type === TokenType.NUMBER_LITERAL) {
                return parseFloat(token.value) !== 0;
            }

            // Identifier - check if it's a boolean literal or undefined macro
            if (token.type === TokenType.IDENTIFIER) {
                // Check for boolean literals
                const value = token.value.toLowerCase();
                if (value === 'true') return true;
                if (value === 'false') return false;

                // Undefined identifier is false
                return false;
            }
        }

        // Complex expression evaluation
        return this.evaluateComplexCondition(processedTokens, macros);
    }

    /**
     * Evaluate a complex condition expression with full operator support
     * Handles:
     * - Arithmetic operators (+, -, *, /, %)
     * - Comparison operators (==, !=, <, >, <=, >=)
     * - Logical operators (&&, ||, ! or and, or, not depending on language)
     * - Parentheses
     * Note: Macro expansion should be done before calling this
     */
    private evaluateComplexCondition(tokens: Token[], _macros: MacroProcessor): boolean {
        if (tokens.length === 0) {
            return false;
        }

        // Parse and evaluate the expression
        try {
            const result = this.evaluateExpression(tokens, 0);
            return result.value !== 0;
        } catch (error) {
            console.warn(`Error evaluating condition:`, error);
            return false;
        }
    }

    /**
     * Expand simple macros in token stream
     * Note: Empty macros (defined but no value) expand to 1 (true)
     * to match the old preprocessor's "defined but empty is true" behavior
     */
    private expandMacrosInTokens(tokens: Token[], macros: MacroProcessor): Token[] {
        const result: Token[] = [];

        for (const token of tokens) {
            if (token.type === TokenType.IDENTIFIER) {
                if (macros.isDefined(token.value)) {
                    const macro = macros.getMacro(token.value);
                    if (macro && !macro.isFunctionLike) {
                        // Simple macro
                        if (macro.body.length > 0) {
                            // Has body - expand to body tokens
                            result.push(...macro.body);
                        } else {
                            // Empty body - treat as 1 (true) per old preprocessor behavior
                            result.push(new Token(TokenType.NUMBER_LITERAL, "1", token.line, token.column, 1));
                        }
                    } else {
                        // Function-like macro - keep as-is (can't expand without arguments)
                        result.push(token);
                    }
                } else {
                    // Undefined identifier - keep as-is (will be 0 in evaluatePrimary)
                    result.push(token);
                }
            } else {
                // Non-identifier token - keep as-is
                result.push(token);
            }
        }

        return result;
    }

    /**
     * Evaluate an expression with operator precedence
     * Returns the numeric result and the next token position
     */
    private evaluateExpression(tokens: Token[], pos: number): { value: number; pos: number } {
        return this.evaluateLogicalOr(tokens, pos);
    }

    /**
     * Evaluate logical OR (lowest precedence)
     * LSL: ||, Luau: or
     */
    private evaluateLogicalOr(tokens: Token[], pos: number): { value: number; pos: number } {
        let result = this.evaluateLogicalAnd(tokens, pos);

        const orOp = this.config.logicalOperators.or;

        while (result.pos < tokens.length) {
            const token = tokens[result.pos];
            // Check both OPERATOR type and IDENTIFIER type (for Luau keywords)
            const isOrOp = (token.type === TokenType.OPERATOR && token.value === orOp) ||
                          (token.type === TokenType.IDENTIFIER && token.value === orOp);

            if (isOrOp) {
                result.pos++;
                const right = this.evaluateLogicalAnd(tokens, result.pos);
                result.value = (result.value !== 0 || right.value !== 0) ? 1 : 0;
                result.pos = right.pos;
            } else {
                break;
            }
        }

        return result;
    }

    /**
     * Evaluate logical AND
     * LSL: &&, Luau: and
     */
    private evaluateLogicalAnd(tokens: Token[], pos: number): { value: number; pos: number } {
        let result = this.evaluateComparison(tokens, pos);

        const andOp = this.config.logicalOperators.and;

        while (result.pos < tokens.length) {
            const token = tokens[result.pos];
            // Check both OPERATOR type and IDENTIFIER type (for Luau keywords)
            const isAndOp = (token.type === TokenType.OPERATOR && token.value === andOp) ||
                           (token.type === TokenType.IDENTIFIER && token.value === andOp);

            if (isAndOp) {
                result.pos++;
                const right = this.evaluateComparison(tokens, result.pos);
                result.value = (result.value !== 0 && right.value !== 0) ? 1 : 0;
                result.pos = right.pos;
            } else {
                break;
            }
        }

        return result;
    }

    /**
     * Evaluate comparison operators (==, !=, <, >, <=, >=)
     */
    private evaluateComparison(tokens: Token[], pos: number): { value: number; pos: number } {
        let result = this.evaluateAddition(tokens, pos);

        while (result.pos < tokens.length) {
            const token = tokens[result.pos];
            if (token.type === TokenType.OPERATOR) {
                const op = token.value;
                if (op === "==" || op === "!=" || op === "<" || op === ">" ||
                    op === "<=" || op === ">=" || op === "~=") {
                    result.pos++;
                    const right = this.evaluateAddition(tokens, result.pos);

                    switch (op) {
                        case "==":
                            result.value = (result.value === right.value) ? 1 : 0;
                            break;
                        case "!=":
                        case "~=": // Luau inequality operator
                            result.value = (result.value !== right.value) ? 1 : 0;
                            break;
                        case "<":
                            result.value = (result.value < right.value) ? 1 : 0;
                            break;
                        case ">":
                            result.value = (result.value > right.value) ? 1 : 0;
                            break;
                        case "<=":
                            result.value = (result.value <= right.value) ? 1 : 0;
                            break;
                        case ">=":
                            result.value = (result.value >= right.value) ? 1 : 0;
                            break;
                    }

                    result.pos = right.pos;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        return result;
    }

    /**
     * Evaluate addition and subtraction
     */
    private evaluateAddition(tokens: Token[], pos: number): { value: number; pos: number } {
        let result = this.evaluateMultiplication(tokens, pos);

        while (result.pos < tokens.length) {
            const token = tokens[result.pos];
            if (token.type === TokenType.OPERATOR && (token.value === "+" || token.value === "-")) {
                const op = token.value;
                result.pos++;
                const right = this.evaluateMultiplication(tokens, result.pos);

                if (op === "+") {
                    result.value = result.value + right.value;
                } else {
                    result.value = result.value - right.value;
                }

                result.pos = right.pos;
            } else {
                break;
            }
        }

        return result;
    }

    /**
     * Evaluate multiplication, division, and modulo
     */
    private evaluateMultiplication(tokens: Token[], pos: number): { value: number; pos: number } {
        let result = this.evaluateUnary(tokens, pos);

        while (result.pos < tokens.length) {
            const token = tokens[result.pos];
            if (token.type === TokenType.OPERATOR &&
                (token.value === "*" || token.value === "/" || token.value === "%")) {
                const op = token.value;
                result.pos++;
                const right = this.evaluateUnary(tokens, result.pos);

                if (op === "*") {
                    result.value = result.value * right.value;
                } else if (op === "/") {
                    if (right.value === 0) {
                        throw new Error("Division by zero");
                    }
                    result.value = Math.floor(result.value / right.value); // Integer division
                } else { // %
                    if (right.value === 0) {
                        throw new Error("Modulo by zero");
                    }
                    result.value = result.value % right.value;
                }

                result.pos = right.pos;
            } else {
                break;
            }
        }

        return result;
    }

    /**
     * Evaluate unary operators (-, !, not)
     */
    private evaluateUnary(tokens: Token[], pos: number): { value: number; pos: number } {
        if (pos >= tokens.length) {
            throw new Error("Unexpected end of expression");
        }

        const token = tokens[pos];
        const notOp = this.config.logicalOperators.not;

        // Handle unary minus
        if (token.type === TokenType.OPERATOR && token.value === "-") {
            const result = this.evaluateUnary(tokens, pos + 1);
            return { value: -result.value, pos: result.pos };
        }

        // Handle logical NOT (! or not)
        // Check both OPERATOR type and IDENTIFIER type (for Luau keywords)
        const isNotOp = (token.type === TokenType.OPERATOR && token.value === notOp) ||
                       (token.type === TokenType.IDENTIFIER && token.value === notOp);

        if (isNotOp) {
            const result = this.evaluateUnary(tokens, pos + 1);
            return { value: result.value === 0 ? 1 : 0, pos: result.pos };
        }

        return this.evaluatePrimary(tokens, pos);
    }

    /**
     * Evaluate primary expressions (numbers, identifiers, parentheses)
     */
    private evaluatePrimary(tokens: Token[], pos: number): { value: number; pos: number } {
        if (pos >= tokens.length) {
            throw new Error("Unexpected end of expression");
        }

        const token = tokens[pos];

        // Handle parentheses
        if (token.type === TokenType.PAREN_OPEN) {
            const result = this.evaluateExpression(tokens, pos + 1);
            if (result.pos >= tokens.length || tokens[result.pos].type !== TokenType.PAREN_CLOSE) {
                throw new Error("Missing closing parenthesis");
            }
            return { value: result.value, pos: result.pos + 1 };
        }

        // Handle numbers
        if (token.type === TokenType.NUMBER_LITERAL) {
            const value = parseFloat(token.value);
            if (isNaN(value)) {
                throw new Error(`Invalid number: ${token.value}`);
            }
            return { value, pos: pos + 1 };
        }

        // Handle identifiers (boolean literals or undefined macros)
        if (token.type === TokenType.IDENTIFIER) {
            const value = token.value.toLowerCase();

            // Check for boolean literals
            if (value === "true") {
                return { value: 1, pos: pos + 1 };
            }
            if (value === "false") {
                return { value: 0, pos: pos + 1 };
            }

            // Undefined identifier evaluates to 0
            return { value: 0, pos: pos + 1 };
        }

        throw new Error(`Unexpected token: ${token.type} ${token.value}`);
    }

    //#endregion

    //#region Diagnostic Helpers

    /**
     * Create a diagnostic for a conditional processor error
     */
    private createDiagnostic(
        message: string,
        location: DiagnosticLocation,
        code: string
    ): PreprocessorDiagnostic {
        return {
            severity: 0, // ERROR
            message,
            line: location.line,
            column: location.column,
            length: location.length,
            sourceFile: location.sourceFile,
            code,
        };
    }

    //#endregion
}

//#endregion
