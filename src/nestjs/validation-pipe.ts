import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { plainToInstance, ClassTransformOptions, FastValidationError, ClassConstructor } from '../runtime';

export interface FastValidationPipeOptions {
  /**
   * If true, plain JSON is transformed into an instance of the target DTO class.
   * Default: true
   */
  transform?: boolean;

  /**
   * If true, strips properties not decorated with `@Expose()` or validation decorators.
   * Default: false
   */
  whitelist?: boolean;

  /**
   * If true, stops validation and throws an error when non-whitelisted properties are present.
   * Default: false
   */
  forbidNonWhitelisted?: boolean;

  /**
   * Specific validation groups to execute.
   */
  groups?: string[];

  /**
   * Custom exception factory to override the default BadRequestException.
   */
  exceptionFactory?: (errors: any[]) => any;
}

@Injectable()
export class FastValidationPipe implements PipeTransform<any> {
  protected isTransformEnabled: boolean;
  protected isWhitelistEnabled: boolean;
  protected isForbidNonWhitelisted: boolean;
  protected groups?: string[];
  protected exceptionFactory: (errors: any[]) => any;

  constructor(options?: FastValidationPipeOptions) {
    this.isTransformEnabled = options?.transform !== false;
    this.isWhitelistEnabled = !!options?.whitelist;
    this.isForbidNonWhitelisted = !!options?.forbidNonWhitelisted;
    this.groups = options?.groups;
    this.exceptionFactory =
      options?.exceptionFactory ||
      ((errors) => new BadRequestException(errors));
  }

  public async transform(value: any, metadata: ArgumentMetadata): Promise<any> {
    if (!this.toValidate(metadata)) {
      return value;
    }

    const metatype = metadata.metatype as ClassConstructor<any> | undefined;
    if (!metatype) {
      return value;
    }

    const transformOptions: ClassTransformOptions = {
      validate: true,
      whitelist: this.isWhitelistEnabled,
      forbidNonWhitelisted: this.isForbidNonWhitelisted,
      groups: this.groups,
    };

    try {
      const entity = plainToInstance(metatype, value, transformOptions);
      if (entity && typeof (entity as any).then === 'function') {
        return await entity;
      }
      return entity;
    } catch (err: any) {
      if (err instanceof FastValidationError || err.isValidationError) {
        throw this.exceptionFactory(err.errors);
      }
      throw err;
    }
  }

  /**
   * Checks whether the metadata represents a class DTO that requires validation.
   * Primitives and standard untyped JavaScript constructors are skipped.
   */
  protected toValidate(metadata: ArgumentMetadata): boolean {
    const { metatype } = metadata;
    if (!metatype) {
      return false;
    }
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
