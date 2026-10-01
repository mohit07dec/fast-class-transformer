import { defaultMetadataStorage } from './metadata';

export type ClassConstructor<T> = new (...args: any[]) => T;

export interface ClassTransformOptions {
  excludeExtraneousValues?: boolean;
  whitelist?: boolean;
  forbidNonWhitelisted?: boolean;
  groups?: string[];
  version?: number;
  exposeDefaultValues?: boolean;
  exposeUnsetFields?: boolean;
  strategy?: 'excludeAll' | 'exposeAll';
  enableCircularCheck?: boolean;
  validate?: boolean; // Enable single-pass compiled validation
  stopAtFirstError?: boolean;
}

export class FastValidationError extends Error {
  isValidationError = true;
  constructor(public errors: any[]) {
    super('Validation failed');
  }
}

const MAX_CACHE_SIZE = 128;

function getCacheKey(options?: ClassTransformOptions): string {
  if (!options) return 'default';
  const parts: string[] = [];
  if (options.groups) parts.push(`g:${options.groups.slice().sort().join(',')}`);
  if (options.version !== undefined) parts.push(`v:${options.version}`);
  if (options.excludeExtraneousValues) parts.push(`ee:1`);
  if (options.whitelist) parts.push(`wl:1`);
  if (options.forbidNonWhitelisted) parts.push(`fnw:1`);
  if (options.exposeDefaultValues !== undefined) parts.push(`ed:${options.exposeDefaultValues ? 1 : 0}`);
  if (options.exposeUnsetFields !== undefined) parts.push(`eu:${options.exposeUnsetFields ? 1 : 0}`);
  if (options.strategy) parts.push(`s:${options.strategy}`);
  if (options.enableCircularCheck) parts.push(`cc:1`);
  if (options.validate) parts.push(`val:1`);
  return parts.length ? parts.join('|') : 'default';
}

const validatorGen: Record<string, (targetKey: string, constraints: any[], customMsg?: string) => string> = {
  isString: (tgt, _, msg) => `if (typeof inst['${tgt}'] !== 'string') {
    errors.push({ property: '${tgt}', constraints: { isString: ${msg || `'${tgt} must be a string'`} }, value: inst['${tgt}'] });
  }`,
  isNumber: (tgt, _, msg) => `if (typeof inst['${tgt}'] !== 'number' || isNaN(inst['${tgt}'])) {
    errors.push({ property: '${tgt}', constraints: { isNumber: ${msg || `'${tgt} must be a number'`} }, value: inst['${tgt}'] });
  }`,
  isInt: (tgt, _, msg) => `if (typeof inst['${tgt}'] !== 'number' || !Number.isInteger(inst['${tgt}'])) {
    errors.push({ property: '${tgt}', constraints: { isInt: ${msg || `'${tgt} must be an integer'`} }, value: inst['${tgt}'] });
  }`,
  isBoolean: (tgt, _, msg) => `if (typeof inst['${tgt}'] !== 'boolean') {
    errors.push({ property: '${tgt}', constraints: { isBoolean: ${msg || `'${tgt} must be a boolean'`} }, value: inst['${tgt}'] });
  }`,
  isNotEmpty: (tgt, _, msg) => `if (inst['${tgt}'] === null || inst['${tgt}'] === undefined || inst['${tgt}'] === '') {
    errors.push({ property: '${tgt}', constraints: { isNotEmpty: ${msg || `'${tgt} should not be empty'`} }, value: inst['${tgt}'] });
  }`,
  isArray: (tgt, _, msg) => `if (!Array.isArray(inst['${tgt}'])) {
    errors.push({ property: '${tgt}', constraints: { isArray: ${msg || `'${tgt} must be an array'`} }, value: inst['${tgt}'] });
  }`,
  min: (tgt, constr, msg) => `if (typeof inst['${tgt}'] === 'number' && inst['${tgt}'] < ${constr[0]}) {
    errors.push({ property: '${tgt}', constraints: { min: ${msg || `'${tgt} must not be less than ${constr[0]}'`} }, value: inst['${tgt}'] });
  }`,
  max: (tgt, constr, msg) => `if (typeof inst['${tgt}'] === 'number' && inst['${tgt}'] > ${constr[0]}) {
    errors.push({ property: '${tgt}', constraints: { max: ${msg || `'${tgt} must not be greater than ${constr[0]}'`} }, value: inst['${tgt}'] });
  }`,
  isEmail: (tgt, _, msg) => `if (typeof inst['${tgt}'] !== 'string' || !/\\S+@\\S+\\.\\S+/.test(inst['${tgt}'])) {
    errors.push({ property: '${tgt}', constraints: { isEmail: ${msg || `'${tgt} must be an email'`} }, value: inst['${tgt}'] });
  }`,
  isDateString: (tgt, _, msg) => `if (typeof inst['${tgt}'] !== 'string' || isNaN(Date.parse(inst['${tgt}']))) {
    errors.push({ property: '${tgt}', constraints: { isDateString: ${msg || `'${tgt} must be a valid ISO 8601 date string'`} }, value: inst['${tgt}'] });
  }`
};

