# vex-ui

[![Node](https://img.shields.io/badge/node-%3E%3D24.0.0-339933?style=flat-square&logo=nodedotjs)](./package.json)
[![pnpm](https://img.shields.io/badge/pnpm-10.33.0-F69220?style=flat-square&logo=pnpm)](./package.json)
[![npm audit](https://img.shields.io/github/actions/workflow/status/vex-protocol/vex-ui/npm-audit.yml?branch=master&style=flat-square&logo=npm&label=npm%20audit)](https://github.com/vex-protocol/vex-ui/actions/workflows/npm-audit.yml)
[![CI](https://img.shields.io/github/actions/workflow/status/vex-protocol/vex-ui/ci.yml?branch=master&event=push&style=flat-square&logo=github&label=CI)](https://github.com/vex-protocol/vex-ui/actions/workflows/ci.yml)
[![Socket](https://img.shields.io/github/actions/workflow/status/vex-protocol/vex-ui/socket.yml?branch=master&style=flat-square&label=Socket)](https://github.com/vex-protocol/vex-ui/actions/workflows/socket.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/vex-protocol/vex-ui/badge)](https://scorecard.dev/viewer/?uri=github.com/vex-protocol/vex-ui)

Vex is an end-to-end encrypted chat platform — a privacy-first communication stack you can host yourself.

Every message is encrypted on your device before it leaves. The server stores only ciphertext and deletes your message after it gets to the intended recipient.

**License:** AGPL-3.0 — any server modifications must be open-sourced.

---

## What's in this repo

| Package                  | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `apps/desktop`           | Desktop client — Tauri 2.0 + Svelte 5                          |
| `apps/mobile`            | Mobile client — Expo + React Native                            |
| `apps/website`           | Public website — Vite + Preact + Node API handlers             |
| `packages/store`         | Shared state management (nanostores atoms) + VexService facade |
| `packages/ui`            | Mitosis design primitives → Svelte + React                     |
| `packages/eslint-config` | Shared ESLint base config + SDK-only import restrictions       |

---

## Quickstart

### Prerequisites

- [mise](https://mise.jdx.dev/) — manages Node.js and pnpm versions automatically
- Or manually: Node.js 24.x and pnpm 10.x

```bash
# Install mise, then let it pick up the pinned versions from mise.toml
mise install
```

### 1. Clone and install

```bash
git clone https://github.com/vex-chat/vex-chat.git
cd vex-chat
pnpm install
```

### 2. Start development

```bash
# From the repo root — starts client apps in parallel
pnpm dev
```
