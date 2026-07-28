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

const flatPayload = { id: 98765, username: 'dev_ops', email: 'dev@example.com', role: 'admin' };

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

const nestedPayload = {
  id: 12345,
  first_name: 'Johnathan',
  sub: { value: 'Some nested text value' },
  createdAt: '2026-07-23T20:40:00.000Z'
};

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

const validatedPayload = { username: 'john_doe', age: 25 };

// Warm up registries & JIT compilation so startup compilation overhead isn't measured
origPlainToInstance(OrigFlatDto, flatPayload);
fastPlainToInstance(FastFlatDto, flatPayload);

origPlainToInstance(OrigNestedDto, nestedPayload);
fastPlainToInstance(FastNestedDto, nestedPayload);

origPlainToInstance(OrigFlatDto, arrayPayload);
fastPlainToInstance(FastFlatDto, arrayPayload);

origPlainToInstance(OrigValidatedDto, validatedPayload);
validateSync(origPlainToInstance(OrigValidatedDto, validatedPayload));
fastPlainToInstance(FastValidatedDto, validatedPayload, { validate: true });

// Run the multi-parameter benchmarks with do_not_optimize to prevent DCE
group('1. Flat DTO Mapping', () => {
  bench('class-transformer (Original)', () => {
    do_not_optimize(origPlainToInstance(OrigFlatDto, flatPayload));
  });
  bench('fast-class-transformer (JIT)', () => {
    do_not_optimize(fastPlainToInstance(FastFlatDto, flatPayload));
  });
});

group('2. Nested DTO Mapping', () => {
  bench('class-transformer (Original)', () => {
    do_not_optimize(origPlainToInstance(OrigNestedDto, nestedPayload));
  });
  bench('fast-class-transformer (JIT)', () => {
    do_not_optimize(fastPlainToInstance(FastNestedDto, nestedPayload));
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
    const obj = origPlainToInstance(OrigValidatedDto, validatedPayload);
    do_not_optimize(validateSync(obj));
  });

  bench('fast-class-transformer (JIT Single-Pass)', () => {
    do_not_optimize(fastPlainToInstance(FastValidatedDto, validatedPayload, { validate: true }));
  });
});

await run();

