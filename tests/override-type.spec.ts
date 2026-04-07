import { describe, it, expect, beforeEach } from 'vitest';
import { MetadataStorage, Type, ReferenceKind } from '@mikro-orm/core';
import { OverrideType } from '../src/override-type.js';

// --- Mock custom type ---

class TestRecordType extends Type<Record<string, unknown>, string> {
  convertToDatabaseValue(value: Record<string, unknown>) { return JSON.stringify(value); }
  convertToJSValue(value: string) { return JSON.parse(value) as Record<string, unknown>; }
  getColumnType() { return 'text'; }
}

// --- Mock parent entity ---

const FAKE_PATH = '/fake/path/parent-entity.ts';

class ParentEntity {
  idx!: number;
  name!: string;
  data: unknown = null;
}

// Set up PATH_SYMBOL on the parent class so OverrideType can find it
const pathSymbol = MetadataStorage.PATH_SYMBOL as unknown as string;

function setupParentMetadata() {
  Object.defineProperty(ParentEntity, pathSymbol, {
    value: FAKE_PATH,
    writable: true,
    configurable: true,
  });

  const meta = MetadataStorage.getMetadata(ParentEntity.name, FAKE_PATH);
  meta.class = ParentEntity as any;

  meta.properties = {
    idx: {
      name: 'idx',
      type: 'integer',
      runtimeType: 'number',
      kind: ReferenceKind.SCALAR,
      primary: true,
      fieldNames: ['idx'],
      columnTypes: ['int'],
      nullable: false,
    } as any,
    name: {
      name: 'name',
      type: 'character',
      runtimeType: 'string',
      kind: ReferenceKind.SCALAR,
      fieldNames: ['name'],
      columnTypes: ['varchar(255)'],
      nullable: false,
    } as any,
    data: {
      name: 'data',
      type: 'unknown',
      runtimeType: 'string',
      kind: ReferenceKind.SCALAR,
      fieldNames: ['data'],
      columnTypes: ['tinytext'],
      nullable: true,
    } as any,
  };
}

describe('OverrideType', () => {
  beforeEach(() => {
    setupParentMetadata();
  });

  it('returns a class that extends the parent', () => {
    const Derived = OverrideType(ParentEntity, {
      data: new TestRecordType(),
    });

    expect(Derived).toBeDefined();
    expect(Derived.prototype).toBeInstanceOf(ParentEntity);
  });

  it('sets customType on overridden property in child metadata', () => {
    const customType = new TestRecordType();
    const Derived = OverrideType(ParentEntity, {
      data: customType,
    });

    const derivedPath = (Derived as any)[pathSymbol];
    const childMeta = MetadataStorage.getMetadata(Derived.name, derivedPath);

    expect(childMeta.properties.data).toBeDefined();
    expect(childMeta.properties.data.customType).toBe(customType);
    expect(childMeta.properties.data.type).toBe('TestRecordType');
  });

  it('does not modify parent metadata', () => {
    const customType = new TestRecordType();
    OverrideType(ParentEntity, {
      data: customType,
    });

    const parentMeta = MetadataStorage.getMetadata(ParentEntity.name, FAKE_PATH);

    expect(parentMeta.properties.data.customType).toBeUndefined();
    expect(parentMeta.properties.data.type).toBe('unknown');
  });

  it('preserves non-overridden properties in child metadata', () => {
    const Derived = OverrideType(ParentEntity, {
      data: new TestRecordType(),
    });

    const derivedPath = (Derived as any)[pathSymbol];
    const childMeta = MetadataStorage.getMetadata(Derived.name, derivedPath);

    // idx property should be preserved
    expect(childMeta.properties.idx).toBeDefined();
    expect(childMeta.properties.idx.type).toBe('integer');
    expect(childMeta.properties.idx.primary).toBe(true);

    // name property should be preserved
    expect(childMeta.properties.name).toBeDefined();
    expect(childMeta.properties.name.type).toBe('character');
  });

  it('child properties are independent copies (deep copy verification)', () => {
    const Derived = OverrideType(ParentEntity, {
      data: new TestRecordType(),
    });

    const derivedPath = (Derived as any)[pathSymbol];
    const childMeta = MetadataStorage.getMetadata(Derived.name, derivedPath);
    const parentMeta = MetadataStorage.getMetadata(ParentEntity.name, FAKE_PATH);

    // Mutate child property and verify parent is unaffected
    childMeta.properties.name.type = 'modified';
    expect(parentMeta.properties.name.type).toBe('character');
  });

  it('handles multiple overrides', () => {
    class TestStringType extends Type<string, string> {
      convertToDatabaseValue(value: string) { return value; }
      convertToJSValue(value: string) { return value; }
      getColumnType() { return 'varchar(255)'; }
    }

    const dataType = new TestRecordType();
    const nameType = new TestStringType();

    const Derived = OverrideType(ParentEntity, {
      data: dataType,
      name: nameType,
    });

    const derivedPath = (Derived as any)[pathSymbol];
    const childMeta = MetadataStorage.getMetadata(Derived.name, derivedPath);

    expect(childMeta.properties.data.customType).toBe(dataType);
    expect(childMeta.properties.name.customType).toBe(nameType);
    // Non-overridden property remains unchanged
    expect(childMeta.properties.idx.customType).toBeUndefined();
  });

  it('multiple OverrideType calls on same parent produce independent metadata', () => {
    class AnotherType extends Type<number, string> {
      convertToDatabaseValue(value: number) { return String(value); }
      convertToJSValue(value: string) { return Number(value); }
      getColumnType() { return 'varchar(20)'; }
    }

    const typeA = new TestRecordType();
    const typeB = new AnotherType();

    const Child1 = OverrideType(ParentEntity, { data: typeA });
    const Child2 = OverrideType(ParentEntity, { name: typeB });

    expect(Child1.name).not.toBe(Child2.name);

    const meta1 = MetadataStorage.getMetadata(Child1.name, (Child1 as any)[pathSymbol]);
    const meta2 = MetadataStorage.getMetadata(Child2.name, (Child2 as any)[pathSymbol]);

    expect(meta1).not.toBe(meta2);
    expect(meta1.properties.data.customType).toBe(typeA);
    expect(meta1.properties.name.customType).toBeUndefined();
    expect(meta2.properties.name.customType).toBe(typeB);
    expect(meta2.properties.data.customType).toBeUndefined();
  });

  it('silently skips overrides for non-existent properties', () => {
    const Derived = OverrideType(ParentEntity, {
      nonExistent: new TestRecordType(),
    } as any);

    const derivedPath = (Derived as any)[pathSymbol];
    const childMeta = MetadataStorage.getMetadata(Derived.name, derivedPath);

    // Should not create a property that doesn't exist on parent
    expect(childMeta.properties.nonExistent).toBeUndefined();
    // Existing properties should still be there
    expect(childMeta.properties.idx).toBeDefined();
  });
});
