/**
 * TypeScript interfaces for LSL Keywords data structure
 * Based on keywords_lsl.schema.json
 */

/**
 * LSL data types
 */
export type LSLType = "integer" | "float" | "string" | "key" | "vector" | "rotation" | "list" | "void";

/**
 * A constant definition
 */
export interface LSLConstant {
    /** The data type of the constant */
    type: Exclude<LSLType, "void" | "list">;
    /** The value of the constant (may be hex, decimal, or other representations) */
    value: string;
    /** Documentation tooltip for the constant */
    tooltip?: string;
    /** Whether this constant is deprecated */
    deprecated?: boolean;
}

/**
 * A parameter definition with a single named property
 */
export type LSLParameter = {
    [paramName: string]: {
        /** The data type of the parameter */
        type: LSLType;
        /** Documentation tooltip for the parameter */
        tooltip?: string;
    };
};

/**
 * An event handler definition
 */
export interface LSLEvent {
    /** List of arguments for the event handler */
    arguments: LSLParameter[];
    /** Documentation tooltip for the event */
    tooltip?: string;
    /** Whether this event is deprecated */
    deprecated?: boolean;
}

/**
 * A function definition
 */
export interface LSLFunction {
    /** List of arguments for the function */
    arguments: LSLParameter[];
    /** Return type of the function */
    return: LSLType;
    /** Energy cost to execute the function */
    energy: number;
    /** Sleep delay after function execution (in seconds) */
    sleep: number;
    /** Whether the function has boolean semantics */
    bool_semantics: boolean;
    /** Whether the function has index-based semantics */
    "index-semantics"?: boolean;
    /** Documentation tooltip for the function */
    tooltip?: string;
    /** Whether this function is deprecated */
    deprecated?: boolean;
    /** Whether this function requires god-mode/admin privileges */
    "god-mode"?: boolean;
}

/**
 * A type definition
 */
export interface LSLTypeDefinition {
    /** Documentation tooltip for the type */
    tooltip: string;
    /** Whether this type is private/internal */
    private?: boolean;
}

/**
 * Root structure of LSL keywords data
 */
export interface LSLKeywords {
    /** Version number of the LLSD LSL syntax format */
    "llsd-lsl-syntax-version": number;
    /** LSL predefined constants */
    constants?: {
        [constantName: string]: LSLConstant;
    };
    controls?: any;
    /** LSL event handlers */
    events?: {
        [eventName: string]: LSLEvent;
    };
    /** LSL built-in functions */
    functions?: {
        [functionName: string]: LSLFunction;
    };
    /** LSL data types */
    types?: {
        [typeName: string]: LSLTypeDefinition;
    };
}

/**
 * Helper type for accessing individual sections
 */
export type LSLConstants = NonNullable<LSLKeywords["constants"]>;
export type LSLEvents = NonNullable<LSLKeywords["events"]>;
export type LSLFunctions = NonNullable<LSLKeywords["functions"]>;
export type LSLTypes = NonNullable<LSLKeywords["types"]>;
