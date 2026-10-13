# Account environment status

Forge installers publish account-scoped paths for reusable editable runtimes. Portal reads only known path variables for active Forge, then reports presence and filesystem validity through `GET /api/v1/environment` and Dashboard.

Contract: `forge/InstallEnvironment/v1`. Required values are `<PREFIX>_HOME`, `<PREFIX>_INSTALL_ROOT`, `<PREFIX>_VENV`, `<PREFIX>_PYTHON`, and `<PREFIX>_CLI`. `<PREFIX>_LAUNCHER` is optional. Portal never enumerates arbitrary environment variables or returns credentials.

Canonical prefixes use underscores (`SPARK_FORGE_AWS`, `PLATFORM_FORGE`, etc.) because POSIX shells reject hyphenated variable names. Windows installers additionally persist compatibility aliases in HKCU. States: `READY`, `PARTIAL`, `MISSING`, `INVALID`.
