import 'reflect-metadata';
import { run, bench, group, do_not_optimize } from 'mitata';
import { plainToInstance as origPlainToInstance, Expose as origExpose, Type as origType } from 'class-transformer';
import { plainToInstance as fastPlainToInstance, Expose as fastExpose, Type as fastType } from './src';
import { IsString, IsInt, Min, validateSync } from 'class-validator';

// ---------------------------------------------------------
// 1. Flat DTO Definitions
// ---------------------------------------------------------
class OrigFlatDto {
  @origExpose() id!: number;
  @origExpose() username!: string;
  @origExpose() email!: string;
  @origExpose() role!: string;
}

class FastFlatDto {
  @fastExpose() id!: number;
  @fastExpose() username!: string;
  @fastExpose() email!: string;
  @fastExpose() role!: string;
}

// ---------------------------------------------------------
// 2. Nested DTO Definitions
// ---------------------------------------------------------
class OrigSubDto {
  @origExpose() value!: string;
}
class OrigNestedDto {
  @origExpose() id!: number;
  @origExpose({ name: 'first_name' }) firstName!: string;
  @origExpose() @origType(() => OrigSubDto) sub!: OrigSubDto;
  @origExpose() createdAt!: Date;
}

class FastSubDto {
  @fastExpose() value!: string;
}
class FastNestedDto {
  @fastExpose() id!: number;
  @fastExpose({ name: 'first_name' }) firstName!: string;
  @fastExpose() @fastType(() => FastSubDto) sub!: FastSubDto;
  @fastExpose() createdAt!: Date;
}

// ---------------------------------------------------------
// 3. Array DTO (100 elements) Setup
// ---------------------------------------------------------
const arrayPayload = Array.from({ length: 100 }, (_, i) => ({
  id: i,
  username: `user_${i}`,
  email: `user_${i}@gmail.com`,
  role: i % 2 === 0 ? 'user' : 'admin'
}));

// ---------------------------------------------------------
// 4. Validation + Mapping DTO Definitions
// ---------------------------------------------------------
class OrigValidatedDto {
  @origExpose() @IsString() username!: string;
  @origExpose() @IsInt() @Min(18) age!: number;
}

class FastValidatedDto {
  @fastExpose() @IsString() username!: string;
  @fastExpose() @IsInt() @Min(18) age!: number;
}

// Generate 1,024 rotated payload instances to prevent V8 constant propagation
const flatPayloads = Array.from({ length: 1024 }, (_, i) => ({
  id: 98765 + i,
  username: `dev_ops_${i}`,
  email: `dev_${i}@example.com`,
  role: i % 2 === 0 ? 'admin' : 'user'
}));

const nestedPayloads = Array.from({ length: 1024 }, (_, i) => ({
  id: 12345 + i,
  first_name: `Johnathan_${i}`,
  sub: { value: `Nested text value ${i}` },
  createdAt: '2026-07-23T20:40:00.000Z'
}));

const validatedPayloads = Array.from({ length: 1024 }, (_, i) => ({
  username: `john_doe_${i}`,
  age: 18 + (i % 50)
}));

let flatIdx = 0;
let nestedIdx = 0;
let valIdx = 0;

// Warm up registries & JIT compilation so startup compilation overhead isn't measured
origPlainToInstance(OrigFlatDto, flatPayloads[0]);
fastPlainToInstance(FastFlatDto, flatPayloads[0]);

origPlainToInstance(OrigNestedDto, nestedPayloads[0]);
fastPlainToInstance(FastNestedDto, nestedPayloads[0]);

origPlainToInstance(OrigFlatDto, arrayPayload);
fastPlainToInstance(FastFlatDto, arrayPayload);

origPlainToInstance(OrigValidatedDto, validatedPayloads[0]);
validateSync(origPlainToInstance(OrigValidatedDto, validatedPayloads[0]));
fastPlainToInstance(FastValidatedDto, validatedPayloads[0], { validate: true });

// Run the multi-parameter benchmarks with do_not_optimize and payload rotation
group('1. Flat DTO Mapping', () => {
  bench('class-transformer (Original)', () => {
    const payload = flatPayloads[(flatIdx++) & 1023];
    do_not_optimize(origPlainToInstance(OrigFlatDto, payload));
  });
  bench('fast-class-transformer (JIT)', () => {
    const payload = flatPayloads[(flatIdx++) & 1023];
    do_not_optimize(fastPlainToInstance(FastFlatDto, payload));
  });
});

group('2. Nested DTO Mapping', () => {
  bench('class-transformer (Original)', () => {
    const payload = nestedPayloads[(nestedIdx++) & 1023];
    do_not_optimize(origPlainToInstance(OrigNestedDto, payload));
  });
  bench('fast-class-transformer (JIT)', () => {
    const payload = nestedPayloads[(nestedIdx++) & 1023];
    do_not_optimize(fastPlainToInstance(FastNestedDto, payload));
  });
});

group('3. Array DTO Mapping (100 items)', () => {
  bench('class-transformer (Original)', () => {
    do_not_optimize(origPlainToInstance(OrigFlatDto, arrayPayload));
  });
  bench('fast-class-transformer (JIT)', () => {
    do_not_optimize(fastPlainToInstance(FastFlatDto, arrayPayload));
  });
});

group('4. Map + Validate Integration', () => {
  bench('class-transformer + class-validator (Original)', () => {
    const payload = validatedPayloads[(valIdx++) & 1023];
    const obj = origPlainToInstance(OrigValidatedDto, payload);
    do_not_optimize(validateSync(obj));
  });

  bench('fast-class-transformer (JIT Single-Pass)', () => {
    const payload = validatedPayloads[(valIdx++) & 1023];
    do_not_optimize(fastPlainToInstance(FastValidatedDto, payload, { validate: true }));
  });
});

await run();
