import * as assert from 'assert';
import {
    LuaTypeDefinitions,
    ClassDeclaration,
    ModuleDeclaration,
    GlobalFunction,
    TypeAlias,
    ConstantDeclaration,
    Parameter
} from '../../shared/luadefsinterface';
import { SeleneYamlGenerator } from '../../shared/seleneyamlgenerator';
import { LuauDefsGenerator } from '../../shared/luadefsgenerator';
import { DocsJsonGenerator } from '../../shared/docsjsongenerator';

/**
 * Test suite for Selene YAML Generator
 */
suite('SeleneYamlGenerator Tests', () => {
    let mockVersion: string;

    suiteSetup(() => {
        mockVersion = '1.0.0-test';
    });

    test('Should generate basic Selene configuration structure', () => {
        const minimalDefs: LuaTypeDefinitions = {
            version: mockVersion
        };

        const generator = new SeleneYamlGenerator();
        const config = {
            base: 'roblox',
            luaVersions: ['roblox', '5.1'],
            name: 'SLua LSL language support',
            version: mockVersion
        };
        const result = generator.generate(minimalDefs, config);

        assert.ok(typeof result === 'string', 'Should return a string');
        assert.ok(result.includes('base: roblox'), 'Should use roblox base');
        assert.ok(result.includes('SLua LSL language support'), 'Should have correct name');
        assert.ok(result.includes(mockVersion), 'Should include version');
    });

    test('Should handle empty language definitions correctly', () => {
        const emptyDefs: LuaTypeDefinitions = {
            version: mockVersion
        };

        const generator = new SeleneYamlGenerator();
        const config = {
            base: 'roblox',
            luaVersions: ['roblox'],
            name: 'SLua LSL language support',
            version: mockVersion
        };
        const result = generator.generate(emptyDefs, config);

        // Should still have basic structure
        assert.ok(result.includes('base: roblox'), 'Should have base');
        assert.ok(result.includes(mockVersion), 'Should have version');
        assert.ok(result.includes('SLua LSL language support'), 'Should have name');
    });

    test('Should generate constants in globals section', () => {
        const defs: LuaTypeDefinitions = {
            version: mockVersion,
            constants: [
                {
                    name: 'TRUE',
                    type: 'number',
                    value: 1,
                    comment: 'Constant representing true (1)'
                },
                {
                    name: 'FALSE',
                    type: 'number',
                    value: 0,
                    comment: 'Constant representing false (0)'
                },
                {
                    name: 'PI',
                    type: 'number',
                    value: 3.14159,
                    comment: 'Mathematical constant pi'
                }
            ]
        };

        const generator = new SeleneYamlGenerator();
        const config = {
            base: 'roblox',
            luaVersions: ['roblox'],
            name: 'SLua LSL language support',
            version: mockVersion
        };
        const result = generator.generate(defs, config);

        assert.ok(result.includes('TRUE'), 'Should include TRUE constant');
        assert.ok(result.includes('FALSE'), 'Should include FALSE constant');
        assert.ok(result.includes('PI'), 'Should include PI constant');
    });

    test('Should generate global functions', () => {
        const defs: LuaTypeDefinitions = {
            version: mockVersion,
            globalFunctions: [
                {
                    name: 'toquaternion',
                    parameters: [{ name: 'str', type: 'string' }],
                    returnType: { kind: 'union', types: ['quaternion', 'nil'] },
                    comment: 'Creates a quaternion from a string argument'
                },
                {
                    name: 'tovector',
                    parameters: [{ name: 'str', type: 'string' }],
                    returnType: { kind: 'union', types: ['vector', 'nil'] },
                    comment: 'Creates a vector from a string argument'
                }
            ]
        };

        const generator = new SeleneYamlGenerator();
        const config = {
            base: 'roblox',
            luaVersions: ['roblox'],
            name: 'SLua LSL language support',
            version: mockVersion
        };
        const result = generator.generate(defs, config);

        assert.ok(result.includes('toquaternion'), 'Should include toquaternion');
        assert.ok(result.includes('tovector'), 'Should include tovector');
    });
});

/**
 * Test suite for Luau LSP Generators (Definitions and Documentation)
 */
