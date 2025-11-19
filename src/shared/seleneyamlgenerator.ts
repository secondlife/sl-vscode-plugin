import {
    ClassDeclaration,
    ClassProperty,
    ConstantDeclaration,
    FunctionSignature,
    GlobalFunction,
    GlobalVariable,
    LuaTypeDefinitions,
    ModuleDeclaration,
    Parameter,
    TableProperty,
    TypeAlias,
    TypeDefinition,
    TypeReference,
    UnionType,
} from "./luadefsinterface";

import { dump } from "js-yaml";

/**
 * Generates Selene YAML configuration files from Lua type definitions
 */
export class SeleneYamlGenerator {
    /**
     * Generate complete Selene YAML file
     */
    generate(defs: LuaTypeDefinitions, config: SeleneConfig): string {
        const builder = new SeleneYamlBuilder(defs, config);

        return dump(builder.build());
    }
}

class SeleneYamlBuilder {
    //private defs: LuaTypeDefinitions;
    private pendingStructTypeAliases: { [k: string]: TypeAlias } = {};
    private pendingStructClasses: { [k: string]: ClassDeclaration } = {};
    private config: SeleneConfig;

    // private version: string;
    private typeAliases: TypeAlias[];
    private classes: ClassDeclaration[];
    private globalVariables: GlobalVariable[];
    private globalFunctions: GlobalFunction[];
    private modules: ModuleDeclaration[];
    private constants: ConstantDeclaration[];

    private globalNames = new Set<string>();

    private yaml: SeleneYaml = {
        base: "",
        name: "",
        lua_versions: [],
        last_updated: 0,
        //modules: {},
        globals: {
            getfenv: {
                removed: true,
            },
            setfenv: {
                removed: true,
            },
            loadstring: {
                removed: true,
            },
        },
    };

    constructor(defs: LuaTypeDefinitions, config: SeleneConfig) {
        // this.version = defs.version;
        this.typeAliases = defs.typeAliases ?? [];
        this.classes = defs.classes ?? [];
        this.globalFunctions = defs.globalFunctions ?? [];
        this.globalVariables = defs.globalVariables ?? [];
        this.modules = defs.modules ?? [];
        this.constants = defs.constants ?? [];
        this.config = config;
    }

    build(): SeleneYaml {
        const selene = this.yaml;

        // Header
        selene.base = `${this.config.base || "luau"}`;
        selene.name = `${this.config.name || "SLua LSL language support"}`;
        selene.last_updated = 1763572449; // Todo : this should come from the xml spec
        for (const version of this.config.luaVersions || ["luau", "lua51"]) {
            selene.lua_versions.push(version);
        }

        // Globals section

        // Add constants
        for (const constant of this.constants) {
            const seleneConstant = this.generateConstant(constant);
            if (seleneConstant) {
                selene.globals[constant.name] = seleneConstant;
            }
        }

        // Add global variables
        for (const globalVar of this.globalVariables) {
            const selenGlobalVar = this.generateGlobalVariable(globalVar);
            if (selenGlobalVar) {
                selene.globals[globalVar.name] = selenGlobalVar;
            }
        }

        // Add global functions
        for (const func of this.globalFunctions ?? []) {
            selene.globals[func.name] = this
                .generateSeleneFunctionFromFunctionSignature(func);
        }

        for (const cls of this.classes) {
            if (this.globalNames.has(cls.name)) continue;
            const prop: SeleneAnyDef = {
                any: true,
            };
            if (cls.comment) {
                prop.description = cls.comment;
            }
            selene.globals[cls.name] = prop; // TODO handle better
        }

        // Add structs depended on by globals
        const structs = this.generatePendingStructs();
        if (Object.values(structs).length) {
            selene.structs = structs;
        }

        // Add module properties and functions as globals
        for (const module of this.modules) {
            this.generateModuleGlobals(module);
        }

        return selene;
    }

    /**
     * Generate constant declaration
     */
    private generateConstant(
        constant: ConstantDeclaration,
    ): SelenePropDef | null {
        this.globalNames.add(constant.name);
        if (typeof constant.type != "string") return null;
        const seleneConstant: SelenePropDef = {
            property: "read-only",
            type: this.mapTypeName(constant.type) || "any",
        };
        if (constant.comment) {
            seleneConstant.description = constant.comment;
        }
        return seleneConstant;
    }

