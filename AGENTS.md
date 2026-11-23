# AGENTS.md

Read [README.md](README.md). In the full workspace, see the [product requirements](../docs/product.md).

Follow the [design system](docs/design.md) when designing, building, or reviewing the interface.

## Stack

- Use Tauri 2 with a Rust host, React and TypeScript for the UI, and SQLite for local history. Connect to Mattermost over REST v4 and WebSocket.
- Build the UI with Vite and package it with the Tauri CLI in GitHub Actions. Pin toolchain versions and commit the JavaScript and Cargo lockfiles.
- Use Vitest and React Testing Library for UI tests and `cargo test` for Rust. Verify native interactions on the target OS and measure performance in release builds.

## Development workflow

- Plan implementation epics by architectural layer, in dependency order. Each epic names its prerequisites and the capability it provides to the next layer. Use small RFCs for changes within that layer. User journeys guide interface design and later integration tests.
- Check every behavior change against the official client's source and tests. Cite the upstream tag or commit and file in the RFC. Record any agreed deviation.
- For a layer that consumes REST, verify the versioned Mattermost contract and generate bindings with OpenAPI Generator before implementing its callers.
- Write comprehensive tests alongside the implementation, including upstream edge cases. Run all checks and tests after implementation.

## Engineering principles

- Choose the simplest design that meets the requirements. Use maintained libraries, fix root causes, and suggest refactoring where it helps. Apply SOLID, DRY, and domain-driven design where they simplify the code.
- Allow breaking changes to ummka's interfaces while preserving the stated Mattermost compatibility.

## Docs

- Write repository documentation in English. Workspace documents follow their directory's rules.
- Keep the README to the introduction, advantages, unsupported features, and installation. Emoji are welcome. Follow Maxim Ilyakhov's *Write, Cut* and use lists or diagrams when they help.
