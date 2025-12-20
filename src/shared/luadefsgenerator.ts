/**
 * Generator class for creating .luau type definition files from structured JSON data
 */

import {
    LuaTypeDefinitions,
    TypeReference,
    TypeDefinition,
    Parameter,
    FunctionSignature,
    TypeAlias,
    ClassDeclaration,
    GlobalVariable,
    GlobalFunction,
    ModuleDeclaration,
    ConstantDeclaration,
    UnionType,
    ArrayType,
    TableType,
    FunctionType,
    IntersectionType,
    LiteralUnionType,
    ReferenceType,
    CallableTableType,
    TypeofType
} from './luadefsinterface';

export class LuauDefsGenerator {
    private indent = '  ';

    // Type aliases defined in this file (for dependency checking)
    private typeAliasNames: Set<string> = new Set();

    /**
     * Generate complete .luau type definition file
     */
    generate(defs: LuaTypeDefinitions): string {
        const sections: string[] = [];

        // Header
        sections.push('');
        sections.push('----------------------------------');
        sections.push('---------- LSL LUAU DEFS ---------');
        sections.push('----------------------------------');
        sections.push('');

        // Collect type alias names for dependency checking
        this.typeAliasNames.clear();
        if (defs.typeAliases) {
            for (const alias of defs.typeAliases) {
                this.typeAliasNames.add(alias.name);
            }
        }

        // Split classes into those that depend on type aliases and those that don't
        const baseClasses: ClassDeclaration[] = [];
        const dependentClasses: ClassDeclaration[] = [];
        
        if (defs.classes && defs.classes.length > 0) {
            for (const cls of defs.classes) {
                if (this.classUsesTypeAliases(cls)) {
                    dependentClasses.push(cls);
                } else {
                    baseClasses.push(cls);
                }
            }
        }

        // Output order: base classes -> type aliases -> dependent classes
        if (baseClasses.length > 0) {
            sections.push(this.generateClasses(baseClasses));
            sections.push('');
        }

        // Type aliases
        if (defs.typeAliases && defs.typeAliases.length > 0) {
            sections.push(this.generateTypeAliases(defs.typeAliases));
            sections.push('');
        }

        // Dependent classes (those that use type aliases)
        if (dependentClasses.length > 0) {
            sections.push(this.generateClasses(dependentClasses));
            sections.push('');
        }

        // Global variables
        if (defs.globalVariables && defs.globalVariables.length > 0) {
            sections.push(this.generateGlobalVariables(defs.globalVariables));
        }

        // Global functions
        if (defs.globalFunctions && defs.globalFunctions.length > 0) {
            sections.push(this.generateGlobalFunctions(defs.globalFunctions));
        }

        // Modules
        if (defs.modules && defs.modules.length > 0) {
            sections.push(this.generateModules(defs.modules));
        }

        // Constants
        if (defs.constants && defs.constants.length > 0) {
            sections.push(this.generateConstants(defs.constants));
        }

        return sections.join('\n');
    }

