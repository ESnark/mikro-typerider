# @esnark/mikro-typerider

Override property types on auto-generated MikroORM v7 entities — both TypeScript types and runtime metadata in one step.

## Problem

Code generators produce entity classes with generic types like `string` or `unknown` for columns that actually store structured data (e.g., PHP-serialized JSON). You want to use a custom `Type<T>` for these columns, but:

- Redefining properties with `declare` causes TypeScript type mismatches
- Subclassing creates a second entity mapped to the same table, which MikroORM rejects

## Solution

`OverrideType` creates an intermediate class that swaps the `customType` in MikroORM's metadata and adjusts the TypeScript type — without table conflicts.

```ts
import { Entity } from '@mikro-orm/core';
import { OverrideType } from '@esnark/mikro-typerider';
import { ShopOrder } from '@imwebme/mikro-models/doznut_shop';
import { PhpSerializedType } from './types/php-serialized-type.js';

@Entity({ tableName: 'shop_order', schema: 'doznut_shop' })
class AppShopOrder extends OverrideType(ShopOrder, {
  refundData: new PhpSerializedType<Record<string, unknown>>(),
  payBankInfo: new PhpSerializedType<BankInfo>(),
}) {}

const order = await em.findOne(AppShopOrder, { idx: 1 });
order.refundData;  // Record<string, unknown>  (was unknown)
order.payBankInfo; // BankInfo | null           (was string | null)
order.code;        // string                    (unchanged)
```

## Install

```bash
npm install @esnark/mikro-typerider
```

Requires `@mikro-orm/core` v7+ as a peer dependency.

## API

### `OverrideType(parentClass, overrides)`

Returns a new class extending `parentClass` with the specified property types replaced.

- **parentClass** — A MikroORM entity class (decorated with `@Entity`)
- **overrides** — `{ propertyName: new CustomType() }` map of properties to override

The override map values must be instances of MikroORM's `Type<JSType, DBType>`. The `JSType` generic parameter becomes the new TypeScript type for that property.

**Nullable preservation:** If the original property is nullable (`T | null`), the overridden type stays nullable (`NewType | null`).

### Type utilities

```ts
import type { InferJSType, ApplyOverrides, OverrideMap } from '@esnark/mikro-typerider';
```

- `InferJSType<T>` — Extracts the JS type from `Type<JSType, DBType>`
- `ApplyOverrides<Entity, Overrides>` — Computes the resulting entity type
- `OverrideMap` — `Record<string, Type<any, any>>`

## How it works

1. Creates an abstract intermediate class extending the parent
2. Deep-copies the parent's `EntityMetadata.properties` from MikroORM's global `MetadataStorage`
3. Replaces `customType` and `type` on overridden properties
4. Marks the intermediate class as `abstract` so MikroORM doesn't map it to a table
5. When `@Entity()` is applied to your final class, MikroORM's discovery walks the prototype chain and inherits the modified properties

## License

MIT
