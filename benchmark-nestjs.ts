import 'reflect-metadata';
import { run, bench, group, do_not_optimize } from 'mitata';
import { ValidationPipe as NestValidationPipe } from '@nestjs/common';
import { FastValidationPipe } from './src/nestjs';
import { IsString, IsInt, Min, Max, IsEmail } from 'class-validator';
import { Expose, Type } from 'class-transformer';

// ---------------------------------------------------------
// DTO Definitions
// ---------------------------------------------------------
class StandardUserDto {
  @IsString()
  username!: string;

  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(99)
  age!: number;

  @IsEmail()
  email!: string;
}

const nestPipe = new NestValidationPipe({ transform: true, whitelist: true });
const fastPipe = new FastValidationPipe({ transform: true, whitelist: true });

const payloads = Array.from({ length: 1024 }, (_, i) => ({
  username: `user_${i}`,
  age: `${18 + (i % 50)}`, // String to test coercion
  email: `user_${i}@example.com`,
  extra_field: `malicious_or_extra_${i}`,
}));

const meta = { type: 'body' as const, metatype: StandardUserDto };

// Warm up registries & JIT compiler
await nestPipe.transform({ ...payloads[0] }, meta);
await fastPipe.transform({ ...payloads[0] }, meta);

let nestIdx = 0;
let fastIdx = 0;

group('NestJS ValidationPipe vs FastValidationPipe (Transform + Validate + Whitelist)', () => {
  bench('NestJS ValidationPipe (class-transformer + class-validator)', async () => {
    const payload = payloads[(nestIdx++) & 1023];
    do_not_optimize(await nestPipe.transform(payload, meta));
  });

  bench('FastValidationPipe (fast-class-transformer JIT Single-Pass)', async () => {
    const payload = payloads[(fastIdx++) & 1023];
    do_not_optimize(await fastPipe.transform(payload, meta));
  });
});

await run();
