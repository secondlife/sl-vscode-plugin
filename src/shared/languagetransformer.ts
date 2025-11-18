/**
 * @file languagetransformer.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import { LSLFunction, LSLKeywords } from './lslkeywords';
import { ConstantDeclaration, FunctionSignature, LiteralUnionType, LuaTypeDefinitions, ModuleDeclaration, Parameter, TableType, TypeAlias } from './luadefsinterface';

export class LanguageTransformer {
    public static processCombinedDefinitions(lslDefs: LSLKeywords, luaDefs: LuaTypeDefinitions): void {

        if (lslDefs.functions) {
            LanguageTransformer.processFunctions(lslDefs, luaDefs);
        }

        if (lslDefs.events) {
            LanguageTransformer.processEvents(lslDefs, luaDefs);
        }

        if (lslDefs.constants) {
            LanguageTransformer.processConstants(lslDefs, luaDefs);
        }
    }

    private static processFunctions(lslDefs: LSLKeywords, luaDefs: LuaTypeDefinitions): void {
        const detected_event = LanguageTransformer.findTypeAlias(luaDefs, "DetectedEvent");

        if (!lslDefs.functions) {
            return;
        }

        if (detected_event) {
            let def = detected_event.definition as TableType;
            if (!def.methods) {
                def.methods = [];
            }
        }
        const detected_methods = detected_event ? (detected_event.definition as TableType).methods : undefined;

        let ll_module: ModuleDeclaration = {
            name: "ll",
            functions: [],
            comment: "LSL built-in functions",
        };
        let ll_compat_module: ModuleDeclaration = {
            name: "llcompat",
            functions: [],
            comment: "LSL compatibility functions",
        };
        for (const [lslName, lslFunc] of Object.entries(lslDefs.functions)) {
            const is_detected = LanguageTransformer.isDetectedFunction(lslName) && detected_event;
            const luaSignature = this.lslFunctionToSignature(lslName, lslFunc);
            const luaName = luaSignature.name;
            if (!is_detected) {
                ll_module.functions!.push(luaSignature);
            }
            else if (detected_methods) {
                detected_methods.push(this.convertDetectedSignature(luaSignature));
            }

            if (lslFunc["index-semantics"] || is_detected) {
                const compatSignature: FunctionSignature = {
                    name: luaName,
                    parameters: luaSignature.parameters,
                    returnType: luaSignature.returnType,
                    comment: `(Index semantics) ${luaSignature.comment || ""}`.trim(),
                };
                ll_compat_module.functions!.push(compatSignature);
            }
        }
        luaDefs.modules = luaDefs.modules || [];
        luaDefs.modules.push(ll_module);
        luaDefs.modules.push(ll_compat_module);
    }

    private static processEvents(lslDefs: LSLKeywords, luaDefs: LuaTypeDefinitions): void {
        const detected_event_list = LanguageTransformer.findTypeAlias(luaDefs, "DetectedEventName");
        const nondetected_event_list = LanguageTransformer.findTypeAlias(luaDefs, "NonDetectedEventName");

        const detected_events = [
            "collision",
            "collision_end",
            "collision_start",
            "final_damage",
            "on_damage",
            "sensor",
            "touch",
            "touch_end",
            "touch_start"
        ];

        for (const lslName of Object.keys(lslDefs.events || {})) {
            if (detected_event_list && detected_events.includes(lslName)) {
                (detected_event_list.definition as LiteralUnionType).values.push(lslName);
            } else if (nondetected_event_list) {
                (nondetected_event_list.definition as LiteralUnionType).values.push(lslName);
            }
        }
    }

    private static processConstants(lslDefs: LSLKeywords, luaDefs: LuaTypeDefinitions): void {
        if (!lslDefs.constants) {
            return;
        }

        // Initialize constants array if it doesn't exist
        if (!luaDefs.constants) {
            luaDefs.constants = [];
        }

        // Iterate through LSL constants and convert to ConstantDeclaration
        for (const [name, lslConstant] of Object.entries(lslDefs.constants)) {
            if (name !== "TRUE" && name !== "FALSE") {
                const constantDecl: ConstantDeclaration = {
                    name,
                    type: this.translateLSLTypeToLua(lslConstant.type) || 'any',
                    value: lslConstant.value,
                    comment: lslConstant.tooltip,
                };
                luaDefs.constants?.push(constantDecl);
            }
        }
    }

    public static translateLSLTypeToLua(lslType: string, isParamList?: boolean): string | null {
        if (!lslType) return null;
        const typeMap: Record<string, string> = {
            void: 'nil',
            integer: 'number',
            float: 'number',
            string: 'string',
            key: isParamList ? 'uuid_like' : 'uuid',
            list: 'list',
            vector: 'vector',
            rotation: 'quaternion',
        };
        return typeMap[lslType.toLowerCase()] || null;
    }

    public static translateLSLFunctionNameToLua(lslFunctionName: string): string {
        return lslFunctionName.startsWith('ll') ? lslFunctionName.substring(2) : lslFunctionName;
    }

    /**
     * Convert an LSLFunction record into a FunctionSignature
     * @param lslName The LSL function name (e.g., "llSay")
     * @param lslFunc The LSL function definition
     * @returns A FunctionSignature object with Lua name (e.g., "Say")
     */
    private static lslFunctionToSignature(lslName: string, lslFunc: LSLFunction): FunctionSignature {
        // Convert LSL parameters to Parameter array
        const parameters: Parameter[] = lslFunc.arguments
            ? lslFunc.arguments.flatMap((lslArg) =>
                Object.entries(lslArg).map(([paramName, paramDef]) => ({
                    name: paramName,
                    type: this.translateLSLTypeToLua(paramDef.type, true) || 'any',
                })),
            )
            : [];

        // Determine return type, converting bool_semantics integer returns to boolean
        let returnType: string;
        if (lslFunc.return === 'integer' && lslFunc.bool_semantics) {
            returnType = 'boolean';
        } else {
            returnType = this.translateLSLTypeToLua(lslFunc.return) || 'nil';
        }

        // Convert LSL function name to Lua name (remove "ll" prefix)
        const luaName = this.translateLSLFunctionNameToLua(lslName);

        return {
            name: luaName,
            parameters,
            returnType,
            comment: lslFunc.tooltip,
        };
    }

    /**
     * Find a type alias by name in the LuaTypeDefinitions
     * @param luaDefs The Lua type definitions object
     * @param name The name of the type alias to find
     * @returns The TypeAlias object if found, undefined otherwise
     */
    private static findTypeAlias(luaDefs: LuaTypeDefinitions, name: string): TypeAlias | undefined {
        if (!luaDefs.typeAliases) {
            return undefined;
        }
        return luaDefs.typeAliases.find((alias) => alias.name === name);
    }

    private static isDetectedFunction(lslFunc: string): boolean {
        return (lslFunc === "llAdjustDamage" || lslFunc.startsWith("llDetected"));
    }

    private static convertDetectedSignature(luauaSignature: FunctionSignature): FunctionSignature {
        // Convert function name: remove "Detected" prefix and replace with "get"
        let newName = luauaSignature.name;
        if (newName.startsWith('Detected')) {
            newName = 'get' + newName.substring('Detected'.length);
        }

        // Replace the first parameter with a self parameter
        const newParameters = [...luauaSignature.parameters];
        if (newParameters.length > 0) {
            newParameters[0] = { name: 'self' };
        }

        return {
            name: newName,
            parameters: newParameters,
            returnType: luauaSignature.returnType,
            comment: luauaSignature.comment,
        };
    }
}
