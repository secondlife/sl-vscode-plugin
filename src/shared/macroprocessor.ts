/**
 * @file macroprocessor.ts
 * Token-based macro processor for the lexing preprocessor
 * Copyright (C) 2025, Linden Research, Inc.
 *
 * This macro processor works with Token objects rather than strings,
 * providing more accurate macro expansion with proper tokenization.
 *
 * @example Dynamic Macros
 * ```typescript
 * const processor = new MacroProcessor('lsl');
 *
 * // Define special macros that generate values at expansion time
 * processor.defineDynamic('__LINE__', (ctx) => ctx.line.toString());
 * processor.defineDynamic('__FILE__', (ctx) => `"${ctx.sourceFile}"`);
 * processor.defineDynamic('__AGENTID__', () => getCurrentAgentId());
 *
 * // Expand with context
 * const context = { line: 42, column: 1, sourceFile: 'script.lsl' };
 * const tokens = processor.expandSimple('__LINE__', context);
 * // Returns: [Token(NUMBER_LITERAL, "42", 42, 1, 2)]
 * ```
 */

import { Token, TokenType } from './lexer';
import { ScriptLanguage } from './languageservice';
import { DiagnosticCollector, ErrorCodes, DiagnosticSeverity } from './diagnostics';
import { NormalizedPath } from '../interfaces/hostinterface';

//#region Macro Definition

/**
 * Context provided to dynamic macro functions
 */
export interface MacroExpansionContext {
    line: number;
    column: number;
    sourceFile: string;
    // Can be extended with additional context as needed
    // e.g., agentId, objectId, scriptName, etc.
}

/**
 * Macro definition for the token-based preprocessor
 */
export interface MacroDefinition {
    name: string;
    parameters?: string[];
    body: Token[];
    isFunctionLike: boolean;
    dynamicValue?: (context: MacroExpansionContext) => string;
    isSystem?: boolean;
}

//#endregion

//#region Macro Processor

/**
 * Token-based macro processor
 * Handles macro definition, expansion, and substitution
 */
export class MacroProcessor {
    private macros: Map<string, MacroDefinition>;
    private language: ScriptLanguage;
    private enabled: boolean;

    constructor(language: ScriptLanguage) {
        this.macros = new Map();
        this.language = language;
        this.enabled = true;
    }

    //#region Macro Management

    public define(definition: MacroDefinition): void {
        if (!this.enabled) {
            return;
        }
        this.macros.set(definition.name, definition);
    }

    public defineSystemMacro(name: string, func: (context: MacroExpansionContext) => string): void {
        const definition: MacroDefinition = {
            name,
            parameters: undefined,
            body: [], // Empty body for system macros
            isFunctionLike: false,
            dynamicValue: func,
            isSystem: true
        };
        this.macros.set(name, definition);
    }

    public undefine(name: string): boolean {
        return this.macros.delete(name);
    }

    public isDefined(name: string): boolean {
        return this.macros.has(name);
    }

    public getMacro(name: string): MacroDefinition | undefined {
        return this.macros.get(name);
    }

    public getAllMacros(): Map<string, MacroDefinition> {
        return new Map(this.macros);
    }

    public clear(): void {
        this.macros.clear();
    }

