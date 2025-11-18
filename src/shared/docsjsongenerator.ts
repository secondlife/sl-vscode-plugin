import {
    LuaTypeDefinitions,
    GlobalFunction,
    ModuleDeclaration,
    FunctionSignature,
    ModuleProperty,
    ConstantDeclaration
} from './luadefsinterface';

/**
 * Documentation entry from docs.json file
 */
interface DocEntry {
    documentation: string;
    summary?: string;
    learn_more_link?: string;
    tags?: string[];
}

/**
 * Parsed documentation database
 */
interface DocDatabase {
    [key: string]: DocEntry;
}

/**
 * Generates docs.json file from Lua type definitions
 */
export class DocsJsonGenerator {
    /**
     * Generate complete docs.json file
     */
    generate(defs: LuaTypeDefinitions): string {
        const docs: DocDatabase = {};

        // Add global functions
        if (defs.globalFunctions && defs.globalFunctions.length > 0) {
            for (const func of defs.globalFunctions) {
                this.addGlobalFunction(func, docs);
            }
        }

        // Add modules and their members
        if (defs.modules && defs.modules.length > 0) {
            for (const module of defs.modules) {
                this.addModule(module, docs);
            }
        }

        // Add constants
        if (defs.constants && defs.constants.length > 0) {
            for (const constant of defs.constants) {
                this.addConstant(constant, docs);
            }
        }

        return JSON.stringify(docs, null, 4);
    }

    /**
     * Add global function documentation
     */
    private addGlobalFunction(func: GlobalFunction, docs: DocDatabase): void {
        const key = `@roblox/global/${func.name}`;

        const entry: DocEntry = {
            documentation: this.formatDocumentation(func.comment || `${func.name} function`)
        };

        // Add learn more link if it looks like a wiki reference
        if (func.comment && this.hasWikiReference(func.name)) {
            entry.learn_more_link = this.generateWikiLink(func.name);
        }

        docs[key] = entry;
    }

    /**
     * Add module documentation
     */
    private addModule(module: ModuleDeclaration, docs: DocDatabase): void {
        // Add module itself
        const moduleKey = `@roblox/global/${module.name}`;
        docs[moduleKey] = {
            documentation: module.comment || `${module.name} module`,
            summary: module.comment || `${module.name} module`
        };

        if (this.hasWikiReference(module.name)) {
            docs[moduleKey].learn_more_link = this.generateWikiLink(module.name);
        }

        // Add module properties
        if (module.properties) {
            for (const prop of module.properties) {
                this.addModuleProperty(module.name, prop, docs);
            }
        }

        // Add module functions
        if (module.functions) {
            for (const func of module.functions) {
                this.addModuleFunction(module.name, func, docs);
            }
        }
    }

    /**
     * Add module property documentation
     */
    private addModuleProperty(moduleName: string, prop: ModuleProperty, docs: DocDatabase): void {
        const key = `@roblox/global/${moduleName}.${prop.name}`;

        const entry: DocEntry = {
            documentation: this.formatDocumentation(prop.comment || `${moduleName}.${prop.name} property`)
        };

        const fullName = `${moduleName}.${prop.name}`;
        if (this.hasWikiReference(fullName)) {
            entry.learn_more_link = this.generateWikiLink(fullName);
        }

        docs[key] = entry;
    }

    /**
     * Add module function documentation
     */
    private addModuleFunction(moduleName: string, func: FunctionSignature, docs: DocDatabase): void {
        const key = `@roblox/global/${moduleName}.${func.name}`;

        const entry: DocEntry = {
            documentation: this.formatDocumentation(func.comment || `${moduleName}.${func.name} function`)
        };

        // Generate wiki link for ll.* functions
        if (moduleName === 'll') {
            entry.learn_more_link = `https://wiki.secondlife.com/wiki/ll${func.name}`;
        }

        docs[key] = entry;
    }

    /**
     * Add constant documentation
     */
    private addConstant(constant: ConstantDeclaration, docs: DocDatabase): void {
        const key = `@roblox/global/${constant.name}`;

        const entry: DocEntry = {
            documentation: this.formatDocumentation(constant.comment || `${constant.name} constant`)
        };

        if (this.hasWikiReference(constant.name)) {
            entry.learn_more_link = this.generateWikiLink(constant.name);
        }

        docs[key] = entry;
    }

    /**
     * Format documentation text
     */
    private formatDocumentation(text: string): string {
        // Convert newlines to \\n for JSON
        return text.replace(/\n/g, '\\n');
    }

    /**
     * Check if name might have a wiki reference
     */
    private hasWikiReference(name: string): boolean {
        // Common Second Life/LSL items that have wiki pages
        const wikiPatterns = [
            /^ll\./,  // ll.* functions
            /^(uuid|vector|quaternion|integer)$/i,  // LSL types
            /^to(vector|quaternion)$/i,  // Conversion functions
            /^(bit32|lljson|llbase64)$/  // Standard libraries
        ];

        return wikiPatterns.some(pattern => pattern.test(name));
    }

    /**
     * Generate wiki link for a name
     */
    private generateWikiLink(name: string): string {
        // Handle different naming conventions
        if (name.startsWith('ll.')) {
            // ll.FunctionName -> https://wiki.secondlife.com/wiki/llFunctionName
            return `https://wiki.secondlife.com/wiki/ll${name.slice(3)}`;
        }

        if (name === 'uuid' || name === 'vector' || name === 'quaternion' || name === 'integer') {
            return `https://wiki.secondlife.com/wiki/${name}`;
        }

        if (name === 'toquaternion' || name === 'tovector') {
            return `https://wiki.secondlife.com/wiki/${name}`;
        }

        // Default pattern
        return `https://wiki.secondlife.com/wiki/${name}`;
    }
}