suite('LuauDefsGenerator and DocsJsonGenerator Tests', () => {
    let mockVersion: string;

    suiteSetup(() => {
        mockVersion = '1.0.0-test';
    });

    test('Should generate basic Luau LSP configuration structure', () => {
        const minimalDefs: LuaTypeDefinitions = {
            version: mockVersion
        };

        const defsGenerator = new LuauDefsGenerator();
        const docsGenerator = new DocsJsonGenerator();

        const defs = defsGenerator.generate(minimalDefs);
        const docs = docsGenerator.generate(minimalDefs);

        assert.ok(typeof defs === 'string', 'Should return definitions string');
        assert.ok(typeof docs === 'string', 'Should return documentation string');
    });

    test('Should generate type aliases', () => {
        const defs: LuaTypeDefinitions = {
            version: mockVersion,
            typeAliases: [
                {
                    name: 'numeric',
                    definition: {
                        kind: 'union',
                        types: ['number', 'boolean', 'integer']
                    },
                    comment: 'A union type representing numeric values'
                },
                {
                    name: 'list',
                    definition: {
                        kind: 'table',
                        properties: []
                    },
                    comment: 'A table type'
                }
            ]
        };

        const generator = new LuauDefsGenerator();
        const result = generator.generate(defs);

        assert.ok(result.includes('type numeric ='), 'Should generate numeric alias');
        assert.ok(result.includes('type list ='), 'Should generate list alias');
        assert.ok(result.includes('number') && result.includes('boolean') && result.includes('integer'), 'Numeric alias should have correct union types');
    });

    test('Should generate class definitions', () => {
        const defs: LuaTypeDefinitions = {
            version: mockVersion,
            classes: [
                {
                    name: 'integer',
                    methods: [
                        {
                            name: '__add',
                            parameters: [
                                { name: 'self', type: 'integer' },
                                { name: 'other', type: 'integer' }
                            ],
                            returnType: 'integer',
                            comment: 'Addition operator for integers'
                        }
                    ],
                    comment: 'Integer class with arithmetic operations'
                },
                {
                    name: 'vector',
                    properties: [
                        { name: 'x', type: 'number' },
                        { name: 'y', type: 'number' },
                        { name: 'z', type: 'number' }
                    ],
                    comment: 'Vector class with x, y, z components'
                }
            ]
        };

        const generator = new LuauDefsGenerator();
        const result = generator.generate(defs);

        assert.ok(result.includes('declare extern type integer with'), 'Should generate integer class');
        assert.ok(result.includes('declare extern type vector with'), 'Should generate vector class');
        assert.ok(result.includes('__add'), 'Should generate operator methods');
        assert.ok(result.includes('x') && result.includes('number'), 'Should generate x property');
        assert.ok(result.includes('y') && result.includes('number'), 'Should generate y property');
        assert.ok(result.includes('z') && result.includes('number'), 'Should generate z property');
    });

    test('Should generate module definitions', () => {
        const defs: LuaTypeDefinitions = {
            version: mockVersion,
            modules: [
                {
                    name: 'math',
                    functions: [
                        {
                            name: 'abs',
                            parameters: [{ name: 'x', type: 'number' }],
                            returnType: 'number',
                            comment: 'Returns the absolute value'
                        },
                        {
                            name: 'max',
                            parameters: [
                                { name: 'a', type: 'number' },
                                { name: 'b', type: 'number' }
                            ],
                            returnType: 'number',
                            comment: 'Returns the maximum value'
                        }
                    ],
                    comment: 'Mathematical functions module'
                }
            ]
        };

        const generator = new LuauDefsGenerator();
        const result = generator.generate(defs);

        assert.ok(result.includes('declare math:'), 'Should generate math module');
        assert.ok(result.includes('abs'), 'Should include abs method');
        assert.ok(result.includes('max'), 'Should include max method');
    });

    test('Should generate global function definitions', () => {
        const defs: LuaTypeDefinitions = {
            version: mockVersion,
            globalFunctions: [
                {
                    name: 'toquaternion',
                    parameters: [{ name: 'str', type: 'string' }],
                    returnType: { kind: 'union', types: ['quaternion', 'nil'] },
                    comment: 'Creates a quaternion from a string argument'
                },
                {
                    name: 'tovector',
                    parameters: [{ name: 'str', type: 'string' }],
                    returnType: { kind: 'union', types: ['vector', 'nil'] },
                    comment: 'Creates a vector from a string argument'
                }
            ]
        };

        const generator = new LuauDefsGenerator();
        const docsGenerator = new DocsJsonGenerator();

        const result = generator.generate(defs);
        const docs = JSON.parse(docsGenerator.generate(defs));

        assert.ok(result.includes('declare function toquaternion'), 'Should generate toquaternion function');
        assert.ok(result.includes('declare function tovector'), 'Should generate tovector function');

        // Check documentation
        assert.ok(docs['@roblox/global/toquaternion'], 'Should have toquaternion documentation');
        assert.ok(docs['@roblox/global/tovector'], 'Should have tovector documentation');
    });

    test('Should handle constants correctly', () => {
        const defs: LuaTypeDefinitions = {
            version: mockVersion,
            constants: [
                {
                    name: 'TRUE',
                    type: 'number',
                    value: 1,
                    comment: 'Constant representing true (1)'
                },
                {
                    name: 'FALSE',
                    type: 'number',
                    value: 0,
                    comment: 'Constant representing false (0)'
                },
                {
                    name: 'PI',
                    type: 'number',
                    value: 3.14159,
                    comment: 'Mathematical constant pi'
                },
                {
                    name: 'EMPTY_STRING',
                    type: 'string',
                    value: '',
                    comment: 'Empty string constant'
                }
            ]
        };

        const generator = new LuauDefsGenerator();
        const docsGenerator = new DocsJsonGenerator();

        const result = generator.generate(defs);
        const docs = JSON.parse(docsGenerator.generate(defs));

        assert.ok(result.includes('declare TRUE'), 'Should generate TRUE constant');
        assert.ok(result.includes('declare FALSE'), 'Should generate FALSE constant');
        assert.ok(result.includes('declare PI'), 'Should generate PI constant');
        assert.ok(result.includes('declare EMPTY_STRING'), 'Should generate EMPTY_STRING constant');

        // Check documentation
        assert.ok(docs['@roblox/global/TRUE'], 'Should have TRUE constant documentation');
        assert.ok(docs['@roblox/global/FALSE'], 'Should have FALSE constant documentation');
        assert.ok(docs['@roblox/global/PI'], 'Should have PI constant documentation');
        assert.ok(docs['@roblox/global/EMPTY_STRING'], 'Should have EMPTY_STRING constant documentation');
    });

    test('Should handle function parameters with optional and variadic types', () => {
        const defs: LuaTypeDefinitions = {
            version: mockVersion,
            globalFunctions: [
                {
                    name: 'complexFunction',
                    parameters: [
                        { name: 'required', type: 'string' },
                        { name: 'optional', type: 'number', optional: true },
                        { type: 'any', variadic: true }
                    ],
                    returnType: 'any',
                    comment: 'Function with complex parameter types'
                }
            ]
        };

        const generator = new LuauDefsGenerator();
        const result = generator.generate(defs);

        assert.ok(result.includes('declare function complexFunction'), 'Should include complexFunction');
        assert.ok(result.includes('required: string'), 'Should include required parameter');
    });

    test('Should handle method overloads', () => {
        const defs: LuaTypeDefinitions = {
            version: mockVersion,
            classes: [
                {
                    name: 'TestClass',
                    methods: [
                        {
                            name: 'overloadedMethod',
                            parameters: [{ name: 'x', type: 'number' }],
                            returnType: 'string',
                            comment: 'First overload',
                            overloads: [
                                {
                                    parameters: [
                                        { name: 'x', type: 'number' },
                                        { name: 'y', type: 'number' }
                                    ],
                                    returnType: 'string',
                                    comment: 'Second overload'
                                }
                            ]
                        }
                    ]
                }
            ]
        };

        const generator = new LuauDefsGenerator();
        const result = generator.generate(defs);

        assert.ok(result.includes('declare extern type TestClass with'), 'Should generate TestClass');
        assert.ok(result.includes('overloadedMethod'), 'Should include overloaded method');
    });

    test('Should handle complex integration with all type categories', () => {
        const complexDefs: LuaTypeDefinitions = {
            version: mockVersion,
            typeAliases: [
                {
                    name: 'numeric',
                    definition: { kind: 'union', types: ['number', 'integer'] },
                    comment: 'Numeric types'
                }
            ],
            classes: [
                {
                    name: 'Vector',
                    properties: [
                        { name: 'x', type: 'number' },
                        { name: 'y', type: 'number' },
                        { name: 'z', type: 'number' }
                    ],
                    methods: [
                        {
                            name: 'magnitude',
                            parameters: [],
                            returnType: 'number',
                            comment: 'Calculate magnitude'
                        }
                    ]
                }
            ],
            modules: [
                {
                    name: 'math',
                    functions: [
                        {
                            name: 'sqrt',
                            parameters: [{ name: 'x', type: 'number' }],
                            returnType: 'number',
                            comment: 'Square root'
                        }
                    ]
                }
            ],
            globalFunctions: [
                {
                    name: 'globalHelper',
                    parameters: [{ name: 'input', type: 'any' }],
                    returnType: 'string',
                    comment: 'Global helper function'
                }
            ],
            constants: [
                {
                    name: 'MAX_VALUE',
                    type: 'number',
                    value: 100,
                    comment: 'Maximum allowed value'
                }
            ]
        };

        const generator = new LuauDefsGenerator();
        const docsGenerator = new DocsJsonGenerator();

        const result = generator.generate(complexDefs);
        const docs = JSON.parse(docsGenerator.generate(complexDefs));

        // Should have all categories
        assert.ok(result.includes('type numeric ='), 'Should have alias');
        assert.ok(result.includes('declare extern type Vector with'), 'Should have class');
        assert.ok(result.includes('declare math:'), 'Should have module');
        assert.ok(result.includes('declare function globalHelper'), 'Should have global function');
        assert.ok(result.includes('declare MAX_VALUE'), 'Should have constant');

        // Should have comprehensive documentation
        assert.ok(Object.keys(docs).length >= 2, 'Should have multiple documentation entries');
        assert.ok(docs['@roblox/global/globalHelper'], 'Should have global function docs');
        assert.ok(docs['@roblox/global/MAX_VALUE'], 'Should have constant docs');
    });

    test('Should handle empty definitions gracefully', () => {
        const minimalDefs: LuaTypeDefinitions = {
            version: mockVersion
        };

        const generator = new LuauDefsGenerator();
        const docsGenerator = new DocsJsonGenerator();

        const result = generator.generate(minimalDefs);
        const docs = docsGenerator.generate(minimalDefs);

        assert.ok(typeof result === 'string', 'Should return string even with minimal input');
        assert.ok(typeof docs === 'string', 'Should return documentation string');
    });
});
