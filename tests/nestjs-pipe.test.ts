import 'reflect-metadata';
import {
  IsString,
  IsInt,
  Min,
  Max,
  IsEmail,
  IsOptional,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { Expose, Type } from '../src/decorators';
import { FastValidationPipe } from '../src/nestjs/validation-pipe';

// Custom validator constraint to test fallback execution
@ValidatorConstraint({ name: 'isEvenNumber', async: false })
class IsEvenNumberConstraint implements ValidatorConstraintInterface {
  validate(value: any) {
    return typeof value === 'number' && value % 2 === 0;
  }
  defaultMessage(args: ValidationArguments) {
    return `${args.property} must be an even number`;
  }
}

class UserDto {
  @Expose()
  @IsString()
  username!: string;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(99)
  age!: number;

  @Expose()
  @IsEmail()
  email!: string;

  @Expose()
  @IsOptional()
  @Validate(IsEvenNumberConstraint)
  luckyNumber?: number;
}

describe('FastValidationPipe (NestJS Integration)', () => {
  let pipe: FastValidationPipe;

  beforeEach(() => {
    pipe = new FastValidationPipe();
  });

  describe('toValidate Parameter Guards', () => {
    it('should bypass validation for primitive String', async () => {
      const result = await pipe.transform('123', {
        type: 'param',
        metatype: String,
        data: 'id',
      });
      expect(result).toBe('123');
    });

    it('should bypass validation for primitive Number', async () => {
      const result = await pipe.transform(42, {
        type: 'query',
        metatype: Number,
        data: 'limit',
      });
      expect(result).toBe(42);
    });

    it('should bypass validation when metatype is missing or undefined', async () => {
      const rawObj = { foo: 'bar' };
      const result = await pipe.transform(rawObj, {
        type: 'custom',
        metatype: undefined,
      });
      expect(result).toBe(rawObj);
    });
  });

  describe('Happy Path Validation & Type Coercion', () => {
    it('should coerce string numbers to integer and validate successfully', async () => {
      const payload = {
        username: 'alice',
        age: '25', // string coerced to number via @Type(() => Number)
        email: 'alice@example.com',
        luckyNumber: 42,
      };

      const result = await pipe.transform(payload, {
        type: 'body',
        metatype: UserDto,
      });

      expect(result).toBeInstanceOf(UserDto);
      expect(result.username).toBe('alice');
      expect(result.age).toBe(25);
      expect(typeof result.age).toBe('number');
      expect(result.email).toBe('alice@example.com');
      expect(result.luckyNumber).toBe(42);
    });

    it('should handle optional properties when omitted', async () => {
      const payload = {
        username: 'bob',
        age: 30,
        email: 'bob@example.com',
      };

      const result = await pipe.transform(payload, {
        type: 'body',
        metatype: UserDto,
      });

      expect(result).toBeInstanceOf(UserDto);
      expect(result.luckyNumber).toBeUndefined();
    });
  });

  describe('Unhappy Path Error Reporting & Parity', () => {
    it('should throw BadRequestException when payload is invalid', async () => {
      const invalidPayload = {
        username: 123,
        age: 12, // < 18
        email: 'not-an-email',
      };

      try {
        await pipe.transform(invalidPayload, {
          type: 'body',
          metatype: UserDto,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = err.getResponse();
        expect(response.message).toBeInstanceOf(Array);
        expect(response.message.length).toBe(3);

        const errorMap = new Map(response.message.map((e: any) => [e.property, e.constraints]));
        expect(errorMap.has('username')).toBe(true);
        expect(errorMap.has('age')).toBe(true);
        expect(errorMap.has('email')).toBe(true);
      }
    });

    it('should trigger custom validator constraint error', async () => {
      const payload = {
        username: 'charlie',
        age: 20,
        email: 'charlie@example.com',
        luckyNumber: 7, // Odd number, fails IsEvenNumberConstraint
      };

      try {
        await pipe.transform(payload, {
          type: 'body',
          metatype: UserDto,
        });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = err.getResponse();
        const luckyErr = response.message.find((e: any) => e.property === 'luckyNumber');
        expect(luckyErr).toBeDefined();
        expect(luckyErr.constraints).toBeDefined();
      }
    });
  });

  describe('Whitelisting & Forbid Non-Whitelisted Options', () => {
    it('should strip extraneous fields when whitelist is true', async () => {
      const whitelistPipe = new FastValidationPipe({ whitelist: true });
      const payload = {
        username: 'david',
        age: 28,
        email: 'david@example.com',
        extraField: 'hacker_payload',
      };

      const result = await whitelistPipe.transform(payload, {
        type: 'body',
        metatype: UserDto,
      });

      expect(result).toBeInstanceOf(UserDto);
      expect((result as any).extraField).toBeUndefined();
    });

    it('should throw an error for extraneous fields when forbidNonWhitelisted is true', async () => {
      const strictPipe = new FastValidationPipe({ forbidNonWhitelisted: true });
      const payload = {
        username: 'eve',
        age: 35,
        email: 'eve@example.com',
        maliciousKey: 'attack',
      };

      try {
        await strictPipe.transform(payload, {
          type: 'body',
          metatype: UserDto,
        });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = err.getResponse();
        const unwhitelistedErr = response.message.find((e: any) => e.property === 'maliciousKey');
        expect(unwhitelistedErr).toBeDefined();
        expect(unwhitelistedErr.constraints.isWhitelisted).toContain('maliciousKey should not exist');
      }
    });
  });

  describe('Custom Exception Factory', () => {
    it('should call custom exceptionFactory when provided', async () => {
      class CustomHttpError extends Error {
        constructor(public validationErrors: any[]) {
          super('Custom Error');
        }
      }

      const customPipe = new FastValidationPipe({
        exceptionFactory: (errors) => new CustomHttpError(errors),
      });

      const invalidPayload = {
        username: 123,
      };

      await expect(
        customPipe.transform(invalidPayload, {
          type: 'body',
          metatype: UserDto,
        })
      ).rejects.toThrow(CustomHttpError);
    });
  });

  describe('Zero-Migration Standard NestJS DTOs & Interop', () => {
    it('should validate and transform standard DTOs that only use class-validator decorators', async () => {
      class StandardCatDto {
        @IsString()
        name!: string;

        @IsInt()
        @Min(0)
        age!: number;
      }

      const pipe = new FastValidationPipe({ whitelist: true });
      const validPayload = { name: 'Milo', age: 3, extraneous: 'remove_me' };
      const res = await pipe.transform(validPayload, {
        type: 'body',
        metatype: StandardCatDto,
      });

      expect(res).toBeInstanceOf(StandardCatDto);
      expect(res.name).toBe('Milo');
      expect(res.age).toBe(3);
      expect((res as any).extraneous).toBeUndefined();
    });

    it('should throw validation errors for standard DTOs when constraints are violated', async () => {
      class StandardCatDto {
        @IsString()
        name!: string;

        @IsInt()
        @Min(0)
        age!: number;
      }

      const pipe = new FastValidationPipe();
      const invalidPayload = { name: 12345, age: -1 };

      await expect(
        pipe.transform(invalidPayload, {
          type: 'body',
          metatype: StandardCatDto,
        })
      ).rejects.toThrow(BadRequestException);
    });
  });
});
