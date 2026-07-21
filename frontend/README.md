# Optimole Frontend

Operator console for the Optimole service architecture.

```bash
npm install
npm run dev
```

By default the app calls the API gateway at `http://localhost:8080/v1`.
Override it with:

```bash
VITE_OPTOMOLE_API_URL=http://localhost:8080/v1 npm run dev
```

Primary workflow:

1. Add source content.
2. Upload files, paste emails/newsletters, add URLs, or upload audio.
3. Normalize the source package into Optimole IRX.
4. Select a target engine.
5. Compile a game specification package.
6. Launch a build.
7. Poll build status and open the generated playable/download link.

Audio uploads are sent to the API transcription endpoint. The backend tries Whisper first, then Azure Speech, then an OpenAI transcription fallback model.

For higher-quality compilation, enable `Use AI Experience Compiler`, select
OpenAI, Claude, or Gemini, enter the desired model, and provide that provider's
API key. The key is used only for the current request.