function buildJitMapper<T>(cls: ClassConstructor<T>, options?: ClassTransformOptions): (plain: any, options?: ClassTransformOptions, stack?: Set<any>) => T {
  const props = defaultMetadataStorage.getAncestorMetadata(cls);

  let validationRules = new Map<string, any[]>();
  try {
    const { getMetadataStorage } = require('class-validator');
    const storage = getMetadataStorage();
    const metadatas = storage.getTargetValidationMetadatas(cls, null, false, false);
    if (metadatas) {
      for (let i = 0; i < metadatas.length; i++) {
        const meta = metadatas[i];
        let rules = validationRules.get(meta.propertyName);
        if (!rules) {
          rules = [];
          validationRules.set(meta.propertyName, rules);
        }
        rules.push(meta);
      }
    }
  } catch (e) {
    // class-validator is not installed
  }

  const bodyLines: string[] = [];
  bodyLines.push("if (plain == null) return plain;");
  
  // Dynamic Circular Reference prevention
  if (options?.enableCircularCheck) {
    bodyLines.push("if (stack && stack.has(plain)) return undefined;");
    bodyLines.push("if (!stack) stack = new Set();");
    bodyLines.push("stack.add(plain);");
  }

  const groups = options?.groups;
  const version = options?.version;
  const excludeExtraneous = options?.excludeExtraneousValues || options?.strategy === 'excludeAll';
  const exposeDefaultValues = options?.exposeDefaultValues !== false;
  const exposeUnsetFields = options?.exposeUnsetFields !== false;

  bodyLines.push("const errors = [];");
  bodyLines.push("const inst = new cls();");

  const context: Record<string, any> = {
    cls,
    plainToInstance,
    FastValidationError,
  };

  if (options?.forbidNonWhitelisted) {
    const allowedKeys = props.map(p => p.expose?.name || p.name);
    context.allowedKeysSet = new Set(allowedKeys);
    bodyLines.push(`  if (options && options.forbidNonWhitelisted && typeof plain === 'object' && plain !== null) {`);
    bodyLines.push(`    for (const key of Object.keys(plain)) {`);
    bodyLines.push(`      if (!allowedKeysSet.has(key)) {`);
    bodyLines.push(`        errors.push({ property: key, value: plain[key], constraints: { isWhitelisted: 'property ' + key + ' should not exist' } });`);
    bodyLines.push(`      }`);
    bodyLines.push(`    }`);
    bodyLines.push(`  }`);
  }

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

    // Property mapping expression builder
    let assignExpr = '';
    if (prop.transformFn) {
      const transformKey = `transform_${idx}`;
      context[transformKey] = prop.transformFn;
      assignExpr = `${transformKey}({ value: plain['${sourceKey}'], key: '${sourceKey}', obj: plain, type: 1, options })`;
    } else if (prop.typeFn) {
      const typeKey = `type_${idx}`;
      context[typeKey] = prop.typeFn;
      assignExpr = `(() => {
        const val = plain['${sourceKey}'];
        if (val == null) return val;
        const subClass = ${typeKey}();
        if (subClass) {
          if (subClass === Number) {
            return Array.isArray(val) ? val.map(v => v == null ? v : Number(v)) : Number(val);
          }
          if (subClass === String) {
            return Array.isArray(val) ? val.map(v => v == null ? v : String(val)) : String(val);
          }
          if (subClass === Boolean) {
            return Array.isArray(val) ? val.map(v => v == null ? v : Boolean(v)) : Boolean(val);
          }
          if (subClass === Date) {
            return Array.isArray(val) ? val.map(v => v == null ? v : new Date(val)) : new Date(val);
          }
          return plainToInstance(subClass, val, options, stack);
        }
        return val;
      })()`;
    } else {
      let designType: any;
      if (typeof Reflect !== 'undefined' && typeof (Reflect as any).getMetadata === 'function') {
        designType = (Reflect as any).getMetadata('design:type', cls.prototype, prop.name);
      }

      if (designType === Date) {
        assignExpr = `plain['${sourceKey}'] != null ? new Date(plain['${sourceKey}']) : plain['${sourceKey}']`;
      } else if (designType && designType !== Object && designType !== Array && designType !== String && designType !== Number && designType !== Boolean) {
        const typeKey = `type_${idx}`;
        context[typeKey] = () => designType;
        assignExpr = `(() => {
          const subClass = ${typeKey}();
          if (subClass) {
            return plainToInstance(subClass, plain['${sourceKey}'], options, stack);
          }
          return plain['${sourceKey}'];
        })()`;
      } else {
        assignExpr = `plain['${sourceKey}']`;
      }
    }

    // Step 1: Standard compliance property writer
    if (exposeUnsetFields) {
      if (exposeDefaultValues) {
        bodyLines.push(`  if (plain['${sourceKey}'] !== undefined) {`);
        bodyLines.push(`    inst['${targetKey}'] = ${assignExpr};`);
        bodyLines.push(`  } else if (inst['${targetKey}'] === undefined) {`);
        bodyLines.push(`    inst['${targetKey}'] = undefined;`);
        bodyLines.push(`  }`);
      } else {
        bodyLines.push(`  inst['${targetKey}'] = plain['${sourceKey}'] !== undefined ? ${assignExpr} : undefined;`);
      }
    } else {
      if (exposeDefaultValues) {
        bodyLines.push(`  if (plain['${sourceKey}'] !== undefined) {`);
        bodyLines.push(`    inst['${targetKey}'] = ${assignExpr};`);
        bodyLines.push(`  }`);
      } else {
        bodyLines.push(`  if (plain['${sourceKey}'] !== undefined) {`);
        bodyLines.push(`    inst['${targetKey}'] = ${assignExpr};`);
        bodyLines.push(`  } else {`);
        bodyLines.push(`    delete inst['${targetKey}'];`);
        bodyLines.push(`  }`);
      }
    }

    // Step 2: Transform-Before-Validate sequencing (Validate on inst[targetKey])
    const rules = validationRules.get(prop.name);
    if (rules && rules.length > 0) {
      bodyLines.push(`  if (options && options.validate) {`);
      const isOptional = rules.some(r => (r.name || r.type) === 'isOptional');
      if (isOptional) {
        bodyLines.push(`    if (inst['${targetKey}'] !== undefined && inst['${targetKey}'] !== null) {`);
      }
      rules.forEach((rule, rIdx) => {
        const type = rule.name || rule.type;
        if (type === 'isOptional') return;
        const constr = rule.constraints || [];
        let msgExpr: string | undefined;
        if (typeof rule.message === 'string') {
          msgExpr = JSON.stringify(rule.message);
        } else if (typeof rule.message === 'function') {
          const fnKey = `msgFn_${idx}_${rIdx}`;
          context[fnKey] = rule.message;
          msgExpr = `${fnKey}({ target: inst, value: inst['${targetKey}'], property: '${targetKey}', constraints: ${JSON.stringify(constr)} })`;
        }

        const gen = validatorGen[type];
        if (gen) {
          bodyLines.push('      ' + gen(targetKey, constr, msgExpr));
        } else if (rule.constraintCls) {
          const constraintKey = `customConstraint_${idx}_${rIdx}`;
          try {
            context[constraintKey] = new rule.constraintCls();
            bodyLines.push(`      const valid_${idx}_${rIdx} = ${constraintKey}.validate(inst['${targetKey}'], { object: inst, value: inst['${targetKey}'], property: '${targetKey}', constraints: ${JSON.stringify(constr)} });`);
            bodyLines.push(`      if (!valid_${idx}_${rIdx}) {`);
            bodyLines.push(`        errors.push({ property: '${targetKey}', constraints: { [${constraintKey}.name || '${type}']: ${msgExpr || `'${targetKey} failed ${type} validation'`} }, value: inst['${targetKey}'] });`);
            bodyLines.push(`      }`);
          } catch (e) {
            // Ignore if constraint cannot be constructed
          }
        }
      });
      if (isOptional) {
        bodyLines.push(`    }`);
      }
      bodyLines.push(`  }`);
    }
  });

  bodyLines.push(`  if (options && options.validate && errors.length > 0) {`);
  bodyLines.push(`    throw new FastValidationError(errors);`);
  bodyLines.push(`  }`);

  if (options?.enableCircularCheck) {
    bodyLines.push("stack.delete(plain);");
  }

  bodyLines.push("return inst;");

  const paramNames = Object.keys(context);
  const paramValues = Object.values(context);
  
  const functionBody = `
    return function(plain, options, stack) {
      ${bodyLines.join('\n')}
    };
  `;

  const factory = new Function(...paramNames, functionBody);
  return factory(...paramValues);
}

