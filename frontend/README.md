# Abstract Essence frontend

Angular 22 research-learning workspace. Setup, backend configuration, architecture, limitations and verification commands are in [the project guide](../docs/README.md).

```sh
pnpm install --frozen-lockfile
pnpm start
```

The development server uses port 4201 and proxies `/api` to FastAPI on port 8001. No provider secrets belong in this project.
