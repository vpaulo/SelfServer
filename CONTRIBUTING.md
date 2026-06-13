# Contributing to SelfServer

Thanks for helping. The best contributions are small, focused, and easy to test locally.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- Prefer one bug fix or one feature per pull request.
- Avoid broad rewrites, formatting-only changes, or large refactors unless there is a specific issue for it.
- For larger features, open an issue first and describe the approach.

## Setup

**Requirements:** Go 1.24+, Node 18+, [Wails v3](https://v3.wails.io), [Task](https://taskfile.dev).

```bash
git clone <repo-url>
cd SelfServer

# Install frontend deps and run in dev mode (hot-reload)
task dev
```

`task dev` starts the Wails dev server with Vite hot-reload. Changes to Go files restart the backend; changes to frontend files are picked up by Vite without a full restart.

To do a full production build:

```bash
task build
```

## Running Checks

SelfServer has no automated test suite yet. Before submitting a PR, manually verify:

1. The app builds cleanly: `task build`
2. The Go packages compile: `go build ./...`
3. The specific flow you changed works end-to-end in the running app.

Mention what you tested in the PR description. If you could not test something, say so.

## Pull Requests

Good pull requests include:

- A short explanation of the bug or feature.
- The files or areas changed.
- Manual test steps — what you clicked, what you expected, what you saw.
- Screenshots or short recordings for any UI change.
- Links to related issues, e.g. `Fixes #123`.

Keep PRs small. PRs that mix unrelated cleanup, refactors, and behavior changes are much harder to review.

## Style and Visual Changes

SelfServer has an intentional visual style. Before submitting anything that affects what the app looks like — buttons, icons, layout, CSS, HTML, or any component that touches the DOM:

1. **Run the app locally** and view the change in the actual window. Build output alone is not enough.
2. **Attach a screenshot** of the change in the running app.
3. **Match the existing visual language:**
   - Reuse existing CSS variables and utility classes. Do not introduce new color values, font sizes, or spacing units.
   - Reuse existing button, input, and action-button patterns (`act-btn`, `proj-add-btn`, etc.).
   - Extend an existing web component rather than writing a parallel one for similar functionality.

If you are unsure whether something is a visual change, assume it is and attach a screenshot.

## Code Conventions

**Go:**

- Follow standard Go formatting (`gofmt`). No exceptions.
- Return errors; do not swallow them silently. Log at the call site only when the error cannot be propagated.
- Use the sentinel `server.ErrServerNotFound` (and `errors.Is`) rather than comparing error strings.
- All new exported service methods become Wails bindings — keep their signatures simple and JSON-serialisable.
- Config paths always go through `configPath()` in `internal/config/config.go`. Do not construct them locally.

**JavaScript:**

- All components are vanilla JS custom elements (`HTMLElement` subclass). No framework, no build-time JSX.
- Event listeners added in `connectedCallback` must be registered through the component's `listen()` helper so they are automatically cleaned up in `disconnectedCallback`.
- Use `escape_html()` from `helpers/try_catch.js` when interpolating user-controlled strings into `innerHTML`.
- Use `try_catch()` for all async Wails service calls. Never use bare `try/catch` in component code.
- Keep `decrement_count()` / similar mutations behind methods on the owning component — do not reach into a sibling or parent's internal state directly.

**Commits:** use [Conventional Commits](https://www.conventionalcommits.org) — `type(scope): summary` (e.g. `fix(server): ...`, `feat(ui): ...`, `docs(readme): ...`). Common types: `fix`, `feat`, `refactor`, `docs`, `chore`. Keep the subject short and imperative; put the "why" in the body when it is not obvious.

## Issue Reports

For bugs, include:

- OS and SelfServer version (or commit hash if built from source).
- Exact steps to reproduce.
- Expected behaviour and actual behaviour.
- Screenshots, terminal output, or browser console errors if relevant.

Issues with only "doesn't work" and no reproduction steps may be closed as not actionable.

## Security

Do not post secrets, API keys, or private file paths in issues or pull requests.