    /**
     * Generate global variable declaration
     */
    private generateGlobalVariable(
        globalVar: GlobalVariable,
    ): SelenePropDef | SeleneStructDef {
        this.globalNames.add(globalVar.name);

        const struct = this.generateStructFromTypeReferenceString(
            globalVar.type,
        );
        if (struct) {
            if (globalVar.comment) {
                struct.description = globalVar.comment;
            }
            return struct;
        }

        const seleneGlobalVar: SelenePropDef = {
            // type: this.generateTypeReference(globalVar.type),
            type: "any",
        };
        if (globalVar.comment) {
            seleneGlobalVar.description = globalVar.comment;
        }
        return seleneGlobalVar;
    }

    /**
     * Generate global function declaration
     */
    private generateSeleneFunctionFromFunctionSignature(
        func: FunctionSignature,
        expand: boolean = false,
    ): SeleneFuncDef {
        this.globalNames.add(func.name);
        // If function has overloads, generate as any type with description
        const overloads = func.overloads ?? [];
        if (overloads.length > 0) {
            const prop: SeleneFuncDef = {
                args: [],
                // must_use: true, // TODO : this needs to come from the xml spec
            };
            if (func.comment) {
                prop.description = `OVERLOAD: ${func.comment}`;
            }

            const args: { type: SeleneArgDefType; count: number }[] = [];
            const paramSets = overloads.map((overload) => overload.parameters);
            paramSets.push(func.parameters);
            for (const params of paramSets) {
                for (const i in params) {
                    const type =
                        this.generateFunctionArg(params[i], expand).type;
                    if (args[i]) {
                        const arg = args[i];
                        if (!argTypesEqual(type, arg.type)) {
                            arg.type = "any";
                        }
                        arg.count += 1;
                    } else args[i] = { type, count: 1 };
                }
            }
            if (args.length) {
                const max = args[0].count;
                for (const arg of args) {
                    if (arg.count == max) prop.args.push({ type: arg.type });
                    else prop.args.push({ type: arg.type, required: false });
                }
            }
            return prop;
        } else {
            const seleneFunc: SeleneFuncDef = {
                // must_use: true, // TODO : this needs to come from the xml spec
                args: this.generateFunctionArgs(func, expand),
            };
            if (func.comment) {
                seleneFunc.description = func.comment;
            }

            return seleneFunc;
        }
    }

    private generateFunctionArgs(
        func: FunctionSignature,
        expand: boolean = false,
    ): SeleneArgDef[] {
        const args: SeleneArgDef[] = [];
        for (const param of func.parameters) {
            const arg = this.generateFunctionArg(param, expand);
            args.push(arg);
        }

        return args;
    }

    private generateFunctionArg(
        param: Parameter,
        expand: boolean = false,
    ): SeleneArgDef {
        let type = param.type ? param.type : "any";
        let required = param.optional ? false : true;
        if (typeof type === "string") {
            if (type.endsWith("?")) {
                required = false;
                type = type.substring(0, type.length - 1);
            }
        }
        const arg: SeleneArgDef = {
            type: param.variadic
                ? "..."
                : this.generateSeleneTypeFromTypeReference(type, expand),
        };
        if (!required) {
            arg.required = false;
        }
        return arg;
    }

    private generatePendingStructs(): SeleneStructs {
        const structs: SeleneStructs = {};
        let generated = true;
        const done = new Set<string>();
        while (generated) {
            generated = false;
            for (const name in this.pendingStructClasses) {
                if (done.has(name)) continue;
                const cls = this.pendingStructClasses[name];
                generated = true;
                done.add(name);
                structs[name] = this.generateStructFromMethodsAndProps(
                    cls.methods ?? [],
                    cls.properties ?? [],
                );
            }

            for (const name in this.pendingStructTypeAliases) {
                if (done.has(name)) continue;
                const typeAlias = this.pendingStructTypeAliases[name];
                if (typeAlias.definition.kind !== "table") continue;
                generated = true;
                done.add(name);
                structs[name] = this.generateStructFromMethodsAndProps(
                    typeAlias.definition.methods ?? [],
                    typeAlias.definition.properties ?? [],
                );
            }
        }

        return structs;
    }

