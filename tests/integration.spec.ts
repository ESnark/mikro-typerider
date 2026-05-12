import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MikroORM } from '@mikro-orm/sqlite';
import { Type } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/es';
import { OverrideType } from '../src/override-type.js';

(Symbol as any).metadata ??= Symbol.for('Symbol.metadata');

class JsonStringType extends Type<Record<string, unknown>, string> {
  override convertToDatabaseValue(value: Record<string, unknown> | null): string | null {
    return value === null ? null : JSON.stringify(value);
  }
  override convertToJSValue(value: string | null): Record<string, unknown> | null {
    return value === null ? null : (JSON.parse(value) as Record<string, unknown>);
  }
  override getColumnType() {
    return 'text';
  }
}

class CsvArrayType extends Type<string[], string> {
  override convertToDatabaseValue(value: string[] | null): string | null {
    return value === null ? null : value.join(',');
  }
  override convertToJSValue(value: string | null): string[] | null {
    return value === null || value === '' ? null : value.split(',');
  }
  override getColumnType() {
    return 'text';
  }
}

// `abstract: true` mirrors the requirement that an override target must not
// register its own table. See README "Caveats". Without this flag, MikroORM's
// discovery prototype-walks to the parent and rejects the duplicate tableName.
@Entity({ tableName: 'parent_t', abstract: true })
class ParentEntity {
  @PrimaryKey({ type: 'number' })
  id!: number;

  @Property({ type: 'text', nullable: true })
  data: string | null = null;
}

@Entity({ tableName: 'parent_t' })
class AppEntity extends OverrideType(ParentEntity, {
  data: new JsonStringType(),
}) {}

@Entity({ tableName: 'array_parent_t', abstract: true })
class ArrayParentEntity {
  @PrimaryKey({ type: 'number' })
  id!: number;

  @Property({ type: 'string', array: true, nullable: true })
  tags: string[] | null = null;
}

@Entity({ tableName: 'array_parent_t' })
class ArrayAppEntity extends OverrideType(ArrayParentEntity, {
  tags: new CsvArrayType(),
}) {}

describe('OverrideType integration with MikroORM SQLite', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [AppEntity, ArrayAppEntity],
      dbName: ':memory:',
      allowGlobalContext: true,
    });
    await orm.schema.create();
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it('hydrates DB string value into object via overridden customType', async () => {
    const conn = orm.em.getConnection();
    await conn.execute(
      `INSERT INTO parent_t (id, data) VALUES (1, '${JSON.stringify({ a: 1 })}')`,
    );

    const em = orm.em.fork();
    const row = await em.findOneOrFail(AppEntity, { id: 1 });

    expect(row.data).toEqual({ a: 1 });
    expect(typeof row.data).toBe('object');
  });

  it('serializes object to DB string via overridden customType on flush', async () => {
    const em = orm.em.fork();
    em.create(AppEntity, { id: 2, data: { x: 'y' } as any });
    await em.flush();

    const raw = await orm.em.getConnection().execute<Array<{ data: string }>>(
      'SELECT data FROM parent_t WHERE id = 2',
    );
    expect(JSON.parse(raw[0].data)).toEqual({ x: 'y' });
  });

  it('schema generator emits column type from overridden customType', async () => {
    const sql = await orm.schema.getCreateSchemaSQL();
    expect(sql.toLowerCase()).toMatch(/`data`\s+text/);
  });

  it('keeps non-overridden primary key type intact', async () => {
    const meta = orm.getMetadata().get(AppEntity);
    expect(meta.properties.id.type).toBe('number');
    expect(meta.properties.data.type).toBe('JsonStringType');
    expect(meta.properties.data.customType).toBeInstanceOf(JsonStringType);
  });

  // Covers the parent-defines-array-property + child-overrides-customType case.
  // MikroORM 7.0.15 (#7689) made `prop.array` part of the default-customType
  // wiring path; verify that path doesn't fight an explicit override.
  it('overrides customType on an array-typed parent property', async () => {
    const meta = orm.getMetadata().get(ArrayAppEntity);
    expect(meta.properties.tags.customType).toBeInstanceOf(CsvArrayType);
    expect(meta.properties.tags.type).toBe('CsvArrayType');
  });

  it('round-trips array values through the overridden CSV customType', async () => {
    const em = orm.em.fork();
    em.create(ArrayAppEntity, { id: 1, tags: ['foo', 'bar', 'baz'] });
    await em.flush();

    const raw = await orm.em.getConnection().execute<Array<{ tags: string }>>(
      'SELECT tags FROM array_parent_t WHERE id = 1',
    );
    expect(raw[0].tags).toBe('foo,bar,baz');

    const reloaded = await orm.em.fork().findOneOrFail(ArrayAppEntity, { id: 1 });
    expect(reloaded.tags).toEqual(['foo', 'bar', 'baz']);
  });
});
