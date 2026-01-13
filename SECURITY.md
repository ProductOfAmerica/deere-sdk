# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via GitHub's private vulnerability reporting:

https://github.com/ProductOfAmerica/deere-sdk/security/advisories/new

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

Please include:

- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the issue
- Location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

## Security Measures

This SDK implements the following security practices:

- **Zero runtime dependencies** - Minimizes supply chain attack surface
- **npm Provenance** - All releases are cryptographically linked to this repository
- **Automated dependency updates** - Dependabot monitors for vulnerable dependencies
- **CI/CD security scanning** - CodeQL and OpenSSF Scorecard analysis on all changes
- **No credential storage** - The SDK never stores or logs authentication tokens