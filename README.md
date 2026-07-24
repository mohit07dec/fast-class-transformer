# Fast Class Transformer

[![npm version](https://img.shields.io/npm/v/fast-class-transformer.svg?style=flat-gray)](https://www.npmjs.com/package/fast-class-transformer)
[![npm downloads](https://img.shields.io/npm/dm/fast-class-transformer.svg?style=flat-gray)](https://www.npmjs.com/package/fast-class-transformer)

A zero-dependency, ultra-fast alternative to `class-transformer` for TypeScript and NestJS. It utilizes a hybrid approach: **runtime JIT compilation** (via optimized dynamic functions) and **ahead-of-time (AoT) AST transformation** (via a TypeScript compiler plugin). 

By optimizing for the V8 engine's internal memory layouts, it delivers up to **30x+ faster serialization and instantiation** compared to traditional decorator-based reflection.

---

## Performance Benchmarks (JIT vs. Original)

Benchmark run comparing mapping workloads over **100,000 iterations** (Intel i5-12500H / Bun 1.3.0):

| Workload Scenario | class-transformer (Original) | fast-class-transformer (JIT) | Performance Multiplier |
| :--- | :--- | :--- | :--- |
| **1. Flat DTO Mapping** | 2.32 µs/iter (431,034 ops/s) | **2.60 ns/iter (384,615,384 ops/s)** | **892x faster 🚀** |
| **2. Nested DTO Mapping** | 3.08 µs/iter (324,675 ops/s) | **111.69 ns/iter (8,953,353 ops/s)** | **27x faster 🚀** |
| **3. Array Mapping (100 items)** | 232.64 µs/iter (4,300 ops/s) | **1.15 µs/iter (869,565 ops/s)** | **202x faster 🚀** |
| **4. Validation + Mapping** | 4.63 µs/iter (215,982 ops/s) | **31.42 ns/iter (31,826,861 ops/s)** | **147x faster 🚀** |

---

## Why is it so fast?

1. **V8 Hidden Classes (Shapes) Optimization**: The V8 engine optimizes object property access by creating "Hidden Classes" behind the scenes when properties are assigned in a fixed order. Original `class-transformer` assigns properties dynamically (`inst[key] = value` inside `for...in` loops), which degrades objects to slow dictionary/hashmap lookup mode. `fast-class-transformer` compiles a dedicated, inline property-assignment function (`inst.prop = value`) for each DTO shape, maintaining V8's Hidden Class optimizations.
2. **Zero Runtime Reflection**: Instead of recursively traversing metadata arrays, querying target decorators, and resolving groups on *every single request*, our JIT compiler evaluates decorators *once* at startup, generates a static JavaScript mapping function, caches it, and uses it for all subsequent operations.
3. **Monomorphic Inline Caches (ICs)**: Original `class-transformer` uses a generic, monolithic transformation routine that handles all DTO types, turning it into a "megamorphic" function which destroys V8 caches. We generate independent, monomorphic mapping functions for each DTO type.
4. **Garbage Collection Optimization**: We completely avoid allocating temporary metadata arrays, mapping closures, or helper objects on the hot path, drastically reducing memory pressure and GC pauses.

---

## Installation

```bash
bun add fast-class-transformer
```

---

## Usage

### 1. Drop-In Replacement for `class-transformer`

Simply change your imports! We support the standard class-transformer decorator signatures:

```typescript
import { Expose, Exclude, Type, Transform, plainToInstance, instanceToPlain } from 'fast-class-transformer';

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
  password?: string;

  @Expose()
  @Type(() => Profile)
  profile: Profile;

  @Expose()
  createdAt: Date;

  @Expose()
  @Transform(({ value }) => value.toUpperCase())
  role: string;
}

// 1. Plain to Instance
const rawJson = {
  id: 42,
  first_name: 'John Doe',
  password: 'secret_password',
  profile: { bio: 'Engineer', avatar: 'avatar.png' },
  createdAt: '2026-07-23T20:00:00.000Z',
  role: 'admin'
};

const user = plainToInstance(User, rawJson);
console.log(user instanceof User); // true
console.log(user.firstName); // "John Doe"
console.log(user.role); // "ADMIN" (transformed)

// 2. Instance to Plain
const plain = instanceToPlain(user);
console.log(plain.first_name); // "John Doe" (mapped back to custom serialize name)
```

---

## NestJS Integration (`@FastMap`)

To bypass the reflection overhead of the global `ValidationPipe`, use the `@FastMap()` decorator on your controller endpoints.

```typescript
import { Controller, Post } from '@nestjs/common';
import { FastMap } from 'fast-class-transformer';
import { CreateUserDto } from './create-user.dto';

@Controller('users')
export class UsersController {
  @Post()
  async create(@FastMap() createUserDto: CreateUserDto) {
    // Payload is already compiled, sanitized, and instantiated!
    return this.usersService.create(createUserDto);
  }
}
```

---

## Ahead-of-Time (AOT) AST Transformer Setup

If you want compilation-time code generation for zero-overhead execution (often yielding up to **100x–200x** speedups), set up our custom compiler plugin:

### 1. Install compiler patch dependencies
```bash
bun add -d ts-patch
```

### 2. Configure `tsconfig.json`
Add the plugin to your compiler options:

```json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "fast-class-transformer/dist/transformer" }
    ]
  }
}
```

### 3. Build/Run your project using `ts-patch`
Update your package build scripts to run `ts-patch`:

```json
"scripts": {
  "build": "ts-patch build",
  "start:dev": "ts-patch ts-node-dev src/main.ts"
}
```

---

## API Reference

### Core Transformation Functions

- **`plainToInstance(cls, plain, options)`**: Transforms a plain (literal) JavaScript object or array of objects into an instance (or array of instances) of the specified class `cls`.
- **`instanceToPlain(instance, options)`**: Serializes a class instance or array of instances back into plain JavaScript literal objects, respecting custom name mappings and decorators.
- **`instanceToInstance(instance, options)`**: Performs a deep clone of class instances by serializing them to plain objects and then instantiating them back.

### Class and Property Decorators

#### `@Expose(options?: ExposeOptions)`
Exposes the property for transformation and serialization.
- **`name?: string`**: Maps the property to a different field name in the raw JSON payload.
- **`groups?: string[]`**: Restricts property processing to specific execution groups.
- **`since?: number`**: The minimum API version (inclusive) required to expose this property.
- **`until?: number`**: The maximum API version (exclusive) allowed to expose this property.
- **`toClassOnly?: boolean`**: Exposes the property only when converting plain JSON to a class instance.
- **`toPlainOnly?: boolean`**: Exposes the property only when serializing a class instance back to plain JSON.

#### `@Exclude(options?: ExcludeOptions)`
Excludes the property from being processed.
- **`toClassOnly?: boolean`**: Excludes the property only when mapping plain JSON to class.
- **`toPlainOnly?: boolean`**: Excludes the property only when serializing class to plain JSON.

#### `@Type(typeFunction: () => Class)`
Specifies target constructor functions for nested objects and array elements to enable recursive mapping.

#### `@Transform(transformFunction: (params: TransformParams) => any)`
Runs a custom transformation function on the property value.
*TransformParams context:*
- `value`: The current property value.
- `key`: The name of the property.
- `obj`: The source object being processed.
- `type`: The transformation type (`1` for plain-to-class, `2` for class-to-plain).
- `options`: The active `ClassTransformOptions` configurations.

### Transformation Options (ClassTransformOptions)

Configure execution behavior by passing this options object to any mapping function:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`groups`** | `string[]` | `undefined` | Active groups list. If set, only properties with matching `@Expose` groups are mapped. |
| **`version`** | `number` | `undefined` | Active version number. Filters properties according to `@Expose` version ranges (`since`/`until`). |
| **`excludeExtraneousValues`** | `boolean` | `false` | When true (or when `strategy: 'excludeAll'`), only properties decorated with `@Expose` are mapped. |
| **`strategy`** | `'exposeAll' \| 'excludeAll'` | `'exposeAll'` | Set to `'excludeAll'` to ignore all properties by default unless explicitly decorated with `@Expose()`. |
| **`exposeDefaultValues`** | `boolean` | `true` | If true, properties with default values declared on the class are kept if missing in the input payload. |
| **`exposeUnsetFields`** | `boolean` | `true` | If true, missing fields are explicitly set as `undefined` on the instance to preserve the object shape. |
| **`enableCircularCheck`** | `boolean` | `false` | Enables recursion checking. If true, safely stops circular dependency loops by returning `undefined` for recursions. |
| **`validate`** | `boolean` | `false` | Enables JIT-compiled single-pass validation extracting rules from `class-validator` decorators. |



