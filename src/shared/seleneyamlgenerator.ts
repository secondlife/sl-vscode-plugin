import {
    LuaTypeDefinitions,
    ClassDeclaration,
    GlobalVariable,
    ModuleDeclaration,
    ConstantDeclaration,
    TypeDefinition,
    TypeReference,
    Parameter,
    FunctionSignature,
} from './luadefsinterface';

/**
 * Generates Selene YAML configuration files from Lua type definitions
 */
export class SeleneYamlGenerator {
    private indent = '  ';

    /**
     * Generate complete Selene YAML file
     */
    generate(defs: LuaTypeDefinitions, config: SeleneConfig): string {
        const lines: string[] = [];
        const globalNames = new Set<string>(); // Track global names to avoid duplicates

        // Header
        lines.push(`base: ${config.base || 'roblox'}`);
        lines.push('lua_version:');
        for (const version of config.luaVersions || ['roblox', '5.1']) {
            lines.push(`${this.indent}- ${version}`);
        }
        lines.push(`name: ${config.name || 'SLua LSL language support'}`);
        lines.push(`version: ${config.version || defs.version}`);

        // Modules section
        if (defs.modules && defs.modules.length > 0) {
            lines.push('modules:');
            for (const module of defs.modules) {
                lines.push(`${this.indent}${module.name}:`);
                if (module.comment) {
                    lines.push(`${this.indent}${this.indent}description: ${this.escapeYamlString(module.comment)}`);
                }
            }
        }

        // Globals section
        lines.push('globals:');

        // Add constants
        if (defs.constants && defs.constants.length > 0) {
            for (const constant of defs.constants) {
                this.generateConstant(constant, lines, globalNames);
            }
        }

        // Add global variables
        if (defs.globalVariables && defs.globalVariables.length > 0) {
            for (const globalVar of defs.globalVariables) {
                this.generateGlobalVariable(globalVar, lines, globalNames);
            }
        }

        // Add global functions
        if (defs.globalFunctions && defs.globalFunctions.length > 0) {
            for (const func of defs.globalFunctions) {
                this.generateGlobalFunction(func, lines, globalNames);
            }
        }

        // Add classes as globals (skip if name already used by function)
        if (defs.classes && defs.classes.length > 0) {
            for (const cls of defs.classes) {
                if (!globalNames.has(cls.name)) {
                    this.generateClassAsGlobal(cls, lines, globalNames);
                }
            }
        }

        // Add module properties and functions as globals
        if (defs.modules && defs.modules.length > 0) {
            for (const module of defs.modules) {
                this.generateModuleGlobals(module, lines, globalNames);
            }
        }

        return lines.join('\n');
    }

    /**
     * Generate constant declaration
     */
    private generateConstant(constant: ConstantDeclaration, lines: string[], globalNames: Set<string>): void {
        globalNames.add(constant.name);
        lines.push(`${this.indent}${constant.name}:`);
        lines.push(`${this.indent}${this.indent}type: ${this.generateTypeReference(constant.type)}`);
        if (constant.comment) {
            lines.push(`${this.indent}${this.indent}description: ${this.escapeYamlString(constant.comment)}`);
        }
    }

    /**
     * Generate global variable declaration
     */
    private generateGlobalVariable(globalVar: GlobalVariable, lines: string[], globalNames: Set<string>): void {
        globalNames.add(globalVar.name);
        lines.push(`${this.indent}${globalVar.name}:`);
        lines.push(`${this.indent}${this.indent}type: ${this.generateTypeReference(globalVar.type)}`);
        if (globalVar.comment) {
            lines.push(`${this.indent}${this.indent}description: ${this.escapeYamlString(globalVar.comment)}`);
        }
    }

    /**
     * Generate global function declaration
     */
    private generateGlobalFunction(func: FunctionSignature, lines: string[], globalNames: Set<string>): void {
        globalNames.add(func.name);
        lines.push(`${this.indent}${func.name}:`);

        // If function has overloads, generate as any type with description
        if (func.overloads && func.overloads.length > 0) {
            lines.push(`${this.indent}${this.indent}type: any`);
            if (func.comment) {
                lines.push(`${this.indent}${this.indent}description: ${this.escapeYamlString(func.comment)}`);
            }
        } else {
            // Generate function type
            const funcType = this.generateFunctionSignature(func);
            lines.push(`${this.indent}${this.indent}type: ${funcType}`);
            if (func.comment) {
                lines.push(`${this.indent}${this.indent}description: ${this.escapeYamlString(func.comment)}`);
            }
        }
    }