function buildJitSerializer<T>(cls: ClassConstructor<T>, options?: ClassTransformOptions): (inst: T, options?: ClassTransformOptions, stack?: Set<any>) => Record<string, any> {
  const props = defaultMetadataStorage.getAncestorMetadata(cls);

  if (props.length === 0) {
    return function (inst: any, options, stack) {
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
            plain[key] = instanceToPlain(val, options, stack);
          } else if (Array.isArray(val)) {
            plain[key] = val.map(item => (item && item.constructor && item.constructor !== Object) ? instanceToPlain(item, options, stack) : item);
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

  if (options?.enableCircularCheck) {
    bodyLines.push("if (stack && stack.has(inst)) return undefined;");
    bodyLines.push("if (!stack) stack = new Set();");
    bodyLines.push("stack.add(inst);");
  }

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
      bodyLines.push(`    plain['${targetKey}'] = ${transformKey}({ value: inst['${sourceKey}'], key: '${sourceKey}', obj: inst, type: 2, options });`);
      bodyLines.push(`  }`);
    } else if (prop.typeFn) {
      bodyLines.push(`  if (inst['${sourceKey}'] !== undefined) {`);
      bodyLines.push(`    plain['${targetKey}'] = instanceToPlain(inst['${sourceKey}'], options, stack);`);
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
        bodyLines.push(`        plain['${targetKey}'] = val.map(item => (item && item.constructor && item.constructor !== Object) ? instanceToPlain(item, options, stack) : item);`);
        bodyLines.push(`      } else if (val.constructor && val.constructor !== Object) {`);
        bodyLines.push(`        plain['${targetKey}'] = instanceToPlain(val, options, stack);`);
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

  if (options?.enableCircularCheck) {
    bodyLines.push("stack.delete(inst);");
  }

  bodyLines.push("return plain;");

  const paramNames = Object.keys(context);
  const paramValues = Object.values(context);
  
  const functionBody = `
    return function(inst, options, stack) {
      ${bodyLines.join('\n')}
    };
  `;

  const factory = new Function(...paramNames, functionBody);
  return factory(...paramValues);
}

export function plainToInstance<T, V>(cls: ClassConstructor<T>, plain: V[], options?: ClassTransformOptions, stack?: Set<any>): T[];
export function plainToInstance<T, V>(cls: ClassConstructor<T>, plain: V, options?: ClassTransformOptions, stack?: Set<any>): T;
export function plainToInstance<T, V>(cls: ClassConstructor<T>, plain: V | V[], options?: ClassTransformOptions, stack?: Set<any>): T | T[] {
  if (plain == null) return plain as any;

  if (cls === (Number as any)) {
    return (Array.isArray(plain) ? plain.map(v => v == null ? v : Number(v)) : Number(plain)) as any;
  }
  if (cls === (String as any)) {
    return (Array.isArray(plain) ? plain.map(v => v == null ? v : String(v)) : String(plain)) as any;
  }
  if (cls === (Boolean as any)) {
    return (Array.isArray(plain) ? plain.map(v => v == null ? v : Boolean(v)) : Boolean(plain)) as any;
  }
  if (cls === (Date as any)) {
    return (Array.isArray(plain) ? plain.map(v => v == null ? v : new Date(v as any)) : new Date(plain as any)) as any;
  }

  if (Array.isArray(plain)) {
    let mappers = (cls as any).__fastMappers__;
    if (!mappers) {
      mappers = new Map<string, Function>();
      (cls as any).__fastMappers__ = mappers;
    }
    const key = getCacheKey(options);
    let mapper = mappers.get(key);
    if (!mapper) {
      if (mappers.size >= MAX_CACHE_SIZE) {
        mappers.clear();
      }
      mapper = buildJitMapper(cls, options);
      mappers.set(key, mapper);
    }
    const len = plain.length;
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = mapper(plain[i], options, stack);
    }
    return result;
  }

  let mappers = (cls as any).__fastMappers__;
  if (!mappers) {
    mappers = new Map<string, Function>();
    (cls as any).__fastMappers__ = mappers;
  }
  const key = getCacheKey(options);
  let mapper = mappers.get(key);
  if (!mapper) {
    if (mappers.size >= MAX_CACHE_SIZE) {
      mappers.clear();
    }
    mapper = buildJitMapper(cls, options);
    mappers.set(key, mapper);
  }
  return mapper(plain, options, stack);
}

export function instanceToPlain<T>(instance: T[], options?: ClassTransformOptions, stack?: Set<any>): Record<string, any>[];
export function instanceToPlain<T>(instance: T, options?: ClassTransformOptions, stack?: Set<any>): Record<string, any>;
export function instanceToPlain<T>(instance: T | T[], options?: ClassTransformOptions, stack?: Set<any>): Record<string, any> | Record<string, any>[] {
  if (instance == null || typeof instance !== 'object') return instance as any;
  if (instance instanceof Date) return instance.toISOString() as any;

  if (Array.isArray(instance)) {
    if (instance.length === 0) return [];
    const cls = (instance[0] as any).constructor as ClassConstructor<any>;
    let serializers = (cls as any).__fastSerializers__;
    if (!serializers) {
      serializers = new Map<string, Function>();
      (cls as any).__fastSerializers__ = serializers;
    }
    const key = getCacheKey(options);
    let serializer = serializers.get(key);
    if (!serializer) {
      if (serializers.size >= MAX_CACHE_SIZE) {
        serializers.clear();
      }
      serializer = buildJitSerializer(cls, options);
      serializers.set(key, serializer);
    }
    const len = instance.length;
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = serializer(instance[i], options, stack);
    }
    return result;
  }

  const cls = instance.constructor as ClassConstructor<any>;
  let serializers = (cls as any).__fastSerializers__;
  if (!serializers) {
    serializers = new Map<string, Function>();
    (cls as any).__fastSerializers__ = serializers;
  }
  const key = getCacheKey(options);
  let serializer = serializers.get(key);
  if (!serializer) {
    if (serializers.size >= MAX_CACHE_SIZE) {
      serializers.clear();
    }
    serializer = buildJitSerializer(cls, options);
    serializers.set(key, serializer);
  }
  return serializer(instance, options, stack);
}

