# Offline compiler model (One Touch GGUF → Ollama)

The compiler's `local` provider runs the ExperienceManifest compile against a
local, OpenAI-compatible server instead of calling out to Anthropic/OpenAI/Gemini.
No API key, no external network call. The gateway talks to it at
`LOCAL_AI_BASE_URL` (default `http://localhost:11434/v1`) using model
`LOCAL_AI_MODEL` (default `claude-sonnet-reasoning`).

The model file is `claude-3.7-sonnet-reasoning-gemma3-12B.Q8_0.gguf` (12.5 GB) on
the **One Touch** drive.

## Disk constraint (read first)

`ollama create` copies the GGUF into Ollama's model store. The internal disk has
only ~12 GB free, which won't hold a 12.5 GB copy. Relocate Ollama's store to the
One Touch drive (2.7 TB free) — this also keeps the model on the drive.

## One-time setup

```bash
# 1. Quit the running Ollama (menubar app or: pkill ollama), so we can restart it
#    with the model store on the external drive.
pkill ollama

# 2. Point Ollama's store at the drive and start the server (keep this shell open,
#    or set OLLAMA_MODELS permanently via launchctl / the Ollama app settings).
export OLLAMA_MODELS="/Volumes/One Touch/ollama-models"
mkdir -p "$OLLAMA_MODELS"
ollama serve &

# 3. Register the GGUF as `claude-sonnet-reasoning` (copies 12.5 GB to the drive).
cd /Users/ethertechnology/Desktop/Optomole
ollama create claude-sonnet-reasoning -f scripts/local-model/Modelfile

# 4. Smoke-test the endpoint the gateway will use.
curl -s http://localhost:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-sonnet-reasoning","stream":false,
       "messages":[{"role":"user","content":"Reply with {\"ok\":true} only."}],
       "response_format":{"type":"json_object"}}'
```

Relocating `OLLAMA_MODELS` hides models kept in the old default store (e.g.
`llama3.2`). Re-pull any you still want (`ollama pull llama3.2`) — they'll land in
the new drive-backed store.

## Using it

In the console's AI compiler panel, pick **Local (offline)** as the provider and
compile. The gateway needs no restart; it reads the endpoint/model from config at
request time. To use a different tag or a remote OpenAI-compatible server, set
`LOCAL_AI_MODEL` / `LOCAL_AI_BASE_URL` in `api/.env`.
