import { defaultMetadataStorage } from './metadata';

export type ClassConstructor<T> = new (...args: any[]) => T;

export interface ClassTransformOptions {
  excludeExtraneousValues?: boolean;
  groups?: string[];
  version?: number;
  exposeDefaultValues?: boolean;
  exposeUnsetFields?: boolean;
  strategy?: 'excludeAll' | 'exposeAll';
  enableCircularCheck?: boolean;
}

function getCacheKey(options?: ClassTransformOptions): string {
  if (!options) return 'default';
  const parts: string[] = [];
  if (options.groups) parts.push(`g:${options.groups.slice().sort().join(',')}`);
  if (options.version !== undefined) parts.push(`v:${options.version}`);
  if (options.excludeExtraneousValues) parts.push(`ee:1`);
  if (options.exposeDefaultValues !== undefined) parts.push(`ed:${options.exposeDefaultValues ? 1 : 0}`);
  if (options.exposeUnsetFields !== undefined) parts.push(`eu:${options.exposeUnsetFields ? 1 : 0}`);
  return parts.length ? parts.join('|') : 'default';
}

function buildJitMapper<T>(cls: ClassConstructor<T>, options?: ClassTransformOptions): (plain: any, options?: ClassTransformOptions) => T {
  const props = defaultMetadataStorage.getAncestorMetadata(cls);

  if (props.length === 0) {
    return function (plain: any) {
      if (plain == null) return plain;
      const inst = new cls();
      Object.assign(inst as any, plain);
      return inst;
    };
  }

  const bodyLines: string[] = [];
  bodyLines.push("if (plain == null) return plain;");
  bodyLines.push("const inst = new cls();");

  const context: Record<string, any> = {
    cls,
    plainToInstance,
  };

  const groups = options?.groups;
  const version = options?.version;
  const excludeExtraneous = options?.excludeExtraneousValues || options?.strategy === 'excludeAll';

  props.forEach((prop, idx) => {
    if (prop.exclude && prop.exclude.toClassOnly !== false) {
      return;
    }

    if (excludeExtraneous && !prop.expose) {
      return;
    }

    if (prop.expose && prop.expose.toClassOnly === false) {
      return;
    }

    if (prop.expose?.groups && groups) {
      const hasMatchingGroup = prop.expose.groups.some(g => groups.includes(g));
      if (!hasMatchingGroup) return;
    }

    if (version !== undefined) {
      if (prop.expose?.since !== undefined && version < prop.expose.since) return;
      if (prop.expose?.until !== undefined && version >= prop.expose.until) return;
    }

    const sourceKey = prop.expose?.name || prop.name;
    const targetKey = prop.name;

    if (prop.transformFn) {
      const transformKey = `transform_${idx}`;
      context[transformKey] = prop.transformFn;
      bodyLines.push(`  if (plain['${sourceKey}'] !== undefined) {`);
      bodyLines.push(`    inst['${targetKey}'] = ${transformKey}({ value: plain['${sourceKey}'], key: '${sourceKey}', obj: plain, type: 1 });`);
      bodyLines.push(`  }`);
    } else if (prop.typeFn) {
      const typeKey = `type_${idx}`;
      context[typeKey] = prop.typeFn;
      bodyLines.push(`  if (plain['${sourceKey}'] !== undefined && plain['${sourceKey}'] !== null) {`);
      bodyLines.push(`    const subClass = ${typeKey}();`);
      bodyLines.push(`    inst['${targetKey}'] = plainToInstance(subClass, plain['${sourceKey}'], options);`);
      bodyLines.push(`  } else {`);
      bodyLines.push(`    inst['${targetKey}'] = plain['${sourceKey}'];`);
      bodyLines.push(`  }`);
    } else {
      let designType: any;
      if (typeof Reflect !== 'undefined' && typeof (Reflect as any).getMetadata === 'function') {
        designType = (Reflect as any).getMetadata('design:type', cls.prototype, prop.name);
      }

      if (designType === Date) {
        bodyLines.push(`  if (plain['${sourceKey}'] !== undefined) {`);
        bodyLines.push(`    const val = plain['${sourceKey}'];`);
        bodyLines.push(`    inst['${targetKey}'] = val != null ? new Date(val) : val;`);
        bodyLines.push(`  }`);
      } else if (designType && designType !== Object && designType !== Array && designType !== String && designType !== Number && designType !== Boolean) {
        const typeKey = `type_${idx}`;
        context[typeKey] = () => designType;
        bodyLines.push(`  if (plain['${sourceKey}'] !== undefined && plain['${sourceKey}'] !== null) {`);
        bodyLines.push(`    inst['${targetKey}'] = plainToInstance(${typeKey}(), plain['${sourceKey}'], options);`);
        bodyLines.push(`  } else {`);
        bodyLines.push(`    inst['${targetKey}'] = plain['${sourceKey}'];`);
        bodyLines.push(`  }`);
      } else {
        bodyLines.push(`  if (plain['${sourceKey}'] !== undefined) {`);
        bodyLines.push(`    inst['${targetKey}'] = plain['${sourceKey}'];`);
        bodyLines.push(`  }`);
      }
    }
  });

  bodyLines.push("return inst;");

  const paramNames = Object.keys(context);
  const paramValues = Object.values(context);
  
  const functionBody = `
    return function(plain, options) {
      ${bodyLines.join('\n')}
    };
  `;

  const factory = new Function(...paramNames, functionBody);
  return factory(...paramValues);
}

