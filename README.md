# cline-proxy

A local OpenAI-compatible HTTP server that routes chat requests through your
**Cline CLI provider configuration**. Point any OpenAI-SDK-compatible client
at it and use the models Cline is configured to use — with Cline's headers
(`User-Agent: Cline/…`, `X-CLIENT-*`, `X-Title`, billing headers, …).

- Tool calling: `tools`/`functions` are passed through to the provider and
  stream back as OpenAI-style `tool_calls` (`finish_reason: "tool_calls"`).
  The client owns the tool loop — execute tools yourself and send results
  back as `tool` messages with `tool_call_id`. (The proxy never executes
  tools.) `tool_choice` accepts `"auto"`/`"none"`/`"required"` or a named
  `{"type": "function", "function": {"name": ...}}`; legacy `function_call`
  and `function` messages are rejected with HTTP 400.
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

# With tools (client owns the loop):
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the weather for a city",
        "parameters": {"type": "object", "properties": {"city": {"type": "string"}}},
    },
}]
first = client.chat.completions.create(
    model="anthropic/claude-sonnet-5",
    messages=[{"role": "user", "content": "Weather in Paris?"}],
    tools=tools,
)
msg = first.choices[0].message
if msg.tool_calls:
    results = [{"role": "tool", "tool_call_id": c.id, "content": "sunny, 21C"}
               for c in msg.tool_calls]
    second = client.chat.completions.create(
        model="anthropic/claude-sonnet-5",
        messages=[
            {"role": "user", "content": "Weather in Paris?"},
            {"role": "assistant", "content": msg.content, "tool_calls": [
                {"id": c.id, "type": "function",
                 "function": {"name": c.function.name, "arguments": c.function.arguments}}
                for c in msg.tool_calls]},
            *results,
        ],
        tools=tools,
    )
    print(second.choices[0].message.content)
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
   messages, tools)` — tools become Cline `ToolDefinition`s.
4. Translates the resulting `ApiStream` (`text`/`tool_calls`/`usage` chunks)
   into OpenAI response shapes (`finish_reason: "tool_calls"` when the model
   calls tools). Tool results come back as `tool` messages on the next
   request; the proxy never executes tools itself.

## Develop

```sh
npm install
npm test        # bun test
npm run typecheck
npm run build   # emits dist/, bin: cline-proxy
```
