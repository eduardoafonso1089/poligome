# Local connector API (v1)

One HTTP contract for every helper that runs on the user's own machine — the COG
converter, local SAM, and anything added later. The same contract applies whether
the helper is a bare Python process or a container: only the address changes.

The shape is deliberately ordinary — REST over HTTP, JSON bodies, path
versioning, [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) errors, Server-Sent
Events for progress. Every piece is implementable with FastAPI, Express, Go's
`net/http` or Flask without a single extra dependency, and `curl` is enough to
exercise all of it.

## 1. Transport

| Rule | Value |
|---|---|
| Base path | `/v1` — the major version is in the path, never in a header |
| Bodies | `application/json; charset=utf-8`, except blob transfer and SSE |
| Bind address | loopback only. A container listens on `0.0.0.0` inside and is published as `-p 127.0.0.1:<port>:<port>` |
| Auth | none. The origin allowlist is the only boundary, so the service must never leave loopback |
| Encoding | all wire identifiers — paths, fields, states, error codes — are English `snake_case`, values that are identifiers are `lower.dotted` |

The browser reaches the helper from `https://poligome.com`, so every response
carries:

```
Access-Control-Allow-Origin: <echoed allowed origin>
Access-Control-Allow-Private-Network: true
Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Location, Retry-After
```

`Access-Control-Allow-Credentials` stays `false`; the protocol never uses cookies.
The allowlist stays configurable through `POLIGOME_ALLOWED_ORIGIN_REGEX`, anchored,
defaulting to the official origins plus local development.

Helpers built on a framework that generates OpenAPI (FastAPI does, at
`/openapi.json`) should keep it reachable and point at it from the manifest. It is
a convenience, not part of the contract.

## 2. Discovery — `GET /v1`

The client probes a short list of ports and identifies a helper by the operations
it declares, never by the port number. One container may serve every operation on
a single port; two separate processes may split them. The client code is the same.

```json
{
  "protocol": "poligome-connector",
  "api_version": 1,
  "service": "poligome-cog",
  "service_version": "1.2.0",
  "operations": [
    { "name": "cog.convert", "kind": "job", "progress": "sse" }
  ],
  "blobs": { "max_bytes": 8589934592, "range": true },
  "openapi": "/openapi.json"
}
```

`kind` is `job` or `sync` (§5, §6). `progress` is `poll` or `sse`. A client that
does not find an operation it needs in `operations` must treat the helper as
absent for that feature — it must not call the endpoint and hope.

A helper answering a major version the client does not speak is not usable: the
client says so instead of guessing. This is the versioning handle the current
connectors do not have.

## 3. Health — `GET /v1/health`

```json
{ "status": "ready", "jobs_running": 0, "detail": null }
```

`status` is `ready`, `starting`, `busy` or `error`. Return `200` for `ready` and
`busy`, `503` for `starting` and `error`, so a plain `response.ok` probe is
correct. `detail` is a human-readable string, or `null`.

Health is for liveness. Capabilities live in the manifest and are not repeated
here.

## 4. Blobs — binary in, binary out

Every binary the protocol moves is a blob. This replaces both the multipart
upload of the converter and the base64 data URL that SAM receives on each click.

Blobs are content-addressed: **the blob id is the lowercase hex SHA-256 of the
bytes**. Uploading the same content twice is therefore idempotent and free.

### `POST /v1/blobs?filename=<name>`

Body is the raw bytes with the real `Content-Type` (`image/tiff`, `image/png`, …).
`filename` is optional and advisory. A helper may also accept
`multipart/form-data` with a `file` field for `curl` convenience, but clients use
the raw form.

```json
{
  "id": "9f2c…",
  "bytes": 641204736,
  "media_type": "image/tiff",
  "filename": "ortho.tif",
  "existed": true
}
```

`existed` reports whether the helper already had those bytes. A client that
tracks it can skip re-uploading, which is what makes repeated SAM prompts on one
image cheap: the second click uploads nothing and the helper reuses the embedding
it already computed.

Helpers must stream the body to disk. Refuse above `blobs.max_bytes` with
`413` and `blob_too_large`.

### `GET /v1/blobs/{id}`

Returns the bytes. **Range support is mandatory** when the manifest says
`blobs.range: true`, and is what lets `geotiff.js` read a converted COG by tiles
instead of downloading it again. Answer `206` with `Content-Range` for a ranged
request, always advertise `Accept-Ranges: bytes`, and never place a proxy in
front that strips either.

### `DELETE /v1/blobs/{id}`

Discards the bytes. `204` on success, `204` if already gone — deletion is
idempotent.

## 5. Sync operations — `POST /v1/ops/{op}`

For work that finishes in about a second and is interactive. No job record, no
polling, no extra round trip.

```http
POST /v1/ops/sam.segment
{ "input": { "image": "blob:9f2c…", "points": [ { "x": 812, "y": 430, "label": 1 } ] } }
```

```json
{ "output": { "polygon": [[801,420],[848,431]], "score": 0.97 } }
```

The envelope is always `{"input": …}` in and `{"output": …}` out, so a client can
handle the transport without knowing the operation. Blob references are the
string `blob:<id>`.

A helper that cannot answer within its own deadline returns `504` with
`operation_timeout` rather than holding the connection open.

## 6. Jobs — work measured in minutes

```http
POST /v1/jobs
{ "op": "cog.convert", "input": { "source": "blob:9f2c…" } }
```

```http
202 Accepted
Location: /v1/jobs/7a31c0
Retry-After: 5
```