function buildJitSerializer<T>(cls: ClassConstructor<T>, options?: ClassTransformOptions): (inst: T, options?: ClassTransformOptions) => Record<string, any> {
  const props = defaultMetadataStorage.getAncestorMetadata(cls);

  if (props.length === 0) {
    return function (inst: any) {
      if (inst == null) return inst;
      const plain: any = {};
      const keys = Object.keys(inst);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const val = inst[key];
        if (typeof val === 'object' && val !== null) {
          if (val instanceof Date) {
            plain[key] = val.toISOString();
          } else if (val.constructor && val.constructor !== Object && val.constructor !== Array) {
            plain[key] = instanceToPlain(val, options);
          } else if (Array.isArray(val)) {
            plain[key] = val.map(item => (item && item.constructor && item.constructor !== Object) ? instanceToPlain(item, options) : item);
          } else {
            plain[key] = val;
          }
        } else {
          plain[key] = val;
        }
      }
      return plain;
    };
  }

  const bodyLines: string[] = [];
  bodyLines.push("if (inst == null) return inst;");
  bodyLines.push("const plain = {};");

  const context: Record<string, any> = {
    cls,
    instanceToPlain,
  };

  const groups = options?.groups;
  const version = options?.version;
  const excludeExtraneous = options?.excludeExtraneousValues || options?.strategy === 'excludeAll';

  props.forEach((prop, idx) => {
    if (prop.exclude && prop.exclude.toPlainOnly !== false) {
      return;
    }

    if (excludeExtraneous && !prop.expose) {
      return;
    }

    if (prop.expose && prop.expose.toPlainOnly === false) {
      return;
    }

    if (prop.expose?.groups && groups) {
      const hasMatchingGroup = prop.expose.groups.some(g => groups.includes(g));
      if (!hasMatchingGroup) return;
    }

    if (version !== undefined) {
      if (prop.expose?.since !== undefined && version < prop.expose.since) return;
      if (prop.expose?.until !== undefined && version >= prop.expose.until) return;
    }

    const sourceKey = prop.name;
    const targetKey = prop.expose?.name || prop.name;

    if (prop.transformFn) {
      const transformKey = `transform_${idx}`;
      context[transformKey] = prop.transformFn;
      bodyLines.push(`  if (inst['${sourceKey}'] !== undefined) {`);
      bodyLines.push(`    plain['${targetKey}'] = ${transformKey}({ value: inst['${sourceKey}'], key: '${sourceKey}', obj: inst, type: 2 });`);
      bodyLines.push(`  }`);
    } else if (prop.typeFn) {
      bodyLines.push(`  if (inst['${sourceKey}'] !== undefined) {`);
      bodyLines.push(`    plain['${targetKey}'] = instanceToPlain(inst['${sourceKey}'], options);`);
      bodyLines.push(`  }`);
    } else {
      let designType: any;
      if (typeof Reflect !== 'undefined' && typeof (Reflect as any).getMetadata === 'function') {
        designType = (Reflect as any).getMetadata('design:type', cls.prototype, prop.name);
      }

      if (designType === Date) {
        bodyLines.push(`  if (inst['${sourceKey}'] !== undefined) {`);
        bodyLines.push(`    const val = inst['${sourceKey}'];`);
        bodyLines.push(`    plain['${targetKey}'] = val != null && typeof val.toISOString === 'function' ? val.toISOString() : val;`);
        bodyLines.push(`  }`);
      } else {
        bodyLines.push(`  if (inst['${sourceKey}'] !== undefined) {`);
        bodyLines.push(`    const val = inst['${sourceKey}'];`);
        bodyLines.push(`    if (val != null && typeof val === 'object') {`);
        bodyLines.push(`      if (Array.isArray(val)) {`);
        bodyLines.push(`        plain['${targetKey}'] = val.map(item => (item && item.constructor && item.constructor !== Object) ? instanceToPlain(item, options) : item);`);
        bodyLines.push(`      } else if (val.constructor && val.constructor !== Object) {`);
        bodyLines.push(`        plain['${targetKey}'] = instanceToPlain(val, options);`);
        bodyLines.push(`      } else {`);
        bodyLines.push(`        plain['${targetKey}'] = val;`);
        bodyLines.push(`      }`);
        bodyLines.push(`    } else {`);
        bodyLines.push(`      plain['${targetKey}'] = val;`);
        bodyLines.push(`    }`);
        bodyLines.push(`  }`);
      }
    }
  });

  bodyLines.push("return plain;");

  const paramNames = Object.keys(context);
  const paramValues = Object.values(context);
  
  const functionBody = `
    return function(inst, options) {
      ${bodyLines.join('\n')}
    };
  `;

  const factory = new Function(...paramNames, functionBody);
  return factory(...paramValues);
}

