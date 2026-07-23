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
    while (current && current !== Object) {
      const meta = this.storage.get(current);
      if (meta) {
        for (const [key, value] of meta.entries()) {
          if (!seen.has(key)) {
            seen.add(key);
            list.push(value);
          }
        }
      }
      current = Object.getPrototypeOf(current);
    }
    return list;
  }
}

export const defaultMetadataStorage = new MetadataStorage();
