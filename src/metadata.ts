export interface ExposeOptions {
  name?: string;
  groups?: string[];
  since?: number;
  until?: number;
  toClassOnly?: boolean;
  toPlainOnly?: boolean;
}

export interface ExcludeOptions {
  toClassOnly?: boolean;
  toPlainOnly?: boolean;
}

export interface TransformFnParams {
  value: any;
  key: string;
  obj: any;
  type: number;
}

export interface TransformOptions {
  toClassOnly?: boolean;
  toPlainOnly?: boolean;
  groups?: string[];
}

export interface PropertyMetadata {
  name: string;
  expose?: ExposeOptions;
  exclude?: ExcludeOptions;
  typeFn?: () => Function;
  transformFn?: (params: TransformFnParams) => any;
  transformOptions?: TransformOptions;
}

export class MetadataStorage {
  private storage = new Map<Function, Map<string, PropertyMetadata>>();

  getOrCreateProp(target: any, propertyKey: string): PropertyMetadata {
    const constructor = target.constructor;
    let classProps = this.storage.get(constructor);
    if (!classProps) {
      classProps = new Map();
      this.storage.set(constructor, classProps);
    }
    let prop = classProps.get(propertyKey);
    if (!prop) {
      prop = { name: propertyKey };
      classProps.set(propertyKey, prop);
    }
    return prop;
  }

  getMetadataForClass(constructor: Function): Map<string, PropertyMetadata> | undefined {
    return this.storage.get(constructor);
  }

  getAncestorMetadata(constructor: Function): PropertyMetadata[] {
    const list: PropertyMetadata[] = [];
    const seen = new Set<string>();
    let current = constructor;
    while (current && current !== Object && current !== Function) {
      const meta = this.storage.get(current);
      if (meta) {
        for (const [key, value] of meta.entries()) {
          if (!seen.has(key)) {
            seen.add(key);
            list.push({ ...value });
          }
        }
      }
      current = Object.getPrototypeOf(current);
    }

    // Interop with class-transformer if present
    try {
      const ctStorage = require('class-transformer/cjs/storage')?.defaultMetadataStorage;
      if (ctStorage) {
        const exposed = typeof ctStorage.getExposedMetadatas === 'function' ? ctStorage.getExposedMetadatas(constructor) : [];
        if (exposed) {
          for (const exp of exposed) {
            if (exp.propertyName) {
              let prop = list.find(p => p.name === exp.propertyName);
              if (!prop) {
                prop = { name: exp.propertyName };
                list.push(prop);
                seen.add(exp.propertyName);
              }
              if (!prop.expose) {
                prop.expose = exp.options;
              }
            }
          }
        }
        const excluded = typeof ctStorage.getExcludedMetadatas === 'function' ? ctStorage.getExcludedMetadatas(constructor) : [];
        if (excluded) {
          for (const exc of excluded) {
            if (exc.propertyName) {
              let prop = list.find(p => p.name === exc.propertyName);
              if (!prop) {
                prop = { name: exc.propertyName };
                list.push(prop);
                seen.add(exc.propertyName);
              }
              if (!prop.exclude) {
                prop.exclude = exc.options;
              }
            }
          }
        }

        for (const prop of list) {
          if (!prop.typeFn && typeof ctStorage.findTypeMetadata === 'function') {
            const tm = ctStorage.findTypeMetadata(constructor, prop.name);
            if (tm && tm.typeFunction) {
              prop.typeFn = tm.typeFunction;
            }
          }
          if (!prop.transformFn && typeof ctStorage.findTransformMetadatas === 'function') {
            const tr = ctStorage.findTransformMetadatas(constructor, prop.name);
            if (tr && tr.length > 0 && tr[0].transformFn) {
              prop.transformFn = tr[0].transformFn;
            }
          }
        }
      }
    } catch {}

    // Interop with class-validator if present (so decorated validation fields without @Expose are recognized)
    try {
      const cvStorage = require('class-validator')?.getMetadataStorage?.();
      if (cvStorage && typeof cvStorage.getTargetValidationMetadatas === 'function') {
        const valMetas = cvStorage.getTargetValidationMetadatas(constructor, null, false, false);
        if (valMetas && valMetas.length > 0) {
          for (const vm of valMetas) {
            if (vm.propertyName && !seen.has(vm.propertyName)) {
              seen.add(vm.propertyName);
              const prop: PropertyMetadata = { name: vm.propertyName };
              try {
                const ctStorage = require('class-transformer/cjs/storage')?.defaultMetadataStorage;
                if (ctStorage && typeof ctStorage.findTypeMetadata === 'function') {
                  const tm = ctStorage.findTypeMetadata(constructor, vm.propertyName);
                  if (tm && tm.typeFunction) {
                    prop.typeFn = tm.typeFunction;
                  }
                }
              } catch {}
              list.push(prop);
            }
          }
        }
      }
    } catch {}

    return list;
  }
}

export const defaultMetadataStorage = new MetadataStorage();
