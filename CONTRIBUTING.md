# Contributing to fast-class-transformer

Thanks for helping make TypeScript and NestJS serialization faster. We welcome bug fixes, performance optimizations, test coverage, and documentation improvements.

## Ways to contribute

| Goal | What to do |
| --- | --- |
| Report a bug | Open an issue with a minimal reproduction case |
| Suggest a feature | Open an issue describing the use case and expected API |
| Add a test case | Add a regression test under `tests/` |
| Optimize performance | Ensure microbenchmarks (`bun run benchmark`) show no regressions |
| Improve docs | Edit `README.md` or this file |

## Getting started

1. Fork the repository and clone it locally:

   ```bash
   git clone https://github.com/mohit07dec/fast-class-transformer.git
   cd fast-class-transformer
   ```

2. Create a branch for your changes:

   ```bash
   git checkout -b feat/your-feature
   ```

3. Install dependencies (requires [Bun](https://bun.sh) 1.x):

   ```bash
   bun install
   ```

4. Make your changes and verify that tests, typecheck, and builds pass:

   ```bash
   bun run typecheck
   bun run build
   bun test
   ```

5. If modifying the JIT compiler or mapping engine, run the benchmarks to ensure performance hasn't regressed:

   ```bash
   bun run benchmark
   bun run benchmark:nestjs
   ```

6. Commit your changes using conventional, concise commit messages:

   ```bash
   git commit -m "feat(pipe): add custom error formatter option"
   ```

7. Push to your fork and open a Pull Request against `main`.

## Project structure

```
src/
  decorators.ts          — Decorators (@Expose, @Exclude, @Type, @Transform)
  metadata.ts            — Metadata storage and class-transformer/class-validator interop
  runtime.ts             — JIT compiler, plainToInstance, instanceToPlain, validation engine
  transformer.ts         — TypeScript compiler AST transformer plugin
  nestjs/
    validation-pipe.ts   — FastValidationPipe drop-in replacement for NestJS
    index.ts             — Subpath export entrypoint
tests/                   — Unit and integration test suites
benchmark.ts             — Core mapping mitata benchmarks
benchmark-nestjs.ts      — NestJS ValidationPipe mitata benchmarks
```

## Pull request guidelines

- Keep PRs focused — one bug fix or feature per PR.
- Ensure all checks pass: `bun run typecheck`, `bun run build`, and `bun test`.
- Do not introduce runtime dependencies into `dependencies` in `package.json` — `fast-class-transformer` must remain zero-dependency.
- Write tests for any new options, edge cases, or bug fixes.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