    public clearNonSystemMacros(): void {
        for (const [name, macro] of this.macros) {
            if (!macro.isSystem) {
                this.macros.delete(name);
            }
        }
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public defineDynamic(
        name: string,
        valueGenerator: (context: MacroExpansionContext) => string
    ): void {
        const definition: MacroDefinition = {
            name,
            parameters: undefined,
            body: [], // Empty body for dynamic macros
            isFunctionLike: false,
            dynamicValue: valueGenerator
        };
        this.macros.set(name, definition);
    }

    /**
     * Process defined() operators in token stream
     * Replaces defined(MACRO) with 1 if macro is defined, 0 otherwise
     * @param tokens - Input tokens
     * @param diagnostics - Optional diagnostic collector
     * @param sourceFile - Optional source file path for diagnostics
     * @param line - Optional line number override for diagnostics
     * @returns Tokens with defined() replaced by numeric literals
     */
    public processDefined(
        tokens: Token[],
        diagnostics?: DiagnosticCollector,
        sourceFile?: NormalizedPath,
        line?: number
    ): Token[] {
        const result: Token[] = [];
        let i = 0;

        while (i < tokens.length) {
            const token = tokens[i];

            // Check for 'defined' directive token
            if (token.type === TokenType.DIRECTIVE && token.value === 'defined') {
                // Look for ( MACRO_NAME )
                let j = i + 1;

                // Skip whitespace
                while (j < tokens.length && tokens[j].isWhitespaceOrNewline()) {
                    j++;
                }

                // Expect opening parenthesis
                if (j < tokens.length && tokens[j].type === TokenType.PAREN_OPEN) {
                    j++;

                    // Skip whitespace
                    while (j < tokens.length && tokens[j].isWhitespaceOrNewline()) {
                        j++;
                    }

                    // Expect macro name (identifier)
                    if (j < tokens.length && tokens[j].type === TokenType.IDENTIFIER) {
                        const macroName = tokens[j].value;
                        j++;

                        // Skip whitespace
                        while (j < tokens.length && tokens[j].isWhitespaceOrNewline()) {
                            j++;
                        }

                        // Expect closing parenthesis
                        if (j < tokens.length && tokens[j].type === TokenType.PAREN_CLOSE) {
                            // Valid defined(MACRO) - replace with 1 or 0
                            const isDefined = this.isDefined(macroName);
                            const value = isDefined ? '1' : '0';

                            result.push(new Token(
                                TokenType.NUMBER_LITERAL,
                                value,
                                token.line,
                                token.column,
                                value.length
                            ));

                            // Skip past all consumed tokens
                            i = j + 1;
                            continue;
                        } else {
                            // MAC004: Missing closing parenthesis
                            if (diagnostics && sourceFile) {
                                diagnostics.add({
                                    severity: DiagnosticSeverity.ERROR,
                                    code: ErrorCodes.INVALID_DEFINED_SYNTAX,
                                    message: "defined() requires closing parenthesis",
                                    sourceFile: sourceFile,
                                    line: line ?? token.line,
                                    column: token.column,
                                    length: "defined".length
                                });
                            }
                        }
                    } else {
                        // MAC004: Missing macro name
                        if (diagnostics && sourceFile) {
                            diagnostics.add({
                                severity: DiagnosticSeverity.ERROR,
                                code: ErrorCodes.INVALID_DEFINED_SYNTAX,
                                message: "defined() requires macro name",
                                sourceFile: sourceFile,
                                line: line ?? token.line,
                                column: token.column,
                                length: "defined".length
                            });
                        }
                    }
                } else {
                    // MAC004: Missing opening parenthesis
                    if (diagnostics && sourceFile) {
                        diagnostics.add({
                            severity: DiagnosticSeverity.ERROR,
                            code: ErrorCodes.INVALID_DEFINED_SYNTAX,
                            message: "defined() requires opening parenthesis",
                            sourceFile: sourceFile,
                            line: line ?? token.line,
                            column: token.column,
                            length: "defined".length
                        });
                    }
                }
            }

            // Not a valid defined() expression - keep token as-is
            result.push(token);
            i++;
        }

        return result;
    }

    //#endregion

    //#region Macro Expansion

    /**
     * Expand a simple (non-function-like) macro
     * Returns the macro body tokens, or generates value for dynamic macros
     * Recursively expands any macros found in the expanded tokens
     * @param name - Macro name to expand
     * @param context - Expansion context
     * @param expanding - Set of macros currently being expanded (for recursion detection)
     * @param diagnostics - Optional diagnostic collector
     * @param sourceFile - Optional source file path for diagnostics
     * @param line - Optional line number for diagnostics
     * @param column - Optional column number for diagnostics
     */
    public expandSimple(
        name: string,
        context?: MacroExpansionContext,
        expanding?: Set<string>,
        diagnostics?: DiagnosticCollector,
        sourceFile?: NormalizedPath,
        line?: number,
        column?: number
    ): Token[] | null {
        if (!this.enabled) {
            return null;
        }

        const macro = this.macros.get(name);
        if (!macro || macro.isFunctionLike) {
            // MAC001: Undefined macro (warning only)
            if (!macro && diagnostics && sourceFile) {
                diagnostics.add({
                    severity: DiagnosticSeverity.WARNING,
                    code: ErrorCodes.UNDEFINED_MACRO,
                    message: `Macro '${name}' is not defined`,
                    sourceFile: sourceFile,
                    line: line ?? (context?.line ?? 0),
                    column: column ?? (context?.column ?? 0),
                    length: name.length
                });
            }
            return null;
        }

        // Prevent infinite recursion
        const expandingSet = expanding || new Set<string>();
        if (expandingSet.has(name)) {
            // MAC003: Recursive expansion (warning)
            if (diagnostics && sourceFile) {
                diagnostics.add({
                    severity: DiagnosticSeverity.WARNING,
                    code: ErrorCodes.RECURSIVE_EXPANSION,
                    message: `Recursive macro expansion detected for '${name}'`,
                    sourceFile: sourceFile,
                    line: line ?? (context?.line ?? 0),
                    column: column ?? (context?.column ?? 0),
                    length: name.length
                });
            }
            // Macro is already being expanded, return identifier token unchanged
            return null;
        }

        // Handle dynamic value macros
        if (macro.dynamicValue) {
            if (!context) {
                throw new Error(`Dynamic macro ${name} requires expansion context`);
            }
            const value = macro.dynamicValue(context);
            // Create a token from the dynamic value
            // Infer type based on value
            let tokenType: TokenType = TokenType.IDENTIFIER;
            if (/^\d+$/.test(value)) {
                tokenType = TokenType.NUMBER_LITERAL;
            } else if (value.startsWith('"') || value.startsWith("'")) {
                tokenType = TokenType.STRING_LITERAL;
            }
            return [new Token(
                tokenType,
                value,
                context.line,
                context.column,
                value.length
            )];
        }

        // Mark this macro as being expanded
        expandingSet.add(name);

        // Get a copy of the macro body tokens
        const bodyTokens = macro.body.map(t => t.clone());

        // Recursively expand any macros in the body
        const expanded = this.expandTokens(bodyTokens, context, expandingSet, diagnostics, sourceFile);

        // Remove this macro from the expanding set
        expandingSet.delete(name);

        return expanded;
    }

    /**
     * Expand a function-like macro with arguments
     * Returns the expanded tokens with parameter substitution
     * Recursively expands any macros found in the expanded tokens
     * @param name - Macro name to expand
     * @param args - Arguments to pass to the macro
     * @param context - Expansion context
     * @param expanding - Set of macros currently being expanded (for recursion detection)
     * @param diagnostics - Optional diagnostic collector
     * @param sourceFile - Optional source file path for diagnostics
     * @param line - Optional line number for diagnostics
     * @param column - Optional column number for diagnostics
     */
    public expandFunction(
        name: string,
        args: Token[][],
        context?: MacroExpansionContext,
        expanding?: Set<string>,
        diagnostics?: DiagnosticCollector,
        sourceFile?: NormalizedPath,
        line?: number,
        column?: number
    ): Token[] | null {
        if (!this.enabled) {
            return null;
        }

        const macro = this.macros.get(name);
        if (!macro || !macro.isFunctionLike) {
            return null;
        }

        // Prevent infinite recursion
        const expandingSet = expanding || new Set<string>();
        if (expandingSet.has(name)) {
            // Macro is already being expanded, return null
            return null;
        }

        // Get parameter names
        const parameters = macro.parameters || [];

        // MAC002: Validate argument count
        if (args.length !== parameters.length) {
            if (diagnostics && sourceFile) {
                diagnostics.add({
                    severity: DiagnosticSeverity.ERROR,
                    code: ErrorCodes.ARGUMENT_COUNT_MISMATCH,
                    message: `Macro '${name}' expects ${parameters.length} argument(s), but ${args.length} provided`,
                    sourceFile: sourceFile,
                    line: line ?? (context?.line ?? 0),
                    column: column ?? (context?.column ?? 0),
                    length: name.length
                });
            }
            // Return null to prevent expansion with wrong argument count
            return null;
        }

        // Mark this macro as being expanded
        expandingSet.add(name);

        // Substitute parameters with arguments
        let bodyTokens = this.substituteParameters(
            macro.body,
            parameters,
            args,
            context,
            expandingSet
        );

        // Recursively expand any macros in the substituted body
        const expanded = this.expandTokens(bodyTokens, context, expandingSet, diagnostics, sourceFile);

        // Remove this macro from the expanding set
        expandingSet.delete(name);

        return expanded;
    }

    /**
     * Recursively expand macros in a token array
     * Returns a new array with all macros expanded
     */
    private expandTokens(
        tokens: Token[],
        context?: MacroExpansionContext,
        expanding?: Set<string>,
        diagnostics?: DiagnosticCollector,
        sourceFile?: NormalizedPath
    ): Token[] {
        const result: Token[] = [];
        const expandingSet = expanding || new Set<string>();

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            // Only try to expand identifiers
            if (token.type !== TokenType.IDENTIFIER) {
                result.push(token);
                continue;
            }

            const name = token.value;

            // Check if this is a macro
            const macro = this.macros.get(name);
            if (!macro) {
                result.push(token);
                continue;
            }

            // Check if it's a function-like macro
            if (macro.isFunctionLike) {
                // Look ahead for opening parenthesis
                let nextIdx = i + 1;
                const whitespaceTokens: Token[] = [];

                // Skip whitespace tokens
                while (nextIdx < tokens.length && tokens[nextIdx].isWhitespaceOrNewline()) {
                    whitespaceTokens.push(tokens[nextIdx]);
                    nextIdx++;
                }

                // Check if next token is opening paren
                if (nextIdx < tokens.length && tokens[nextIdx].type === TokenType.PAREN_OPEN) {
                    // Parse argument list
                    const { args, endIdx } = this.parseArgumentsFromTokens(tokens, nextIdx);

                    // Expand the function-like macro
                    const expanded = this.expandFunction(
                        name,
                        args,
                        context,
                        expandingSet,
                        diagnostics,
                        sourceFile,
                        token.line,
                        token.column
                    );
                    if (expanded) {
                        result.push(...expanded);
                    } else {
                        // Couldn't expand (e.g., recursive reference) - keep original tokens
                        result.push(token);
                        result.push(...whitespaceTokens);
                        for (let j = nextIdx; j <= endIdx; j++) {
                            result.push(tokens[j]);
                        }
                    }

                    i = endIdx; // Move past the entire function call
                } else {
                    // Function-like macro without parentheses - don't expand
                    result.push(token);
                }
            } else {
                // Simple macro - expand it
                const expanded = this.expandSimple(
                    name,
                    context,
                    expandingSet,
                    diagnostics,
                    sourceFile,
                    token.line,
                    token.column
                );
                if (expanded) {
                    result.push(...expanded);
                } else {
                    // Couldn't expand (e.g., recursive reference)
                    result.push(token);
                }
            }
        }

        return result;
    }

