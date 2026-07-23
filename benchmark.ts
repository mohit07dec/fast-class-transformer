import 'reflect-metadata';
import { plainToInstance as origPlainToInstance, Expose as origExpose, Type as origType } from 'class-transformer';
import { plainToInstance as fastPlainToInstance, Expose as fastExpose, Type as fastType } from './src';

class OrigSubDto {
  @origExpose()
  value!: string;
}

class OrigDto {
  @origExpose()
  id!: number;

  @origExpose({ name: 'first_name' })
  firstName!: string;

  @origExpose()
  @origType(() => OrigSubDto)
  sub!: OrigSubDto;

  @origExpose()
  createdAt!: Date;
}

class FastSubDto {
  @fastExpose()
  value!: string;
}

class FastDto {
  @fastExpose()
  id!: number;

  @fastExpose({ name: 'first_name' })
  firstName!: string;

  @fastExpose()
  @fastType(() => FastSubDto)
  sub!: FastSubDto;

  @fastExpose()
  createdAt!: Date;
}

const payload = {
  id: 12345,
  first_name: 'Johnathan',
  sub: {
    value: 'Some nested text value'
  },
  createdAt: '2026-07-23T20:40:00.000Z'
};

const ITERATIONS = 100000;

console.log(`Running benchmark with ${ITERATIONS} iterations...`);

// Warm up
for (let i = 0; i < 1000; i++) {
  origPlainToInstance(OrigDto, payload);
  fastPlainToInstance(FastDto, payload);
}

// Benchmark original class-transformer
const startOrig = Date.now();
for (let i = 0; i < ITERATIONS; i++) {
  origPlainToInstance(OrigDto, payload);
}
const timeOrig = Date.now() - startOrig;

// Benchmark fast-class-transformer JIT
const startFast = Date.now();
for (let i = 0; i < ITERATIONS; i++) {
  fastPlainToInstance(FastDto, payload);
}
const timeFast = Date.now() - startFast;

console.log('\n--- BENCHMARK RESULTS ---');
console.log(`Original class-transformer: ${timeOrig}ms (${(ITERATIONS / (timeOrig / 1000)).toFixed(0)} ops/sec)`);
console.log(`Fast class-transformer (JIT): ${timeFast}ms (${(ITERATIONS / (timeFast / 1000)).toFixed(0)} ops/sec)`);
console.log(`Speedup: ${(timeOrig / timeFast).toFixed(1)}x faster! 🚀`);
