# @esnark/mikro-typerider

## 0.2.0

### Minor Changes

- 14e2a07: Harden `OverrideType` metadata handling and align with MikroORM 7.0.15.

  - **Breaking:** `OverrideType` now throws when an `overrides` entry references a property that does not exist on the parent entity. Previously the unknown property was silently skipped, masking typos.
  - Deep-copy nested array fields (`fieldNames`, `columnTypes`, `items`, `joinColumns`, `inverseJoinColumns`) when cloning parent metadata, so mutations on the derived entity no longer leak back into the parent's `EntityMetadata`.
  - Clear stale `runtimeType` and `columnTypes` on overridden properties. MikroORM's `initCustomType` uses `??=`, so without this the parent's already-resolved values would shadow the new `customType`.
  - Bump dev dependency on `@mikro-orm/core` / `@mikro-orm/sqlite` to 7.0.15 and add an integration test exercising the override path through SQLite, including a scalar-array override that touches the new `prop.array` wiring from MikroORM #7689.