    /**
     * Check if an identifier should be expanded
     */
    public shouldExpand(name: string, isFunctionCall: boolean): boolean {
        if (!this.enabled) {
            return false;
        }

        const macro = this.macros.get(name);
        if (!macro) {
            return false;
        }

        // Function-like macros only expand when called with parentheses
        if (macro.isFunctionLike) {
            return isFunctionCall;
        }

        return true;
    }

    //#endregion

    //#region Advanced Features

    /**
     * Handle stringification operator (#)
     * Converts a token to a string literal
     *
     * Note: This is a simplified public interface. The actual stringification
     * implementation is in stringifyTokens() which is called during parameter
     * substitution in substituteParameters().
     */
    public stringify(token: Token): Token {
        // For simple single-token stringification
        return this.stringifyTokens([token]);
    }

    /**
     * Handle token pasting operator (##)
     * Concatenates two tokens
     *
     * Note: This is a simplified public interface. The actual token pasting
     * implementation is in pasteTokens() which is called during parameter
     * substitution in substituteParameters().
     */
    public paste(left: Token, right: Token): Token {
        // For simple two-token pasting
        const result = this.pasteTokens([left], [right]);
        return result.length > 0 ? result[0] : left.clone();
    }

    /**
     * Substitute parameters in macro body
     * Handles #param (stringification) and param##param (pasting)
     */
    private substituteParameters(
        body: Token[],
        parameters: string[],
        args: Token[][],
        context?: MacroExpansionContext,
        expanding?: Set<string>
    ): Token[] {
        const result: Token[] = [];

        // Create a map of parameter names to their argument tokens
        const paramMap = new Map<string, Token[]>();
        for (let i = 0; i < parameters.length; i++) {
            if (i < args.length) {
                paramMap.set(parameters[i], args[i]);
            } else {
                // Missing argument, use empty token array
                paramMap.set(parameters[i], []);
            }
        }

        // Track pending whitespace tokens to preserve spacing
        let pendingWhitespace: Token[] = [];

        for (let i = 0; i < body.length; i++) {
            const token = body[i];

            // Collect whitespace and newline tokens separately
            if (token.type === TokenType.WHITESPACE || token.type === TokenType.NEWLINE) {
                pendingWhitespace.push(token.clone());
                continue;
            }

            // Check for stringification operator (#param)
            // The lexer may tokenize #x as a single DIRECTIVE token or as separate # and x tokens
            if (token.value === '#' && i + 1 < body.length) {
                const nextToken = body[i + 1];
                if (nextToken.type === TokenType.IDENTIFIER && paramMap.has(nextToken.value)) {
                    // Stringification: #param -> "arg"
                    // Emit any pending whitespace before the stringified value
                    result.push(...pendingWhitespace);
                    pendingWhitespace = [];

                    const argTokens = paramMap.get(nextToken.value)!;
                    const stringified = this.stringifyTokens(argTokens);
                    result.push(stringified);
                    i++; // Skip the parameter name token
                    continue;
                }
            } else if (token.type === TokenType.DIRECTIVE && token.value.startsWith('#') && token.value.length > 1) {
                // Handle case where lexer tokenized #param as a single DIRECTIVE token
                const paramName = token.value.substring(1);
                if (paramMap.has(paramName)) {
                    // Stringification: #param -> "arg"
                    // Emit any pending whitespace before the stringified value
                    result.push(...pendingWhitespace);
                    pendingWhitespace = [];

                    const argTokens = paramMap.get(paramName)!;
                    const stringified = this.stringifyTokens(argTokens);
                    result.push(stringified);
                    continue;
                }
            }

            // Check for token pasting operator (param##param or token##param)
            // The lexer may tokenize ## as two # tokens or as # followed by #identifier
            if (i + 2 < body.length) {
                let isPasting = false;
                let leftToken = token;
                let rightToken: Token | null = null;

                // Check for ## pattern (two # tokens in a row)
                if (body[i + 1].value === '#' && body[i + 1].type === TokenType.DIRECTIVE) {
                    if (body[i + 2].type === TokenType.DIRECTIVE && body[i + 2].value.startsWith('#')) {
                        // Pattern: token # #identifier -> token##identifier
                        rightToken = new Token(
                            TokenType.IDENTIFIER,
                            body[i + 2].value.substring(1),
                            body[i + 2].line,
                            body[i + 2].column + 1,
                            body[i + 2].length - 1
                        );
                        isPasting = true;
                    } else if (body[i + 2].type === TokenType.IDENTIFIER || body[i + 2].type === TokenType.NUMBER_LITERAL) {
                        // Pattern: token # identifier -> token##identifier
                        rightToken = body[i + 2];
                        isPasting = true;
                    }
                } else if (body[i + 1].value === '##') {
                    // Pattern: token ## identifier (if lexer supports ## as single token)
                    rightToken = body[i + 2];
                    isPasting = true;
                }

                if (isPasting && rightToken) {
                    // Emit any pending whitespace before the pasted token
                    result.push(...pendingWhitespace);
                    pendingWhitespace = [];

                    // Get the actual tokens to paste
                    let leftTokens: Token[];
                    if (leftToken.type === TokenType.IDENTIFIER && paramMap.has(leftToken.value)) {
                        leftTokens = paramMap.get(leftToken.value)!;
                    } else {
                        leftTokens = [leftToken];
                    }

                    let rightTokens: Token[];
                    if (rightToken.type === TokenType.IDENTIFIER && paramMap.has(rightToken.value)) {
                        rightTokens = paramMap.get(rightToken.value)!;
                    } else {
                        rightTokens = [rightToken];
                    }

                    // Paste the tokens
                    const pasted = this.pasteTokens(leftTokens, rightTokens);
                    result.push(...pasted);
                    i += 2; // Skip ## and right token
                    continue;
                }
            }

            // Simple parameter substitution
            if (token.type === TokenType.IDENTIFIER && paramMap.has(token.value)) {
                // Emit any pending whitespace before the substituted parameter
                result.push(...pendingWhitespace);
                pendingWhitespace = [];

                const argTokens = paramMap.get(token.value)!;

                // Clone the argument tokens
                const clonedArgs = argTokens.map(t => t.clone());

                // Expand any macros in the arguments (arguments are fully expanded before substitution)
                const expandedArgs = this.expandTokens(clonedArgs, context, expanding);

                result.push(...expandedArgs);
            } else {
                // Not a parameter, emit pending whitespace and keep the token as-is
                result.push(...pendingWhitespace);
                pendingWhitespace = [];
                result.push(token.clone());
            }
        }

        // Emit any remaining pending whitespace at the end
        result.push(...pendingWhitespace);

        return result;
    }