    /**
     * Check if a class uses any type aliases in its methods or properties
     */
    private classUsesTypeAliases(cls: ClassDeclaration): boolean {
        // Check if any method parameter or return type references a type alias
        if (cls.methods) {
            for (const method of cls.methods) {
                if (this.typeRefUsesAlias(method.returnType)) {
                    return true;
                }
                if (method.parameters) {
                    for (const param of method.parameters) {
                        if (param.type && this.typeRefUsesAlias(param.type)) {
                            return true;
                        }
                    }
                }
            }
        }
        // Check properties too
        if (cls.properties) {
            for (const prop of cls.properties) {
                if (this.typeRefUsesAlias(prop.type)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Check if a type reference uses any type alias
     */
    private typeRefUsesAlias(ref: TypeReference): boolean {
        if (typeof ref === 'string') {
            return this.typeAliasNames.has(ref);
        }
        if (ref && typeof ref === 'object') {
            const typeDef = ref as TypeDefinition;
            // Check nested types
            if (typeDef.kind === 'union' || typeDef.kind === 'intersection') {
                const unionOrIntersection = typeDef as UnionType | IntersectionType;
                return unionOrIntersection.types?.some((t: TypeReference) => this.typeRefUsesAlias(t)) ?? false;
            }
            if (typeDef.kind === 'array') {
                return this.typeRefUsesAlias((typeDef as ArrayType).elementType);
            }
            if (typeDef.kind === 'reference') {
                return this.typeAliasNames.has((typeDef as ReferenceType).name);
            }
        }
        return false;
    }

    /**
     * Generate type alias definitions
     */
    private generateTypeAliases(aliases: TypeAlias[]): string {
        return aliases.map(alias => {
            const typeDef = this.generateTypeDefinition(alias.definition, alias.name);
            return `type ${alias.name} = ${typeDef}`;
        }).join('\n');
    }

    /**
     * Generate type definition (recursive)
     */
    private generateTypeDefinition(def: TypeDefinition, typeName?: string): string {
        switch (def.kind) {
            case 'union':
                return this.generateUnionType(def);
            case 'array':
                return this.generateArrayType(def);
            case 'table':
                return this.generateTableType(def, typeName);
            case 'function':
                return this.generateFunctionType(def);
            case 'intersection':
                return this.generateIntersectionType(def);
            case 'literal-union':
                return this.generateLiteralUnionType(def);
            case 'reference':
                return this.generateReferenceType(def);
            case 'callable-table':
                return this.generateCallableTableType(def);
            case 'typeof':
                return this.generateTypeofType(def);
            default:
                throw new Error(`Unknown type definition kind: ${(def as any).kind}`);
        }
    }

    /**
     * Generate type reference (string or nested definition)
     */
    private generateTypeReference(ref: TypeReference): string {
        if (typeof ref === 'string') {
            return ref;
        }
        return this.generateTypeDefinition(ref);
    }

    /**
     * Generate union type (e.g., boolean | number)
     */
    private generateUnionType(type: UnionType): string {
        return type.types.map(t => this.generateTypeReference(t)).join(' | ');
    }

    /**
     * Generate array type (e.g., {string})
     */
    private generateArrayType(type: ArrayType): string {
        const elementType = this.generateTypeReference(type.elementType);
        return `{${elementType}}`;
    }

    /**
     * Generate table type with properties and methods
     */
    private generateTableType(type: TableType, typeName?: string): string {
        const lines: string[] = ['{'];

        // Properties
        if (type.properties && type.properties.length > 0) {
            for (const prop of type.properties) {
                const propType = this.generateTypeReference(prop.type);
                const optionalType = prop.optional ? this.makeTypeOptional(propType) : propType;
                lines.push(`${this.indent}${prop.name}: ${optionalType},`);
            }
        }

        // Methods
        if (type.methods && type.methods.length > 0) {
            for (const method of type.methods) {
                const signature = this.generateFunctionSignature(method, true, typeName);
                lines.push(`${this.indent}${method.name}: ${signature},`);
            }
        }

        lines.push('}');
        return lines.join('\n');
    }

    /**
     * Generate function type (e.g., (x: number) -> string)
     */
    private generateFunctionType(type: FunctionType): string {
        const params = this.generateParameterList(type.parameters);
        const returnType = this.generateTypeReference(type.returnType);
        return `(${params}) -> ${returnType}`;
    }

    /**
     * Generate intersection type (e.g., function overloads)
     */
    private generateIntersectionType(type: IntersectionType): string {
        return type.types.map(t => this.generateFunctionType(t)).join(' & ');
    }

    /**
     * Generate literal union type (e.g., "value1" | "value2")
     */
    private generateLiteralUnionType(type: LiteralUnionType): string {
        if (type.values.length === 0) {
            return 'never'; // Empty literal union
        }
        return type.values.map(v => `"${v}"`).join(' | ');
    }

    /**
     * Generate reference type
     */
    private generateReferenceType(type: ReferenceType): string {
        return type.name;
    }

    /**
     * Generate callable table type (e.g., ((x, y) -> result) & { ... })
     */
    private generateCallableTableType(type: CallableTableType): string {
        // Call signature comes first
        const params = this.generateParameterList(type.callSignature.parameters);
        const returnType = this.generateTypeReference(type.callSignature.returnType);
        const callSig = `((${params}) -> ${returnType})`;

        const lines: string[] = ['{'];

        // Table properties
        if (type.tableType.properties && type.tableType.properties.length > 0) {
            for (const prop of type.tableType.properties) {
                const propType = this.generateTypeReference(prop.type);
                const optionalType = prop.optional ? this.makeTypeOptional(propType) : propType;
                lines.push(`${this.indent}${prop.name}: ${optionalType},`);
            }
        }

        lines.push('}');
        
        return `${callSig} & ${lines.join('\n')}`;
    }

    /**
     * Generate typeof type (e.g., typeof(quaternion))
     */
    private generateTypeofType(type: TypeofType): string {
        return `typeof(${type.target})`;
    }

    /**
     * Generate parameter list for functions
     */
    private generateParameterList(params: Parameter[], selfTypeName?: string): string {
        return params.map(param => {
            // Variadic parameter
            if (param.variadic) {
                return `...${this.generateTypeReference(param.type!)}`;
            }

            // Self parameter
            if (param.name === 'self' && !param.type) {
                // If we have a type name context, use it for the self parameter
                if (selfTypeName) {
                    return `self: ${selfTypeName}`;
                }
                return 'self';
            }

            // Parameter with type but no name (anonymous)
            if (!param.name && param.type) {
                return this.generateTypeReference(param.type);
            }

            // Regular parameter with name and type
            const type = this.generateTypeReference(param.type!);
            const optionalType = param.optional ? this.makeTypeOptional(type) : type;
            return `${param.name}: ${optionalType}`;
        }).join(', ');
    }

    /**
     * Make a type optional by appending ?, wrapping complex types in parentheses if needed
     */
    private makeTypeOptional(type: string): string {
        // Complex types (containing ->, |, &) need to be wrapped in parentheses
        if (type.includes('->') || type.includes(' | ') || type.includes(' & ')) {
            return `(${type})?`;
        }
        return `${type}?`;
    }

    /**
     * Generate function signature (used for methods and overloads)
     */
    private generateFunctionSignature(func: FunctionSignature, includeOverloads: boolean = true, selfTypeName?: string): string {
        const params = this.generateParameterList(func.parameters, selfTypeName);
        const returnType = this.generateTypeReference(func.returnType);

        // For intersection types (overloaded methods in table types)
        if (includeOverloads && func.overloads && func.overloads.length > 0) {
            const signatures: string[] = [];
            signatures.push(`(${params}) -> ${returnType}`);

            for (const overload of func.overloads) {
                const overloadParams = this.generateParameterList(overload.parameters, selfTypeName);
                const overloadReturn = this.generateTypeReference(overload.returnType);
                signatures.push(`(${overloadParams}) -> ${overloadReturn}`);
            }

            return `(${signatures.join(') & (')})`;
        }

        return `(${params}) -> ${returnType}`;
    }

    /**
     * Generate class declarations
     */
    private generateClasses(classes: ClassDeclaration[]): string {
        return classes.map(cls => {
            const lines: string[] = [];
            lines.push(`declare class ${cls.name}`);

            // Properties
            if (cls.properties && cls.properties.length > 0) {
                for (const prop of cls.properties) {
                    const propType = this.generateTypeReference(prop.type);
                    lines.push(`${this.indent}${prop.name}: ${propType}`);
                }
            }

            // Methods
            if (cls.methods && cls.methods.length > 0) {
                for (const method of cls.methods) {
                    const params = this.generateParameterList(method.parameters);
                    const returnType = this.generateTypeReference(method.returnType);

                    // Main signature
                    lines.push(`${this.indent}function ${method.name}(${params}): ${returnType}`);

                    // Overloads
                    if (method.overloads && method.overloads.length > 0) {
                        for (const overload of method.overloads) {
                            const overloadParams = this.generateParameterList(overload.parameters);
                            const overloadReturn = this.generateTypeReference(overload.returnType);
                            lines.push(`${this.indent}function ${method.name}(${overloadParams}): ${overloadReturn}`);
                        }
                    }
                }
            }

            lines.push('end');
            lines.push('');
            return lines.join('\n');
        }).join('\n');
    }

    /**
     * Generate global variable declarations
     */
    private generateGlobalVariables(vars: GlobalVariable[]): string {
        return vars.map(v => {
            const varType = this.generateTypeReference(v.type);
            return `declare ${v.name}: ${varType}`;
        }).join('\n');
    }

    /**
     * Generate global function declarations
     */
    private generateGlobalFunctions(funcs: GlobalFunction[]): string {
        return funcs.map(func => {
            const params = this.generateParameterList(func.parameters);
            const returnType = this.generateTypeReference(func.returnType);

            const lines: string[] = [];
            lines.push(`declare function ${func.name}(${params}): ${returnType}`);

            // Overloads
            if (func.overloads && func.overloads.length > 0) {
                for (const overload of func.overloads) {
                    const overloadParams = this.generateParameterList(overload.parameters);
                    const overloadReturn = this.generateTypeReference(overload.returnType);
                    lines.push(`declare function ${func.name}(${overloadParams}): ${overloadReturn}`);
                }
            }

            return lines.join('\n');
        }).join('\n');
    }

    /**
     * Generate module declarations
     */
    private generateModules(modules: ModuleDeclaration[]): string {
        return modules.map(mod => {
            const lines: string[] = [];
            lines.push('');
            lines.push('---------------------------');
            lines.push(`-- Global Table: ${mod.name}`);
            lines.push('---------------------------');
            lines.push('');
            lines.push(`declare ${mod.name}: {`);

            // Properties
            if (mod.properties && mod.properties.length > 0) {
                for (const prop of mod.properties) {
                    const propType = this.generateTypeReference(prop.type);
                    lines.push(`${this.indent}${prop.name}: ${propType},`);
                }
            }

            // Functions
            if (mod.functions && mod.functions.length > 0) {
                for (const func of mod.functions) {
                    const params = this.generateParameterList(func.parameters);
                    const returnType = this.generateTypeReference(func.returnType);

                    // Check if function has overloads - if so, use intersection type
                    if (func.overloads && func.overloads.length > 0) {
                        const signatures: string[] = [];
                        signatures.push(`((${params}) -> ${returnType})`);

                        for (const overload of func.overloads) {
                            const overloadParams = this.generateParameterList(overload.parameters);
                            const overloadReturn = this.generateTypeReference(overload.returnType);
                            signatures.push(`((${overloadParams}) -> ${overloadReturn})`);
                        }

                        lines.push(`${this.indent}${func.name}: ${signatures.join(' & ')},`);
                    } else {
                        lines.push(`${this.indent}${func.name}: (${params}) -> ${returnType},`);
                    }
                }
            }

            lines.push('}');
            lines.push('');
            return lines.join('\n');
        }).join('\n');
    }

    /**
     * Generate constant declarations
     */
    private generateConstants(constants: ConstantDeclaration[]): string {
        return constants.map(c => {
            const constType = this.generateTypeReference(c.type);
            return `declare ${c.name}: ${constType}`;
        }).join('\n');
    }
}
