# Changelog

All notable changes to this project will be documented in this file.

## [1.1.1] — 2026-10-02

### Changed
- Complete documentation overhaul: structured Table of Contents, in-depth decorator guides, and clean right-aligned benchmark tables.
- Added comprehensive `CONTRIBUTING.md` guide and project structure overview.
- Added `typecheck` verification script (`tsc --noEmit`) to `package.json` and CI workflow.

## [1.1.0] — 2026-10-02

### Added
- **`FastValidationPipe`** — 1-line zero-migration drop-in replacement for NestJS `ValidationPipe`
  - Import via: `import { FastValidationPipe } from 'fast-class-transformer/nestjs'`
  - **18x faster** than NestJS default ValidationPipe (365 ns/iter vs 6.53 µs/iter)
  - Supports all standard options: `transform`, `whitelist`, `forbidNonWhitelisted`, `groups`, `exceptionFactory`
  - **Zero migration**: works with existing `class-validator` + `class-transformer` DTOs without any changes
  - Primitive type coercion: `@Type(() => Number)` correctly coerces `"25"` → `25` before validation runs
  - Full `class-transformer` interop: reads `@Expose`, `@Exclude`, `@Type` metadata automatically
  - Full `class-validator` interop: discovers validation fields without requiring `@Expose()`
- **Subpath export** `"./nestjs"` in `package.json` — standalone users never load `@nestjs/common`
- **`benchmark-nestjs.ts`** — reproducible head-to-head mitata benchmark for `ValidationPipe` vs `FastValidationPipe`
- `whitelist` option on `ClassTransformOptions` for decorator-driven field filtering

### Fixed
- `@Type(() => Number)` no longer returns `[Number: 0]` (boxed object) — now returns primitive `25`
- `plainToInstance(Number, "25")` returns primitive `25` not `new Number()` wrapper
- `plainToInstance(String, 123)` returns primitive `"123"` correctly
- `instanceToPlain` now passes primitives through unchanged (no longer returns `{}`)
- `instanceToPlain` now returns ISO string for `Date` instances instead of wrapping them

## [1.0.0] — 2026-07-23

### Added
- Initial release: JIT-compiled `plainToInstance`, `instanceToPlain`, `instanceToInstance`
- `@Expose`, `@Exclude`, `@Type`, `@Transform` decorators with full class-transformer API parity
- Single-pass JIT validation integrating `class-validator` rules inline
- Circular reference detection with `enableCircularCheck`
- AoT TypeScript compiler transformer plugin (`fast-class-transformer/dist/transformer`)
- Group-based filtering, version ranges (`since`/`until`), and strategy options
- Up to **186x faster** than `class-transformer` on array mapping workloads
