# cline-proxy

A local OpenAI-compatible HTTP server that routes chat requests through your
**Cline CLI provider configuration**. Point any OpenAI-SDK-compatible client
at it and use the models Cline is configured to use — with Cline's headers
(`User-Agent: Cline/…`, `X-CLIENT-*`, `X-Title`, billing headers, …).

- No tool loop: requests containing `tools`/`functions`/`tool_choice` and
  `tool`/`function` messages are rejected with HTTP 400.
- Models are addressed as `"providerId/model-slug"`
  (e.g. `"anthropic/claude-sonnet-5"`). A bare model id resolves against the
  served catalog; omitting `model` uses your Cline default.

## Install

Requires Node ≥ 22 (or Bun).

```sh
npm install -g cline-proxy
# or from source:
git clone <this-repo> && cd cline-proxy && npm install && npm run build
```

## Cline detection

On startup the proxy locates **your** Cline installation on the machine:

| Value | Resolution order |
|---|---|
| Cline dir | `--cline-dir` → `CLINE_DIR` → `~/.cline` |
| Data dir | `--data-dir` → `CLINE_DATA_DIR` → `<clineDir>/data` |
| Providers file | `--providers-path` → `CLINE_PROVIDER_SETTINGS_PATH` → `<dataDir>/settings/providers.json` |

If no `providers.json` exists (or no configured provider is usable),
startup fails with a message telling you to run `cline auth` first.
Only providers that are actually usable (credentials present, or a keyless
local endpoint) are served; models come from Cline's bundled catalog
(`getModelsForProvider(id, { filter: "chat" })`).

## Usage

```sh
cline-proxy serve [--port 18789] [--host 127.0.0.1]
```

Then, from any other project:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:18789/v1", api_key="not-needed")
models = client.models.list()  # only your configured Cline providers

completion = client.chat.completions.create(
    model="anthropic/claude-sonnet-5",
    messages=[
        {"role": "system", "content": "Be terse."},
        {"role": "user", "content": "Hello!"},
    ],
    stream=True,
)
for chunk in completion:
    print(chunk.choices[0].delta.content or "", end="")
```

Node.js:

```ts
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "http://127.0.0.1:18789/v1", apiKey: "not-needed" });
const completion = await client.chat.completions.create({
  model: "anthropic/claude-sonnet-5",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(completion.choices[0]?.message.content);
```

## Endpoints

- `GET /v1/models` → `{ object: "list", data: [{ id, object: "model", created, owned_by }] }`
- `POST /v1/chat/completions` → OpenAI `chat.completion` (non-streaming) or
  SSE `chat.completion.chunk` events ending with `data: [DONE]`
  (streaming; `stream_options.include_usage` honored)
- `GET /health` (or `/`) → `{ status, service, models, defaultModel, settingsPath }`

Per-request `max_tokens`/`max_completion_tokens`/`temperature` override the
stored Cline settings for that call only.

## How it works

1. Reads your `providers.json` via `ProviderSettingsManager` (from
   `@cline/core`), same class the CLI uses.
2. Builds the served catalog from usable providers only.
3. Per request: stored settings → `toProviderConfig` with the requested
   model → Cline billing headers via `resolveProviderRequestHeaders`
   (from `@cline/llms`, `source: "proxy"`, `client: cline-proxy`) →
   `createHandlerAsync(config)` → `handler.createMessage(systemPrompt,
   messages)` with **no tools**.
4. Translates the resulting `ApiStream` (`text`/`usage` chunks) into
   OpenAI response shapes.

## Develop

```sh
npm install
npm test        # bun test
npm run typecheck
npm run build   # emits dist/, bin: cline-proxy
```
