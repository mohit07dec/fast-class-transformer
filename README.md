# fast-class-transformer

[![CI](https://github.com/mohit07dec/fast-class-transformer/actions/workflows/ci.yml/badge.svg)](https://github.com/mohit07dec/fast-class-transformer/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/fast-class-transformer.svg)](https://www.npmjs.com/package/fast-class-transformer)
[![npm downloads](https://img.shields.io/npm/dm/fast-class-transformer.svg)](https://www.npmjs.com/package/fast-class-transformer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A zero-dependency, ultra-fast alternative to [`class-transformer`](https://github.com/typestack/class-transformer) for TypeScript and NestJS.

`fast-class-transformer` uses a **JIT compilation** approach: on first use of a class, it compiles a dedicated, statically shaped mapping function for that class and caches it. All subsequent calls use the cached function at near-native JavaScript speed. This avoids the per-request reflection and metadata traversal that makes `class-transformer` slow.

## Table of contents

- [Performance](#performance)
- [Why is it fast?](#why-is-it-fast)
- [Installation](#installation)
- [Drop-in replacement for class-transformer](#drop-in-replacement-for-class-transformer)
  - [plainToInstance](#plaintoinstance)
  - [instanceToPlain](#instancetoplain)
  - [instanceToInstance](#instancetoinstance)
- [Decorators](#decorators)
  - [@Expose](#expose)
  - [@Exclude](#exclude)
  - [@Type](#type)
  - [@Transform](#transform)
- [Transformation options](#transformation-options)
- [NestJS integration](#nestjs-integration)
  - [FastValidationPipe (global drop-in)](#fastvalidationpipe-global-drop-in)
  - [@FastMap (endpoint-level)](#fastmap-endpoint-level)
- [Ahead-of-Time (AOT) compiler plugin](#ahead-of-time-aot-compiler-plugin)
- [Samples](#samples)

---

## Performance

Benchmarks run using [`mitata`](https://github.com/evanwashere/mitata) on Bun 1.3.0 (Intel i5-12500H), 100,000 iterations, JIT-warmed, `do_not_optimize` applied, 1,024 payload instances rotated to prevent constant propagation:

| Workload | class-transformer | fast-class-transformer | Speedup |
| :--- | ---: | ---: | ---: |
| Flat DTO mapping | 2.29 µs/iter | 17.08 ns/iter | **134x** |
| Nested DTO mapping | 3.25 µs/iter | 53.53 ns/iter | **60x** |
| Array mapping (100 items) | 228.78 µs/iter | 1.23 µs/iter | **186x** |
| Validation + mapping | 2.97 µs/iter | 45.98 ns/iter | **64x** |
| NestJS ValidationPipe | 6.53 µs/iter | 365.15 ns/iter | **18x** |

---

## Why is it fast?

**1. V8 hidden class optimization.**
V8 internally creates "hidden classes" (shapes) to optimize property access on objects. `class-transformer` assigns properties inside `for...in` loops with dynamic string keys (`inst[key] = value`), which degrades instances to slow dictionary mode. `fast-class-transformer` compiles a dedicated function per DTO that assigns properties in a fixed, declared order (`inst.prop = value`), preserving V8's hidden class optimizations.

**2. Zero runtime reflection.**
Standard `class-transformer` traverses metadata arrays and resolves decorator configurations on every request. `fast-class-transformer` evaluates decorators once at JIT compile time, generates a static JavaScript function, and caches it. All subsequent calls execute that compiled function directly.

**3. Monomorphic inline caches.**
`class-transformer` routes all DTO types through a single generic transformer function, which becomes megamorphic and kills V8's inline caches. Each class gets its own independently compiled, monomorphic function here.

**4. No allocations on the hot path.**
Temporary metadata arrays, mapping closures, and helper objects are not allocated per-request — they are computed once during JIT compilation and closed over.

---

## Installation

```bash
npm install fast-class-transformer reflect-metadata
```

```bash
bun add fast-class-transformer reflect-metadata
```

Add to your application entry point (e.g., `main.ts`):

```typescript
import 'reflect-metadata';
```

And set the following in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

---

## Drop-in replacement for class-transformer

Change your imports and everything works:

```typescript
// Before
import { plainToInstance, instanceToPlain, Expose, Type } from 'class-transformer';

// After
import { plainToInstance, instanceToPlain, Expose, Type } from 'fast-class-transformer';
```

### plainToInstance

Transforms a plain JavaScript object into a class instance. Respects `@Expose`, `@Exclude`, `@Type`, and `@Transform` decorators. Supports arrays.

```typescript
import { plainToInstance, Expose, Type, Transform } from 'fast-class-transformer';

class Profile {
  @Expose()
  bio: string;

  @Expose()
  avatar: string;
}

class User {
  @Expose()
  id: number;

  @Expose({ name: 'first_name' })
  firstName: string;

  @Exclude()
  password: string;

  @Expose()
  @Type(() => Profile)
  profile: Profile;

  @Expose()
  @Transform(({ value }) => value.toUpperCase())
  role: string;
}

const raw = {
  id: 42,
  first_name: 'Jane',
  password: 'secret',
  profile: { bio: 'Engineer', avatar: 'avatar.png' },
  role: 'admin',
};

const user = plainToInstance(User, raw);

console.log(user instanceof User);        // true
console.log(user instanceof Profile);     // false — profile is nested
console.log(user.profile instanceof Profile); // true
console.log(user.firstName);             // 'Jane'
console.log(user.role);                  // 'ADMIN'
console.log(user.password);             // undefined — excluded
```

To transform an array:

```typescript
const users = plainToInstance(User, [raw1, raw2, raw3]);
// returns User[]
```

### instanceToPlain

Serializes a class instance back to a plain object, respecting `name` aliases and decorator configuration.

```typescript
import { instanceToPlain } from 'fast-class-transformer';

const plain = instanceToPlain(user);

console.log(plain.first_name); // 'Jane'  — mapped back from firstName
console.log(plain.password);   // undefined — excluded
console.log(plain.role);       // 'ADMIN'
```

### instanceToInstance

Deep-clones a class instance by serializing it to a plain object and re-instantiating it.

```typescript
import { instanceToInstance } from 'fast-class-transformer';

const clone = instanceToInstance(user);

console.log(clone instanceof User); // true
console.log(clone === user);        // false — independent deep copy
```

---

## Decorators

### @Expose

Marks a property for inclusion during transformation and serialization. When `strategy: 'excludeAll'` is set (or `excludeExtraneousValues: true`), only `@Expose()`-decorated properties are processed.

```typescript
class User {
  @Expose()
  id: number;

  @Expose({ name: 'first_name' })
  firstName: string;

  @Expose({ groups: ['admin'] })
  internalNote: string;

  @Expose({ since: 2, until: 4 })
  betaFeature: string;

  @Expose({ toClassOnly: true })
  inputOnly: string;

  @Expose({ toPlainOnly: true })
  outputOnly: string;
}
```

| Option | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Maps to/from a different field name in the raw payload. |
| `groups` | `string[]` | Only process this property when these groups are active. |
| `since` | `number` | Minimum API version (inclusive) for this property to be included. |
| `until` | `number` | Maximum API version (exclusive) for this property to be included. |
| `toClassOnly` | `boolean` | Only applied when converting plain to class (not serializing). |
| `toPlainOnly` | `boolean` | Only applied when serializing class to plain (not deserializing). |

### @Exclude

Prevents a property from being included in transformations.

```typescript
class User {
  @Expose()
  email: string;

  @Exclude()
  passwordHash: string;

  @Exclude({ toPlainOnly: true })
  internalId: string; // available in class, excluded when serialized
}
```

| Option | Type | Description |
| :--- | :--- | :--- |
| `toClassOnly` | `boolean` | Exclude only when mapping plain to class. |
| `toPlainOnly` | `boolean` | Exclude only when serializing class to plain. |

### @Type

Specifies the constructor to use when mapping nested objects or array elements. Required for nested class mapping to work correctly.

```typescript
import { Expose, Type } from 'fast-class-transformer';

class Address {
  @Expose() street: string;
  @Expose() city: string;
}

class Order {
  @Expose() id: number;

  @Expose()
  @Type(() => Address)
  shippingAddress: Address;

  @Expose()
  @Type(() => Address)
  billingAddresses: Address[]; // arrays are handled automatically
}
```

Primitive constructors (`Number`, `String`, `Boolean`) are also supported for type coercion:

```typescript
class CreateCatDto {
  @Expose()
  @Type(() => Number)
  age: number; // coerces '42' (string from query param) → 42 (number)
}
```

### @Transform

Runs a custom function on the property value during transformation.

```typescript
import { Expose, Transform } from 'fast-class-transformer';

class Article {
  @Expose()
  @Transform(({ value }) => value.trim().toLowerCase())
  slug: string;

  @Expose()
  @Transform(({ value, obj }) => `${obj.baseUrl}/${value}`)
  coverImageUrl: string;

  @Expose()
  @Transform(({ value, type }) => {
    // type: 1 = plainToInstance, 2 = instanceToPlain
    return type === 1 ? new Date(value) : value.toISOString();
  })
  publishedAt: Date;
}
```

The transform function receives a `TransformParams` object:

| Property | Description |
| :--- | :--- |
| `value` | The current value of the property. |
| `key` | The property name. |
| `obj` | The source object being processed. |
| `type` | `1` for plainToInstance, `2` for instanceToPlain. |
| `options` | The active `ClassTransformOptions` passed to the call. |

---

## Transformation options

All transformation functions (`plainToInstance`, `instanceToPlain`, `instanceToInstance`) accept an options object as the third argument:

```typescript
plainToInstance(User, raw, {
  excludeExtraneousValues: true,
  groups: ['admin'],
  version: 3,
});
```

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `groups` | `string[]` | `undefined` | Active transformation groups. Only properties with matching `@Expose` groups are processed. |
| `version` | `number` | `undefined` | Active version. Filters properties by `since`/`until` version constraints. |
| `excludeExtraneousValues` | `boolean` | `false` | When `true`, only `@Expose()`-decorated properties are mapped. Equivalent to `strategy: 'excludeAll'`. |
| `strategy` | `'exposeAll' \| 'excludeAll'` | `'exposeAll'` | `'excludeAll'` ignores all properties unless explicitly decorated with `@Expose()`. |
| `exposeDefaultValues` | `boolean` | `true` | Preserves class-declared default values when the input payload is missing those fields. |
| `exposeUnsetFields` | `boolean` | `true` | Sets missing fields explicitly to `undefined` on the instance to preserve the object shape. |
| `enableCircularCheck` | `boolean` | `false` | Detects circular references and returns `undefined` instead of throwing a stack overflow. |
| `validate` | `boolean` | `false` | Enables single-pass JIT validation using `class-validator` decorator rules during `plainToInstance`. |

---

## NestJS integration

`fast-class-transformer` ships a `FastValidationPipe` as an optional subpath export. It does not depend on `@nestjs/common` at the package level — standalone users never bundle NestJS.

```bash
# @nestjs/common and class-validator are peer dependencies — install them if not already present
npm install @nestjs/common class-validator
```

### FastValidationPipe (global drop-in)

Replace NestJS's `ValidationPipe` in `main.ts` with one line:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastValidationPipe } from 'fast-class-transformer/nestjs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new FastValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );

  await app.listen(3000);
}
bootstrap();
```

Existing DTOs with `class-validator` annotations work unchanged — no `@Expose()` required:

```typescript
import { IsString, IsInt, Min, IsEmail } from 'class-validator';

// This DTO works with FastValidationPipe as-is.
// No @Expose() decorators needed.
export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsInt()
  @Min(0)
  age: number;
}
```

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `transform` | `boolean` | `true` | Coerce incoming values to their declared types before validation. |
| `whitelist` | `boolean` | `false` | Strip properties not declared in the DTO. |
| `forbidNonWhitelisted` | `boolean` | `false` | Throw `BadRequestException` when undeclared properties are received. |
| `groups` | `string[]` | `undefined` | Active validation groups. |
| `exceptionFactory` | `(errors: any[]) => any` | `BadRequestException` | Custom factory for formatting validation error responses. |

### @FastMap (endpoint-level)

To optimize a specific endpoint without a global pipe:

```typescript
import { Controller, Post } from '@nestjs/common';
import { FastMap } from 'fast-class-transformer';
import { CreateUserDto } from './create-user.dto';

@Controller('users')
export class UsersController {
  @Post()
  async create(@FastMap() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }
}
```

---

## Ahead-of-Time (AOT) compiler plugin

For compile-time code generation — which produces the mapping functions at build time rather than first request — configure the TypeScript compiler plugin:

1. Install `ts-patch`:

```bash
npm install -D ts-patch
```

2. Add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "fast-class-transformer/dist/transformer" }
    ]
  }
}
```

3. Update build scripts:

```json
{
  "scripts": {
    "build": "ts-patch build",
    "start:dev": "ts-patch ts-node-dev src/main.ts"
  }
}
```

---

## Samples

- [Benchmark source — flat/nested/array mapping](https://github.com/mohit07dec/fast-class-transformer/blob/main/benchmark.ts)
- [NestJS ValidationPipe benchmark](https://github.com/mohit07dec/fast-class-transformer/blob/main/benchmark-nestjs.ts)
- [Test suite](https://github.com/mohit07dec/fast-class-transformer/tree/main/tests)

A full NestJS example application is [planned](https://github.com/mohit07dec/fast-class-transformer/issues) — contributions welcome.