    /**
     * Stringify an array of tokens into a string literal token
     */
    private stringifyTokens(tokens: Token[]): Token {
        // Concatenate all token values into a single string
        const value = tokens.map(t => t.value).join('');

        // Escape quotes and backslashes
        const escaped = value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');

        // Create a string literal token
        const stringValue = `"${escaped}"`;

        // Use position from first token if available
        const firstToken = tokens.length > 0 ? tokens[0] : null;
        return new Token(
            TokenType.STRING_LITERAL,
            stringValue,
            firstToken?.line || 0,
            firstToken?.column || 0,
            stringValue.length
        );
    }

    /**
     * Paste (concatenate) two token arrays
     */
    private pasteTokens(left: Token[], right: Token[]): Token[] {
        if (left.length === 0) {
            return right.map(t => t.clone());
        }
        if (right.length === 0) {
            return left.map(t => t.clone());
        }

        // Get the last token from left and first token from right
        const leftLast = left[left.length - 1];
        const rightFirst = right[0];

        // Concatenate their values
        const pastedValue = leftLast.value + rightFirst.value;

        // Create a new token with the pasted value
        const pastedToken = new Token(
            leftLast.type, // Use left token's type
            pastedValue,
            leftLast.line,
            leftLast.column,
            pastedValue.length
        );

        // Build result: all left tokens except last, pasted token, all right tokens except first
        const result: Token[] = [];
        for (let i = 0; i < left.length - 1; i++) {
            result.push(left[i].clone());
        }
        result.push(pastedToken);
        for (let i = 1; i < right.length; i++) {
            result.push(right[i].clone());
        }

        return result;
    }

