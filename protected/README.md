# Protected tracker release

This protected entry preserves legacy device storage before activation. Cloud sync is off.
Use the in-app recovery-file verification gate before starting the upgraded tracker.
Private recovery files may contain credentials; retain them locally and never commit them.

Validation: 86 Node tests, four existing browser suites, production activation browser
suite, production worker rollout suite, and six generated PDF cases passed. Independent
review findings were fixed and rechecked. Legacy stores are never deleted by activation.

Source baseline: a5f7394116479974af347d1540a255681fab515c.
Protected cache revision: protected-2026-09-06-v1.