    private generateStructFromMethodsAndProps(
        methods: FunctionSignature[],
        properties: ClassProperty[] | TableProperty[],
    ): SeleneStruct {
        const struct: SeleneStruct = {};

        for (const func of methods) {
            const sFunc = this.generateSeleneFunctionFromFunctionSignature(
                func,
                true,
            );
            const method: SeleneStructFunc = {
                method: true,
                ...sFunc,
            };
            struct[func.name] = method;
        }

        for (const prop of properties) {
            struct[prop.name] = {
                property: "read-only",
                type: this.mapTypeName(prop.type) || "any",
            };
        }

        return struct;
    }

    /**
     * Generate module properties and functions as globals with module prefix
     */
    private generateModuleGlobals(module: ModuleDeclaration): void {
        // Add module properties
        if (module.properties) {
            for (const prop of module.properties) {
                const globalName = `${module.name}.${prop.name}`;
                this.globalNames.add(globalName);
                const seleneProp: SelenePropDef = {
                    type: this.generateSelenerPropTypeFromTypeReference(
                        prop.type,
                    ),
                };
                if (prop.comment) {
                    seleneProp.description = prop.comment;
                }
            }
        }

        // Add module functions
        if (module.functions) {
            for (const func of module.functions) {
                const globalName = `${module.name}.${func.name}`;
                this.globalNames.add(globalName);
                this.yaml.globals[globalName] = this
                    .generateSeleneFunctionFromFunctionSignature(func);
            }
        }
    }

    private generateSeleneTypeFromTypeReference(
        ref: TypeReference,
        expand: boolean = false,
    ): SeleneArgDefType {
        if (typeof ref === "string") {
            const type = this.mapTypeName(ref);
            if (type) return type;
            const struct = this.generateStructFromTypeReferenceString(ref);
            if (struct) {
                if (expand) return this.tryExpandTypeReference(ref);
                return { display: struct.struct };
            }
            return "any"; // TODO Handle this better;
        }
        switch (ref.kind) {
        }
        switch (ref.kind) {
            case "function":
                return "function";
            case "union": {
                if (expand) {
                    return this.expandUnionTypeReferenceForLiterals(ref);
                }
                return "any";
            }
            case "literal-union":
                return ref.values;
            default:
                return "any"; // TODO handle this better
        }
    }

    private expandUnionTypeReferenceForLiterals(
        ref: UnionType,
    ): SeleneArgDefType {
        let lietrals: string[][] = [];
        let unions: UnionType[] = [ref];
        const done = new Set<string>();
        while (unions.length) {
            let newUnions: UnionType[] = [];
            for (const type of ref.types) {
                const typeRef = typeof type === "string"
                    ? this.getTypeAliasForReference(type)?.definition
                    : type;
                if (!typeRef) return "any";
                if (typeRef.kind == "union") {
                    if (typeof type === "string") {
                        if (done.has(type)) continue; // No circular references please
                        done.add(type);
                    }
                    newUnions.push(typeRef);
                } else if (typeRef.kind == "literal-union") {
                    lietrals.push(typeRef.values);
                } else return "any"; // We have found a non union non literal-union so we can't expand this
            }
            unions = newUnions;
        }
        return lietrals.flat();
    }

    private tryExpandTypeReference(ref: string): SeleneArgDefType {
        const typeAlias = this.getTypeAliasForReference(ref);
        if (typeAlias) {
            return this.generateSeleneTypeFromTypeReference(
                typeAlias.definition,
                true,
            );
        }
        const cls = this.getClassForReference(ref);
        if (cls) {
            return { display: cls.name };
        }
        return "any";
    }

    private generateStructFromTypeReferenceString(
        ref: TypeReference,
    ): SeleneStructDef | undefined {
        if (typeof ref !== "string") return undefined;
        const cls = this.getClassForReference(ref);
        if (cls) {
            return { struct: cls.name };
        }
        const tpyeAlias = this.getTypeAliasForReference(ref);
        if (tpyeAlias) {
            return { struct: tpyeAlias.name };
        }
        return undefined;
    }

    private getTypeAliasForReference(ref: string): TypeAlias | undefined {
        const typeAlias = this.typeAliases.find((typeAlias) =>
            typeAlias.name == ref
        );
        if (typeAlias) {
            this.pendingStructTypeAliases[typeAlias.name] = typeAlias;
        }
        return typeAlias;
    }

