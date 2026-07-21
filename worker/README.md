# Optomole Build Worker

Consumes build jobs, validates generated specifications, creates engine projects from templates, invokes build tools, collects logs/artifacts, and uploads outputs to S3/MinIO.

```bash
npm install
npm start
```

The worker entrypoint is `index.js`. It dispatches on `command.target`:

| Target | Builder | Engine binary (real build) | Fallback |
|--------|---------|----------------------------|----------|
| `unreal` | `unreal.js` | `UE_PATH` (Windows) | simulate |
| `unity` | `unity.js` | `UNITY_PATH` | simulate |
| `blender` | `blender.js` | `BLENDER_PATH` | simulate |

Each builder generates a real engine project from the compiled experience via
`project-generator.js` (copies `templates/<engine>/` and injects the game spec),
then invokes the engine CLI — or simulates when the engine isn't installed,
still writing the generated project into the artifact under `project-source/`.

`browser` / `mobile` / `pixijs` never reach the worker; the gateway serves those
inline.

