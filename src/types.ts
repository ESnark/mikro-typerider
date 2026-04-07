import { Type } from '@mikro-orm/core';

export type InferJSType<T> = T extends Type<infer JS, any> ? JS : never;

export type OverrideMap = Record<string, Type<any, any>>;

export type ApplyOverrides<Entity, Overrides extends OverrideMap> = {
  [K in keyof Entity]: K extends keyof Overrides
    ? null extends Entity[K]
      ? InferJSType<Overrides[K]> | null
      : InferJSType<Overrides[K]>
    : Entity[K];
};
