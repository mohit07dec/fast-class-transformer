# Fast Class Transformer

A zero-dependency, ultra-fast alternative to `class-transformer` for TypeScript and NestJS. It utilizes a hybrid approach: **runtime JIT compilation** (via optimized dynamic functions) and **ahead-of-time (AoT) AST transformation** (via a TypeScript compiler plugin). 

By optimizing for the V8 engine's internal memory layouts, it delivers up to **75x+ faster serialization and instantiation** compared to traditional decorator-based reflection.

---

## Performance Benchmarks (JIT vs. Original)

Benchmark run mapping a DTO with nested classes and custom name mappings over **100,000 iterations** (Node.js / Bun):

| Library | Operations / sec | Execution Time | Speedup |
| :--- | :--- | :--- | :--- |
| **`class-transformer` (Original)** | ~265,252 ops/sec | 377 ms | *Baseline* |
| **`fast-class-transformer` (JIT)** | **~20,000,000 ops/sec** | **5 ms** | **75.4x faster** |

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

## License

MIT © Mohit
