# Contributing to ARCLUME

Thank you for considering contributing to ARCLUME!

This repository is the **public distribution and documentation surface** of
ARCLUME: it hosts the releases, the public documentation, the changelog, the
security policy, and the brand assets. The ARCLUME **source development
repository is private**, so this public repository does not accept code
pull requests.

## How to contribute

- **Report a bug or request a feature** — open a GitHub Issue. Please include
  the ARCLUME version you are using (see `ARCLUME.exe --version`), your
  Windows version, and the steps to reproduce.
- **Report a security issue** — do **not** open a public issue. Follow the
  disclosure instructions in [SECURITY.md](SECURITY.md).
- **Documentation** — typo fixes and clarifications to the public
  documentation are welcome as pull requests against this repository. Keep
  them limited to user-facing, public information.
- **Source code** — the development repository is private. To contribute code,
  open an issue describing the change you want to make; the maintainers will
  coordinate the contribution through the private repository.

## Pull request expectations

- **Scope** — one logical change per PR.
- **Public-only content** — do not add internal documentation, source code,
  test fixtures, CI configuration, or build tooling to this repository.
- **No dead links** — every relative link and image referenced by the
  documentation must resolve to a file that exists in this repository.

## Documentation standards

- Update the README (`README.md` and `README.es.md`) and the relevant docs
  under `docs/` if user-facing behavior changes.
- Keep `README.md` and `README.es.md` in substantial parity.

## Questions?

Open a GitHub Issue for design questions before implementing large changes.