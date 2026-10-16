# Locked dependency mitigations

These are local, narrowly scoped mitigations, **not upstream releases**. Package names and versions remain unchanged, so npm audit can still report 18 high findings. No audit result is filtered or suppressed.

- braces 3.0.3: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Reject parser nesting at 128 and preflight recursive walkers using an iterative child-edge traversal bounded to 128 levels / 65,536 nodes; cyclic or shared child nodes are rejected. Ordinary project globs are unchanged; unusually deep custom glob ASTs are intentionally rejected with SyntaxError.
- node-forge 1.4.0: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Require the nested DigestAlgorithm to have exactly the OID and optional empty NULL parameters accepted by the existing validator. No extra fields permitted. Existing algorithm allowlist and signature checks remain in place.

`scripts/apply-dependency-guards.cjs` checks installed versions and original/patched SHA256 against the manifest. It is idempotent, runs at postinstall and before local release builds, and refuses unknown source content. Review/remove guards on any upstream package update. `--ignore-scripts` installs must explicitly run `npm run verify:guards` before use.

Regression evidence lives in `tests/dependency-security.test.ts`: ordinary glob matching, excessive brace/parenthesis nesting in timeout-isolated process, cyclic ASTs, valid SHA1/256/384/512 signatures (with and without NULL), and malformed DigestAlgorithm rejection. These focused tests do not constitute a full third-party security audit.

The patches are small modifications applied to installed upstream files; upstream MIT license in braces and BSD-3-Clause option in node-forge remain unchanged. Full upstream source is not copied into this manifest. Application APK signing still uses Android apksigner, not these JavaScript cryptographic routines.