    private getClassForReference(ref: string): ClassDeclaration | undefined {
        const cls = this.classes.find((cls) => cls.name == ref);
        if (cls) {
            this.pendingStructClasses[cls.name] = cls;
        }
        return cls;
    }

    private generateSelenerPropTypeFromTypeReference(
        ref: TypeReference,
    ): SelenePropType {
        if (typeof ref === "string") {
            return this.mapTypeName(ref) || "any";
        }
        return "any"; // TODO handle this better
    }

    /**
     * Map type names to Selene equivalents
     */
    private mapTypeName(ref: TypeReference): SelenePropType | undefined {
        if (typeof ref !== "string") {
            return "any"; // TODO handle this better
        }
        const typeMap: { [key: string]: SelenePropType } = {
            "boolean": "bool",
            "number": "number",
            "string": "string",
            "vector": { display: "vector" },
            "quaternion": { display: "quaternion" },
            "uuid": { display: "uuid" },
            "buffer": "any",
            "()": "nil",
            "nil": "nil",
            "any": "any",
            "list": { display: "list" },
            "{}": "table",
        };

        return typeMap[ref] ?? undefined;
    }
}

const argTypesEqual = (
    arg1: SeleneArgDefType,
    arg2: SeleneArgDefType,
): boolean => {
    const type1 = typeof arg1;
    const type2 = typeof arg2;
    if (type1 !== type2) return false;
    if (type1 == "string") {
        return arg1 === arg2;
    }
    const array1 = arg1 instanceof Array;
    const array2 = arg2 instanceof Array;
    if (array1 !== array2) return false;
    if (array1 && array2) {
        if (arg1.length != arg2.length) return false;
        const arr1 = [...arg1];
        const arr2 = [...arg2];
        arr1.sort();
        arr2.sort();
        for (const i in arr1) {
            if (arr1[i] !== arr2[i]) return false;
        }
        return true;
    }
    if (type1 == "object" && type2 == "object") {
        return (arg1 as SeleneDisplay).display ==
            (arg2 as SeleneDisplay).display;
    }
    return false;
};

/**
 * Configuration for Selene YAML generation
 */
export interface SeleneConfig {
    base?: string;
    luaVersions?: string[];
    name?: string;
    version?: string;
}

type SeleneDef =
    | SelenePropDef
    | SeleneFuncDef
    | SeleneStructDef
    | SeleneRemovedDef
    | SeleneAnyDef;

type SeleneAnyDef = {
    any: true;
    description?: string;
};

type SelenePropDef = {
    property?: "read-only" | "new-fields" | "override-fields" | "full-write";
    type: SelenePropType;
    description?: string;
};

type SeleneRemovedDef = {
    removed: true;
};

type SeleneStructDef = {
    struct: string;
    description?: string;
};

type SeleneFuncDef = {
    args: SeleneArgDef[];
    must_use?: true;
    description?: string;
};

type SeleneArgDef = {
    required?: boolean;
    observes?: "read" | "write" | "read-write";
    type: SeleneArgDefType;
};

type SelenePropType =
    | "any"
    | "bool"
    | "function"
    | "nil"
    | "number"
    | "string"
    | "table"
    | SeleneDisplay;

type SeleneDisplay = { display: string };

type SeleneArgDefType =
    | SelenePropType
    | "..."
    | string[];

type SeleneStructFunc = {
    args: SeleneArgDef[];
    method: true;
    must_use?: boolean;
    description?: string;
};

type SeleneStructProp = SelenePropDef;

type SeleneStructItem = SeleneStructFunc | SeleneStructProp;

type SeleneStruct = { [k: string]: SeleneStructItem };
type SeleneStructs = { [k: string]: SeleneStruct };

type SeleneYaml = {
    base: string;
    name: string;
    lua_versions: (string | number)[];
    last_updated: number;
    //    modules: SeleneModules;
    globals: SeleneGlobals;
    structs?: SeleneStructs;
};

type SeleneGlobals = { [k: string]: SeleneDef };
//type SeleneModules = { [k: string]: SeleneModule };
// type SeleneModule = {
//     description?: string;
// };