    /**
     * Generate class as a global constructor
     */
    private generateClassAsGlobal(cls: ClassDeclaration, lines: string[], globalNames: Set<string>): void {
        globalNames.add(cls.name);
        lines.push(`${this.indent}${cls.name}:`);
        lines.push(`${this.indent}${this.indent}type: any`);
        if (cls.comment) {
            lines.push(`${this.indent}${this.indent}description: ${this.escapeYamlString(cls.comment)}`);
        }
    }

    /**
     * Generate module properties and functions as globals with module prefix
     */
    private generateModuleGlobals(module: ModuleDeclaration, lines: string[], globalNames: Set<string>): void {
        // Add module properties
        if (module.properties) {
            for (const prop of module.properties) {
                const globalName = `${module.name}.${prop.name}`;
                globalNames.add(globalName);
                lines.push(`${this.indent}${globalName}:`);
                lines.push(`${this.indent}${this.indent}type: ${this.generateTypeReference(prop.type)}`);
                if (prop.comment) {
                    lines.push(`${this.indent}${this.indent}description: ${this.escapeYamlString(prop.comment)}`);
                }
            }
        }

        // Add module functions
        if (module.functions) {
            for (const func of module.functions) {
                const globalName = `${module.name}.${func.name}`;
                globalNames.add(globalName);
                lines.push(`${this.indent}${globalName}:`);

                // If function has overloads, use any type
                if (func.overloads && func.overloads.length > 0) {
                    lines.push(`${this.indent}${this.indent}type: any`);
                } else {
                    const funcType = this.generateFunctionSignature(func);
                    lines.push(`${this.indent}${this.indent}type: ${funcType}`);
                }

                if (func.comment) {
                    lines.push(`${this.indent}${this.indent}description: ${this.escapeYamlString(func.comment)}`);
                }
            }
        }
    }

    /**
     * Generate function signature in Selene format
     */
    private generateFunctionSignature(func: FunctionSignature): string {
        const params = func.parameters.map(p => this.generateParameterType(p)).join(', ');
        const returnType = this.generateTypeReference(func.returnType);
        return `function(${params}): ${returnType}`;
    }

    /**
     * Generate parameter type
     */
    private generateParameterType(param: Parameter): string {
        if (param.variadic) {
            return `...${this.generateTypeReference(param.type!)}`;
        }
        return this.generateTypeReference(param.type || 'any');
    }

    /**
     * Generate type reference (recursive)
     */
    private generateTypeReference(ref: TypeReference): string {
        if (typeof ref === 'string') {
            return this.mapTypeName(ref);
        }
        return this.generateTypeDefinition(ref);
    }

    /**
     * Generate type definition (recursive)
     */
    private generateTypeDefinition(def: TypeDefinition): string {
        switch (def.kind) {
            case 'union':
                // Selene doesn't support union types well, use any
                return 'any';

            case 'array':
                // Selene uses table for arrays
                return 'table';

            case 'table':
                return 'table';

            case 'function': {
                const params = def.parameters.map(p => this.generateParameterType(p)).join(', ');
                const returnType = this.generateTypeReference(def.returnType);
                return `function(${params}): ${returnType}`;
            }

            case 'intersection':
                // Intersection types (overloads) - use any
                return 'any';

            case 'literal-union':
                // Literal unions - use string
                return 'string';

            case 'reference':
                return this.mapTypeName(def.name);

            default:
                return 'any';
        }
    }

    /**
     * Map type names to Selene equivalents
     */
    private mapTypeName(name: string): string {
        const typeMap: { [key: string]: string } = {
            'boolean': 'bool',
            'number': 'number',
            'string': 'string',
            'vector': 'any',
            'quaternion': 'any',
            'uuid': 'any',
            'buffer': 'any',
            '()': 'nil',
            'nil': 'nil',
            'any': 'any',
            'list': 'table',
            '{': 'table'
        };

        return typeMap[name] || 'any';
    }

    /**
     * Escape YAML string values
     */
    private escapeYamlString(str: string): string {
        // If string contains special characters, quote it
        if (str.includes(':') || str.includes('#') || str.includes('\n') || str.includes('"')) {
            // Use double quotes and escape internal quotes
            return `"${str.replace(/"/g, '\\"')}"`;
        }
        return str;
    }
}

/**
 * Configuration for Selene YAML generation
 */
export interface SeleneConfig {
    base?: string;
    luaVersions?: string[];
    name?: string;
    version?: string;
}