export function plainToInstance<T, V>(cls: ClassConstructor<T>, plain: V[], options?: ClassTransformOptions): T[];
export function plainToInstance<T, V>(cls: ClassConstructor<T>, plain: V, options?: ClassTransformOptions): T;
export function plainToInstance<T, V>(cls: ClassConstructor<T>, plain: V | V[], options?: ClassTransformOptions): T | T[] {
  if (plain == null) return plain as any;

  if (Array.isArray(plain)) {
    let mappers = (cls as any).__fastMappers__;
    if (!mappers) {
      mappers = {};
      (cls as any).__fastMappers__ = mappers;
    }
    const key = getCacheKey(options);
    let mapper = mappers[key];
    if (!mapper) {
      mapper = buildJitMapper(cls, options);
      mappers[key] = mapper;
    }
    const len = plain.length;
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = mapper(plain[i], options);
    }
    return result;
  }

  let mappers = (cls as any).__fastMappers__;
  if (!mappers) {
    mappers = {};
    (cls as any).__fastMappers__ = mappers;
  }
  const key = getCacheKey(options);
  let mapper = mappers[key];
  if (!mapper) {
    mapper = buildJitMapper(cls, options);
    mappers[key] = mapper;
  }
  return mapper(plain, options);
}

export function instanceToPlain<T>(instance: T[], options?: ClassTransformOptions): Record<string, any>[];
export function instanceToPlain<T>(instance: T, options?: ClassTransformOptions): Record<string, any>;
export function instanceToPlain<T>(instance: T | T[], options?: ClassTransformOptions): Record<string, any> | Record<string, any>[] {
  if (instance == null) return instance as any;

  if (Array.isArray(instance)) {
    if (instance.length === 0) return [];
    const cls = (instance[0] as any).constructor as ClassConstructor<any>;
    let serializers = (cls as any).__fastSerializers__;
    if (!serializers) {
      serializers = {};
      (cls as any).__fastSerializers__ = serializers;
    }
    const key = getCacheKey(options);
    let serializer = serializers[key];
    if (!serializer) {
      serializer = buildJitSerializer(cls, options);
      serializers[key] = serializer;
    }
    const len = instance.length;
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = serializer(instance[i], options);
    }
    return result;
  }

  const cls = instance.constructor as ClassConstructor<any>;
  let serializers = (cls as any).__fastSerializers__;
  if (!serializers) {
    serializers = {};
    (cls as any).__fastSerializers__ = serializers;
  }
  const key = getCacheKey(options);
  let serializer = serializers[key];
  if (!serializer) {
    serializer = buildJitSerializer(cls, options);
    serializers[key] = serializer;
  }
  return serializer(instance, options);
}

export function instanceToInstance<T>(instance: T[], options?: ClassTransformOptions): T[];
export function instanceToInstance<T>(instance: T, options?: ClassTransformOptions): T;
export function instanceToInstance<T>(instance: T | T[], options?: ClassTransformOptions): T | T[] {
  if (instance == null) return instance as any;

  if (Array.isArray(instance)) {
    const len = instance.length;
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = instanceToInstance(instance[i], options);
    }
    return result as any;
  }

  const plain = instanceToPlain(instance, options);
  return plainToInstance(instance.constructor as ClassConstructor<T>, plain, options);
}

// NestJS compatible validation/transformation Pipe that maps payload using JIT
export class FastMapPipe {
  constructor(private readonly cls: ClassConstructor<any>, private readonly options?: ClassTransformOptions) {}

  transform(value: any) {
    return plainToInstance(this.cls, value, this.options);
  }

  static get(cls: ClassConstructor<any>, options?: ClassTransformOptions) {
    return new FastMapPipe(cls, options);
  }
}
