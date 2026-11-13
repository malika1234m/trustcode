# Update and release architecture

## Distribution

The extension is distributed as a `.vsix` attached to GitHub Releases of `malika1234m/trustcode`. It is **not** on
the VS Code Marketplace or Open VSX (`"private": true`), so VS Code's own auto-update does not apply. If it is
published to a marketplace later, that channel should take over and the built-in check below should be removed.

## What the extension does

1. At most once a day (`trustcode.updates.check`, on by default), and on **TrustCode: Check for Updates**, it reads
   `api.github.com/repos/malika1234m/trustcode/releases/latest`. No account or project data is sent.
2. The response is validated: a `vMAJOR.MINOR.PATCH` tag, not a draft or pre-release, and links only under the
   project's own GitHub path.
3. If the release is newer than the installed version, a notification and the Account tab show the version and
   release notes.
4. **Download, verify and install** is offered only when the release has both `trustcode-X.Y.Z.vsix` and
   `trustcode-X.Y.Z.vsix.sha256`. The package is downloaded, its SHA-256 compared with the published one, and
   installed through VS Code's own installer. A mismatch or failed download leaves the installed version untouched
   and offers the release page instead.
5. Never offered: an older or equal version (no downgrade), or an install while a scan is running.

## Compatibility

- The server reports `api_version` and `min_extension_version` on `/api/v1/health`; the Account tab warns when the
  installed extension is older than the server supports.
- API changes so far are additive (new endpoints and fields); older extensions keep working.
- The local scanner reports its own version in every report; rules and engine ship together in one package.
- VS Code compatibility is declared in the package (`engines.vscode`), which VS Code enforces at install time.

## Release checklist

1. `cd extension && npm test && npx vsce package --no-dependencies`
2. `python -m pytest verification-worker/tests && (cd backend && python -m pytest tests)`
3. `scripts/e2e/run_vscode_integration.sh` (real VS Code)
4. `shasum -a 256 trustcode-X.Y.Z.vsix | awk '{print $1}' > trustcode-X.Y.Z.vsix.sha256`
5. Apply database migrations before deploying the backend; deploy; check `/api/v1/health`.
6. `gh release create vX.Y.Z trustcode-X.Y.Z.vsix trustcode-X.Y.Z.vsix.sha256 --notes-file …`

## Limits

- The checksum is published in the same release as the package: it detects corruption and a tampered download,
  not a compromised GitHub account. Signed releases are not implemented.
- Release 0.8.0 was published without a checksum file, so it can only be installed manually.
- There is no automated release pipeline; the steps above are run by hand.

## The engine travels with the extension (1.0.0)

The `.vsix` contains the engine wheel (`engine/trustcode_worker-<version>-py3-none-any.whl`), built by
`npm run bundle-engine` as part of `npm run package`. An extension update therefore carries its matching engine:
the environment directory is named after the wheel's SHA-256, so a new wheel leads to a new setup prompt and the
previous environment is deleted after the new one passes its self-check. The engine's third-party tools are
downloaded from PyPI at setup time and are not covered by the `.vsix` checksum.

Release steps: `npm test` → `npm run package` → `shasum -a 256 trustcode-<v>.vsix > trustcode-<v>.vsix.sha256` →
GitHub release `v<v>` with both files attached. The in-editor updater installs only when both assets exist and
the checksum matches.
