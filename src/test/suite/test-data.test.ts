import * as assert from 'assert';
import { TestDataLoader, getTestLuaTypes } from './test-data-loader';

/**
 * Test suite for the minimal test data loader and validation
 */
suite('Test Data Loader', () => {
    test('Should load minimal lua types successfully', () => {
        const testData = TestDataLoader.loadMinimalLuaTypes();

        assert.ok(testData, 'Test data should be loaded');
        assert.ok(testData.$schema, 'Should have schema reference');

        // Verify all expected sections exist
        assert.ok(testData.aliases, 'Should have aliases section');
        assert.ok(testData.functions, 'Should have functions section');
        assert.ok(testData.classes, 'Should have classes section');
        assert.ok(testData.modules, 'Should have modules section');
    });

    test('Should have expected aliases', () => {
        const testData = getTestLuaTypes();

        assert.ok(testData.aliases.numeric, 'Should have numeric alias');
        assert.ok(testData.aliases.list, 'Should have list alias');

        // Verify alias structure
        const numericAlias = testData.aliases.numeric;
        assert.ok(numericAlias.aliasTypes, 'Numeric alias should have aliasTypes');
        assert.ok(numericAlias.tooltip, 'Numeric alias should have tooltip');
        assert.ok(Array.isArray(numericAlias.aliasTypes), 'aliasTypes should be array');
    });

    test('Should have expected functions', () => {
        const testData = getTestLuaTypes();

        assert.ok(testData.functions.toquaternion, 'Should have toquaternion function');
        assert.ok(testData.functions.tovector, 'Should have tovector function');

        // Verify function structure
        const toQuatFunc = testData.functions.toquaternion;
        assert.ok(toQuatFunc.parameters, 'Function should have parameters');
        assert.ok(toQuatFunc.returnType, 'Function should have return type');
        assert.ok(toQuatFunc.tooltip, 'Function should have tooltip');
        assert.ok(Array.isArray(toQuatFunc.parameters), 'Parameters should be array');
    });

    test('Should have expected classes', () => {
        const testData = getTestLuaTypes();

        assert.ok(testData.classes.integer, 'Should have integer class');
        assert.ok(testData.classes.vector, 'Should have vector class');

        // Verify class structure
        const integerClass = testData.classes.integer;
        assert.ok(integerClass.methods, 'Class should have methods');
        assert.ok(integerClass.tooltip, 'Class should have tooltip');
        assert.ok(integerClass.methods.__add, 'Class should have __add method');

        // Verify vector has properties
        const vectorClass = testData.classes.vector;
        assert.ok(vectorClass.properties, 'Vector class should have properties');
        assert.ok(vectorClass.properties.x, 'Vector should have x property');
        assert.ok(vectorClass.properties.y, 'Vector should have y property');
        assert.ok(vectorClass.properties.z, 'Vector should have z property');
    });

    test('Should have expected modules', () => {
        const testData = getTestLuaTypes();

        assert.ok(testData.modules.bit32, 'Should have bit32 module');
        assert.ok(testData.modules.lljson, 'Should have lljson module');

        // Verify module structure
        const bit32Module = testData.modules.bit32;
        assert.ok(bit32Module.methods, 'Module should have methods');
        assert.ok(bit32Module.tooltip, 'Module should have tooltip');
        assert.ok(bit32Module.methods.band, 'Module should have band method');

        // Verify lljson has properties
        const lljsonModule = testData.modules.lljson;
        assert.ok(lljsonModule.properties, 'lljson module should have properties');
        assert.ok(lljsonModule.properties.null, 'lljson should have null property');
    });

    test('Should validate method structures', () => {
        const testData = getTestLuaTypes();

        // Test method overloads are arrays
        const addMethod = testData.classes.integer.methods.__add;
        assert.ok(Array.isArray(addMethod), 'Method should be array of overloads');
        assert.ok(addMethod.length > 0, 'Method should have at least one overload');

        // Test method overload structure
        const overload = addMethod[0];
        assert.ok(overload.parameters, 'Method overload should have parameters');
        assert.ok(overload.returnType, 'Method overload should have return type');
        assert.ok(overload.tooltip, 'Method overload should have tooltip');
        assert.ok(Array.isArray(overload.parameters), 'Parameters should be array');
    });

    test('Should handle variadic parameters', () => {
        const testData = getTestLuaTypes();

        const bandMethod = testData.modules.bit32.methods.band[0];
        const variadicParam = bandMethod.parameters.find((p: any) => p.variadic);
        assert.ok(variadicParam, 'Should find variadic parameter');
        assert.strictEqual(variadicParam.variadic, true, 'Variadic parameter should be marked');
    });
});
