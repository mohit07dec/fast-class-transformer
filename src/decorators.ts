import { defaultMetadataStorage, ExposeOptions, ExcludeOptions, TransformFnParams, TransformOptions } from './metadata';

export function Expose(options?: ExposeOptions): PropertyDecorator & MethodDecorator {
  return function (target: any, propertyKey?: string | symbol) {
    if (typeof propertyKey === 'string') {
      const prop = defaultMetadataStorage.getOrCreateProp(target, propertyKey);
      prop.expose = options || {};
    }
  };
}

export function Exclude(options?: ExcludeOptions): PropertyDecorator & MethodDecorator {
  return function (target: any, propertyKey?: string | symbol) {
    if (typeof propertyKey === 'string') {
      const prop = defaultMetadataStorage.getOrCreateProp(target, propertyKey);
      prop.exclude = options || {};
    }
  };
}

export function Type(typeFunction: () => Function): PropertyDecorator {
  return function (target: any, propertyKey: string | symbol) {
    if (typeof propertyKey === 'string') {
      const prop = defaultMetadataStorage.getOrCreateProp(target, propertyKey);
      prop.typeFn = typeFunction;
    }
  };
}

export function Transform(
  transformFn: (params: TransformFnParams) => any,
  options?: TransformOptions
): PropertyDecorator {
  return function (target: any, propertyKey: string | symbol) {
    if (typeof propertyKey === 'string') {
      const prop = defaultMetadataStorage.getOrCreateProp(target, propertyKey);
      prop.transformFn = transformFn;
      prop.transformOptions = options;
    }
  };
}

// @FastMap parameter decorator for NestJS integration.
// Can be used as @FastMap() or @FastMap(ClassToMap).
export function FastMap(typeFn?: any): ParameterDecorator {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) {
    // If reflect-metadata is available, we can store the parameter mapping metadata
    if (typeof Reflect !== 'undefined' && typeof (Reflect as any).defineMetadata === 'function' && propertyKey) {
      const existingParameters = (Reflect as any).getMetadata('fast-class-transformer:fastmap', target, propertyKey) || [];
      existingParameters.push({
        index: parameterIndex,
        typeFn: typeFn
      });
      (Reflect as any).defineMetadata('fast-class-transformer:fastmap', existingParameters, target, propertyKey);
    }
  };
}
