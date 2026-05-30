# xp-gate v0.5.0 — 公共 npm registry 发布

## What's New

xp-gate 已从 GitHub Packages（需要 PAT token）迁移到**公共 npm registry**（无需认证）。

### Install (now simple!)
```bash
npm install -g xp-gate
```
No PAT token needed. No `.npmrc` configuration required.

### Breaking Changes (from v0.4.x)
- Removed `prepare`/`postinstall` scripts that caused `exit 127` on global install
- Package name is `xp-gate` (no scope) on npmjs.com
- `install-skill` now defaults to package-local copy (offline-first)

### Migration
If you're upgrading from v0.4.x, see the [README migration guide](https://github.com/boyingliu01/xp-gate/blob/main/README.md#迁移指南-v04x--v05x) for step-by-step instructions.

### Known Limitations
- **No `xp-gate uninstall` command**: Manual cleanup required. See [README 手动卸载](https://github.com/boyingliu01/xp-gate/blob/main/README.md#手动卸载) section. Full uninstall CLI planned for v0.6.0.

### Issues Closed
- #86: fix global install exit 127 error
- #87: include skills in npm package (offline install)
- #88: include Claude Code plugin in npm package
- #89: automated publish CI
- #90: remove GitHub Packages registry dependency