    /**
     * Parse function arguments from a token array starting at an opening paren
     * Returns the arguments and the index of the closing paren
     */
    private parseArgumentsFromTokens(tokens: Token[], startIdx: number): { args: Token[][], endIdx: number } {
        const args: Token[][] = [];
        let currentArg: Token[] = [];
        let parenDepth = 0;
        let i = startIdx;

        // Skip the opening paren
        if (i < tokens.length && tokens[i].type === TokenType.PAREN_OPEN) {
            i++;
        }

        while (i < tokens.length) {
            const token = tokens[i];

            if (token.type === TokenType.PAREN_OPEN) {
                parenDepth++;
                currentArg.push(token);
            } else if (token.type === TokenType.PAREN_CLOSE) {
                if (parenDepth === 0) {
                    // End of argument list
                    if (currentArg.length > 0) {
                        args.push(currentArg);
                    }
                    return { args, endIdx: i };
                }
                parenDepth--;
                currentArg.push(token);
            } else if (token.value === ',' && parenDepth === 0) {
                // Argument separator
                args.push(currentArg);
                currentArg = [];
            } else {
                currentArg.push(token);
            }

            i++;
        }

        // If we get here, we didn't find a closing paren - return what we have
        if (currentArg.length > 0) {
            args.push(currentArg);
        }
        return { args, endIdx: i - 1 };
    }

    //#endregion

    //#region State Management

    /**
     * Export macro state for sharing between parsers
     */
    public exportState(): Map<string, MacroDefinition> {
        return new Map(this.macros);
    }

    /**
     * Import macro state from another processor
     */
    public importState(state: Map<string, MacroDefinition>): void {
        this.macros = new Map(state);
    }

    /**
     * Merge macros from another processor
     */
    public merge(other: MacroProcessor): void {
        for (const [name, def] of other.macros) {
            this.macros.set(name, def);
        }
    }

    //#endregion
}

//#endregion
