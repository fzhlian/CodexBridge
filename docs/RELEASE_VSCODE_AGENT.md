# VSCode Agent Release Guide

## 1. Version and Tag Rules

- Extension version source: `packages/vscode-agent/package.json` -> `version`
- Git tag format: `vX.Y.Z`
- VSIX artifact format: `codexbridge-agent-${version}.vsix`

## 2. Trigger Packaging

Two options:

1. Push a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

2. Manual workflow run:

- GitHub Actions -> `vscode-agent-package` -> `Run workflow`

## 3. Download Build Artifacts

From the workflow run artifacts, download:

- `codexbridge-agent-${version}.vsix`
- `codexbridge-agent-${version}.vsix.sha256`
- `release-notes.md`

Verify checksum:

```bash
sha256sum -c codexbridge-agent-${version}.vsix.sha256
```

## 4. Marketplace Manual Publish

1. Open Visual Studio Marketplace publisher page.
2. Select the `fzhlian` publisher.
3. Upload `codexbridge-agent-${version}.vsix`.
4. Paste or attach `release-notes.md` content.
5. Confirm publish.

## 5. Rollback Strategy

If a release is bad:

1. Re-publish the previous known-good VSIX version.
2. Announce rollback version in team channel.
3. Add follow-up issue with failed version tag and root cause.
