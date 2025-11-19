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
    ReferenceType
} from './luadefsinterface';

export class LuauDefsGenerator {
    private indent = '  ';

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

        // Type aliases
        if (defs.typeAliases && defs.typeAliases.length > 0) {
            sections.push(this.generateTypeAliases(defs.typeAliases));
            sections.push('');
        }

        // Classes
        if (defs.classes && defs.classes.length > 0) {
            sections.push(this.generateClasses(defs.classes));
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
     * Generate union type (e.g., boolean|number)
     */
    private generateUnionType(type: UnionType): string {
        return type.types.map(t => this.generateTypeReference(t)).join('|');
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
                const optional = prop.optional ? '?' : '';
                lines.push(`${this.indent}${prop.name}${optional} : ${propType},`);
            }
        }

        // Methods
        if (type.methods && type.methods.length > 0) {
            for (const method of type.methods) {
                const signature = this.generateFunctionSignature(method, true, typeName);
                lines.push(`${this.indent}${method.name} : ${signature},`);
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
     * Generate literal union type (e.g., "value1"|"value2")
     */
    private generateLiteralUnionType(type: LiteralUnionType): string {
        return type.values.map(v => `"${v}"`).join('|');
    }

    /**
     * Generate reference type
     */
    private generateReferenceType(type: ReferenceType): string {
        return type.name;
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
            const optional = param.optional ? '?' : '';
            const type = this.generateTypeReference(param.type!);
            return `${param.name}${optional}: ${type}`;
        }).join(', ');
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
            lines.push(`declare extern type ${cls.name} with`);

            // Properties
            if (cls.properties && cls.properties.length > 0) {
                for (const prop of cls.properties) {
                    const propType = this.generateTypeReference(prop.type);
                    lines.push(`${this.indent}${prop.name} : ${propType}`);
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
            return `declare ${v.name} : ${varType}`;
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
            lines.push(`declare function ${func.name} (${params}) : ${returnType}`);

            // Overloads
            if (func.overloads && func.overloads.length > 0) {
                for (const overload of func.overloads) {
                    const overloadParams = this.generateParameterList(overload.parameters);
                    const overloadReturn = this.generateTypeReference(overload.returnType);
                    lines.push(`declare function ${func.name} (${overloadParams}) : ${overloadReturn}`);
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
                    lines.push(`${this.indent}${prop.name} : ${propType},`);
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
                        signatures.push(`(${params}) -> ${returnType}`);

                        for (const overload of func.overloads) {
                            const overloadParams = this.generateParameterList(overload.parameters);
                            const overloadReturn = this.generateTypeReference(overload.returnType);
                            signatures.push(`(${overloadParams}) -> ${overloadReturn}`);
                        }

                        lines.push(`${this.indent}${func.name}: (${signatures.join(') & (')}) ,`);
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
            return `declare ${c.name} : ${constType}`;
        }).join('\n');
    }
}
