# Contributing to deere-sdk

Thank you for your interest in contributing to deere-sdk!

## Code of Conduct

Please be respectful and constructive in all interactions.

## How to Contribute

### Reporting Bugs

1. Check if the issue already exists in [GitHub Issues](https://github.com/ProductOfAmerica/deere-sdk/issues)
2. If not, create a new issue with:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Node.js version and OS

### Suggesting Enhancements

Open a [GitHub Issue](https://github.com/ProductOfAmerica/deere-sdk/issues) describing:
- The enhancement you'd like
- Why it would be useful
- Any implementation ideas

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following our coding standards
4. Add tests for new functionality
5. Ensure all tests pass (`pnpm test`)
6. Commit with clear messages
7. Push and open a Pull Request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/deere-sdk.git
cd deere-sdk

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build
```

## Coding Standards

### Language & Style

- **TypeScript** with strict mode enabled
- **Biome** for linting and formatting
- Run `pnpm lint:fix` before committing

### Code Quality Requirements

- All code must pass TypeScript type checking (`pnpm typecheck`)
- All code must pass linting (`pnpm lint`)
- No `any` types without explicit justification
- Prefer explicit return types on public functions

### Testing Requirements

- **All new features must include tests**
- **All bug fixes must include a regression test**
- Tests use Node.js built-in test runner
- Aim for high code coverage
- Run `pnpm test` to execute tests
- Run `pnpm test:fuzz` for property-based fuzz tests

### Commit Messages

Use clear, descriptive commit messages:
- `feat: add new pagination method`
- `fix: handle empty response in getAll`
- `docs: update API reference`
- `test: add tests for retry logic`
- `chore: update dependencies`

## Project Structure

```
deere-sdk/
├── src/              # Source code
│   ├── client.ts     # Core API client
│   ├── apis/         # API wrapper classes
│   └── types/        # TypeScript types
├── tests/            # Test files
├── scripts/          # Build/generation scripts
└── specs/            # OpenAPI specifications
```

## Questions?

Open a [GitHub Issue](https://github.com/ProductOfAmerica/deere-sdk/issues) or start a [Discussion](https://github.com/ProductOfAmerica/deere-sdk/discussions).