```json
{
  "id": "7a31c0",
  "op": "cog.convert",
  "state": "running",
  "progress": null,
  "created_at": "2026-09-15T18:40:02Z",
  "output": null,
  "error": null
}
```

`state` is `queued`, `running`, `succeeded`, `failed` or `canceled`.
`progress` is `null` when unknown, otherwise a number from 0 to 1 — a helper that
cannot measure real progress reports `null` rather than inventing a percentage.

### `GET /v1/jobs/{id}`

Returns the same object. While the job is not finished the response carries
`Retry-After` with the interval the helper wants, so the poll cadence is the
helper's decision instead of a constant compiled into the client. On
`succeeded`, `output` is populated; on `failed`, `error` holds a problem object
(§7).

### `GET /v1/jobs/{id}/events`

`text/event-stream`, offered only when the manifest says `progress: "sse"`.

```
event: state
data: {"state":"running","progress":0.42}

event: state
data: {"state":"succeeded","progress":1}
```

The stream closes once a terminal state is sent. SSE is an optimization: a client
must still be able to reach the same conclusion by polling, and must fall back to
polling if the stream drops.

### `DELETE /v1/jobs/{id}`

Cancels a running job and discards its record. `204`. Output blobs are not
deleted implicitly — the client deletes those through `DELETE /v1/blobs/{id}`
when it is done reading.

## 7. Errors — RFC 9457 problem details

Every non-2xx response, on every endpoint, has `Content-Type:
application/problem+json`:

```json
{
  "type": "https://poligome.com/errors/raster-invalid-tiff",
  "title": "The file does not contain a valid TIFF.",
  "status": 400,
  "code": "rasterInvalidTiff",
  "detail": "TIFF magic number not found at offset 0."
}
```

`code` is the contract. It is a stable identifier the client maps to a translated
message, and it matches the existing i18n keys in `app/lib/i18n.ts`, so the UI
keeps showing a localized sentence instead of a server string. `title` is an
untranslated fallback for humans reading `curl` output; `detail` is diagnostic
text that may be logged but is never the message shown to a user.

The client must never parse `title` or `detail` to decide what happened. That
replaces the current practice of throwing an `Error` whose message doubles as a
translation key.

| `code` | HTTP | When |
|---|---|---|
| `connectorUnsupportedVersion` | 400 | client asked for a major version the helper does not speak |
| `connectorInvalidInput` | 400 | the `input` envelope failed validation |
| `blobNotFound` | 404 | `blob:<id>` does not exist |
| `blobTooLarge` | 413 | above `blobs.max_bytes` |
| `rasterInvalidTiff` | 400 | source is not a readable TIFF |
| `jobNotFound` | 404 | unknown job id |
| `operationUnavailable` | 404 | operation not in the manifest |
| `operationTimeout` | 504 | sync operation exceeded its deadline |
| `modelLoading` | 503 | the model is not ready yet |
| `connectorInternal` | 500 | anything unhandled |

Helpers may add codes; clients must degrade to a generic message for a code they
do not recognize.

## 8. Operation catalogue

### `cog.convert` — kind `job`

```json
{ "source": "blob:9f2c…" }
```

```json
{
  "result": "blob:41ab…",
  "media_type": "image/tiff",
  "bytes": 623445120,
  "megapixels": 3288.4,
  "valid_cog": true,
  "profile": "deflate"
}
```

The client reads the result through `GET /v1/blobs/41ab…` with Range.

### `sam.segment` — kind `sync`

```json
{
  "image": "blob:9f2c…",
  "points": [ { "x": 812, "y": 430, "label": 1 } ],
  "multimask": false
}
```

```json
{
  "polygon": [[801,420],[848,431],[860,488]],
  "score": 0.97,
  "image": { "width": 1600, "height": 1200 },
  "reused_embedding": true
}
```

`polygon` has exactly one shape and there is no negotiation about it:

- an array of `[x, y]` pairs, never a flat array, never a mask matrix;
- coordinates in **source pixels of the uploaded blob**, never normalized;
- the exterior ring only, not closed — the first vertex is not repeated;
- at least three vertices, or the helper returns a `422` problem instead.

Pinning this is the point of the exercise: the current client accepts six
different response shapes because the contract was never written down.

## 9. Mapping from the current connectors

| Today | v1 |
|---|---|
| `GET /health` | `GET /v1/health` plus `GET /v1` for capabilities |
| `POST /converter`, multipart field `arquivo` | `POST /v1/blobs` then `POST /v1/jobs` with `cog.convert` |
| `GET /trabalhos/{id}` | `GET /v1/jobs/{id}` |
| `GET /arquivos/{id}` | `GET /v1/blobs/{id}` |
| `DELETE /arquivos/{id}` | `DELETE /v1/blobs/{id}` |
| `POST /predict`, image as base64 data URL | `POST /v1/blobs` once, then `POST /v1/ops/sam.segment` per click |
| states `convertendo`/`pronto`/`erro` | `running`/`succeeded`/`failed` |
| `detalhe`, `detail`, thrown message strings | problem object with a stable `code` |
| endpoint hardcoded per port | manifest matched by operation name |

## 10. Rollout

The v1 paths do not collide with any current path, so a helper can serve both
while clients migrate. The order that keeps the app working at every step:

1. Helpers add `/v1` alongside the existing routes and keep the old ones
   answering.
2. The client probes `GET /v1` first and falls back to the legacy shape when the
   manifest is absent.
3. Once a released helper version serves `/v1`, the legacy routes are removed and
   the client fallback goes with them.

Nothing here is specific to containers. A container is one way to ship a helper
that speaks this protocol; a plain `python poligome-cog-local.py` is another, and
the browser cannot tell them apart.
