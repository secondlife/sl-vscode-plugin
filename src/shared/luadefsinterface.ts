/**
 * TypeScript interfaces for LSL Luau type definitions
 * Based on ll-defs-schema.json
 */

/**
 * Type reference - can be either a string name or a nested type definition
 */
export type TypeReference = string | TypeDefinition;

/**
 * Discriminated union of all type definition kinds
 */
export type TypeDefinition =
  | UnionType
  | ArrayType
  | TableType
  | FunctionType
  | IntersectionType
  | LiteralUnionType
  | ReferenceType;

/**
 * Union type (e.g., boolean | number)
 */
export interface UnionType {
  kind: "union";
  types: TypeReference[];
}

/**
 * Array type (e.g., {string})
 */
export interface ArrayType {
  kind: "array";
  elementType: TypeReference;
}

/**
 * Table/object type with properties and methods
 */
export interface TableType {
  kind: "table";
  properties?: TableProperty[];
  methods?: FunctionSignature[];
}

/**
 * Table property definition
 */
export interface TableProperty {
  name: string;
  type: TypeReference;
  optional?: boolean;
}

/**
 * Function type (e.g., (x: number) -> string)
 */
export interface FunctionType {
  kind: "function";
  parameters: Parameter[];
  returnType: TypeReference;
}

/**
 * Intersection type (e.g., function overloads)
 */
export interface IntersectionType {
  kind: "intersection";
  types: FunctionType[];
}

/**
 * Literal union type (e.g., "value1" | "value2")
 */
export interface LiteralUnionType {
  kind: "literal-union";
  values: string[];
}

/**
 * Simple type reference
 */
export interface ReferenceType {
  kind: "reference";
  name: string;
}

/**
 * Function/method parameter
 * - Regular parameters require both name and type
 * - Self parameters only need name (type is implicit)
 * - Variadic parameters only need type (no name)
 */
export interface Parameter {
  name?: string;
  type?: TypeReference;
  optional?: boolean;
  variadic?: boolean;
}

/**
 * Function or method signature with optional overloads
 */
export interface FunctionSignature {
  name: string;
  parameters: Parameter[];
  returnType: TypeReference;
  comment?: string;
  overloads?: FunctionOverload[];
}

/**
 * Function overload signature
 */
export interface FunctionOverload {
  parameters: Parameter[];
  returnType: TypeReference;
  comment?: string;
}

/**
 * Type alias definition
 */
export interface TypeAlias {
  name: string;
  definition: TypeDefinition;
  comment?: string;
}

/**
 * Class declaration with properties and methods
 */
export interface ClassDeclaration {
  name: string;
  properties?: ClassProperty[];
  methods?: FunctionSignature[];
  comment?: string;
}

/**
 * Class property definition
 */
export interface ClassProperty {
  name: string;
  type: TypeReference;
  comment?: string;
}

/**
 * Global variable declaration
 */
export interface GlobalVariable {
  name: string;
  type: TypeReference;
  comment?: string;
}

/**
 * Global function declaration
 */
export interface GlobalFunction extends FunctionSignature {
  // Inherits all properties from FunctionSignature
}

/**
 * Module declaration with properties and functions
 */
export interface ModuleDeclaration {
  name: string;
  properties?: ModuleProperty[];
  functions?: FunctionSignature[];
  comment?: string;
}

/**
 * Module property definition
 */
export interface ModuleProperty {
  name: string;
  type: TypeReference;
  comment?: string;
}

/**
 * Constant declaration
 */
export interface ConstantDeclaration {
  name: string;
  type: TypeReference;
  value?: string | number | boolean;
  comment?: string;
}

/**
 * Root structure of Luau type definitions file
 */
export interface LuaTypeDefinitions {
  version: string;
  typeAliases?: TypeAlias[];
  classes?: ClassDeclaration[];
  globalVariables?: GlobalVariable[];
  globalFunctions?: GlobalFunction[];
  modules?: ModuleDeclaration[];
  constants?: ConstantDeclaration[];
}
