import { MetadataStorage } from '@mikro-orm/core';
import type { ApplyOverrides, OverrideMap } from './types.js';

let counter = 0;

export function OverrideType<T, O extends OverrideMap>(
  parentClass: new (...args: any[]) => T,
  overrides: O,
): new (...args: any[]) => ApplyOverrides<T, O> {
  const pathSymbol = MetadataStorage.PATH_SYMBOL as unknown as string;
  const parentPath: string | undefined = (parentClass as any)[pathSymbol];

  const uniqueName = `${parentClass.name}__Override_${counter++}`;
  abstract class DerivedClass extends (parentClass as any) {}
  Object.defineProperty(DerivedClass, 'name', { value: uniqueName });

  Object.defineProperty(DerivedClass, pathSymbol, {
    value: parentPath,
    writable: true,
  });

  if (parentPath) {
    const parentMeta = MetadataStorage.getMetadata(parentClass.name, parentPath);
    const childMeta = MetadataStorage.getMetadata(DerivedClass.name, parentPath);

    for (const [name, prop] of Object.entries(parentMeta.properties ?? {})) {
      childMeta.properties[name] = { ...prop };
    }

    childMeta.abstract = true;

    for (const [propName, customType] of Object.entries(overrides)) {
      const prop = childMeta.properties[propName];
      if (prop) {
        prop.customType = customType;
        prop.type = customType.constructor.name;
      }
    }
  }

  return DerivedClass as any;
}
