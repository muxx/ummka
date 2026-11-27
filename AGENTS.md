# AGENTS.md

Read [README.md](README.md). In the full workspace, see the [product requirements](../docs/product.md).

Follow the [design system](docs/design.md) when designing, building, or reviewing the interface.

## Stack

- Use Tauri 2 with a Rust host, React and TypeScript for the UI, and SQLite for local history. Connect to Mattermost over REST v4 and WebSocket.
- Build the UI with Vite and package it with the Tauri CLI in GitHub Actions. Pin toolchain versions and commit the JavaScript and Cargo lockfiles.
- Use Vitest and React Testing Library for UI tests and `cargo test` for Rust. Verify native interactions on the target OS and measure performance in release builds.

## Development workflow

- Plan implementation epics by architectural layer, in dependency order. Each epic names its prerequisites and the capability it provides to the next layer. Use small RFCs for changes within that layer. User journeys guide interface design and later integration tests.
- For visible UI changes, compare the implemented state with the accepted prototype at the same width and theme using representative test data. Keep both screenshots and resolve or agree on visible differences before acceptance.
- Check each feature against the relevant official Mattermost client's source and tests. Follow that behavior unless the ummka prototypes specify a deliberate difference. Resolve edge cases from upstream evidence first. Ask the user only when a product choice remains. Explain what the official clients do, why that behavior is insufficient for ummka or which difference affects the user, and what you recommend. Cite the upstream tag or commit and file in the RFC and record agreed deviations.
- For a layer that consumes REST, verify the versioned Mattermost contract and generate bindings with OpenAPI Generator before implementing its callers. Apply confirmed corrections before generation, cite the official code and test each correction against both compatibility servers.
- Add linting, type checks where the language supports them, static analysis, and security checks with the first code in each language, including build scripts. Cover source code and dependencies. Pin the tools and run the same checks locally and in GitHub Actions on pull requests and pushes to `master`. A failed check must fail CI.
- Write comprehensive tests alongside the implementation, including upstream edge cases. Run the full checks and test suite before handing off each iteration. Fix flaky checks in a separate commit and verify that the check still detects the original regression.
- Once the epic and RFC are written, the lead agent gives a `gpt-6.2-sol` implementation agent the scope, dependencies and acceptance criteria. Use `xhigh` reasoning. Independent modules can proceed in separate worktrees. The lead agent reviews the patch and tests, verifies the results and reviews any fixes before accepting the RFC. Keep the patch fixed during review.
- Use one branch and one pull request per architectural epic. Commit the reviewed implementation of each RFC separately on the epic branch. Push the commits together and open the PR when the epic passes its local acceptance checks. Run the full CI suite on the combined changes before merging. While CI runs, work on the next epic whose dependencies are understood.
- After the epic PR passes CI, merge it into the default branch, update the local checkout and delete the merged branch.

## Engineering principles

- Choose the simplest design that meets the requirements. Use maintained libraries, fix root causes, and suggest refactoring where it helps. Apply SOLID, DRY, and domain-driven design where they simplify the code.
- Allow breaking changes to ummka's interfaces while preserving the stated Mattermost compatibility.

## Database changes

- Version each database format. Keep independent schema changes and data transformations in separate, ordered migrations. When SQLite must rebuild a table, copy its rows and replace it in the same transaction.
- Test upgrades on populated files with the bundled SQLite, including skipped releases and rollback after a failure. Verify the schema and user data after reopening. Test both directions of supported downgrades. An older client must preserve a database whose version it cannot read.
- Inspect the query plan for new or changed queries on representative data. For SQLite, use `EXPLAIN QUERY PLAN`. Choose query shapes and indexes that match the filters, joins, and ordering on the target engine.

## Docs

- Write repository documentation in English. Workspace documents follow their directory's rules.
- Keep the README to the introduction, advantages, unsupported features, and installation. Emoji are welcome. Follow Maxim Ilyakhov's *Write, Cut* and use lists or diagrams when they help.