export function instanceToInstance<T>(instance: T[], options?: ClassTransformOptions, stack?: Set<any>): T[];
export function instanceToInstance<T>(instance: T, options?: ClassTransformOptions, stack?: Set<any>): T;
export function instanceToInstance<T>(instance: T | T[], options?: ClassTransformOptions, stack?: Set<any>): T | T[] {
  if (instance == null) return instance as any;

  if (Array.isArray(instance)) {
    const len = instance.length;
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = instanceToInstance(instance[i], options, stack);
    }
    return result as any;
  }

  const plain = instanceToPlain(instance, options, stack);
  return plainToInstance(instance.constructor as ClassConstructor<T>, plain, options, stack);
}

export class FastMapPipe {
  constructor(private readonly cls: ClassConstructor<any>, private readonly options?: ClassTransformOptions) {}

  transform(value: any) {
    try {
      return plainToInstance(this.cls, value, { ...this.options, validate: true });
    } catch (e: any) {
      if (e.isValidationError) {
        try {
          const { BadRequestException } = require('@nestjs/common');
          throw new BadRequestException(e.errors);
        } catch {
          throw e;
        }
      }
      throw e;
    }
  }

  static get(cls: ClassConstructor<any>, options?: ClassTransformOptions) {
    return new FastMapPipe(cls, options);
  }
}
