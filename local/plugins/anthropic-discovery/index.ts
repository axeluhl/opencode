import { Model, Plugin, Provider } from "@opencode/plugin/effect"
import { Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

const Endpoint = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  baseURL: Schema.String.check(Schema.isPattern(/^https?:\/\//)),
  authToken: Schema.String.pipe(Schema.optional),
  apiKey: Schema.String.pipe(Schema.optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
})

const Options = Schema.Struct({
  providers: Schema.Record(Provider.ID, Endpoint),
  refreshIntervalMs: Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.withDecodingDefault(Effect.succeed(60_000))),
})

const Page = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Model.ID, display_name: Schema.String })),
  has_more: Schema.Boolean,
  last_id: Schema.NullOr(Schema.String),
})

export default Plugin.define({
  id: "local.anthropic-discovery",
  effect: Effect.fn(
    function* (ctx) {
      const options = yield* Schema.decodeUnknownEffect(Options)(ctx.options)
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

      yield* Effect.forEach(
        Object.entries(options.providers),
        ([id, endpoint]) =>
          Effect.gen(function* () {
            const providerID = Provider.ID.make(id)
            if (endpoint.apiKey && endpoint.authToken)
              return yield* Effect.fail(new Error(`${id}: configure either apiKey or authToken, not both`))

            const source: { models: typeof Page.Type.data } = { models: [] }
            yield* ctx.provider.transform((editor) => {
              const catalog = Array.from(editor.get("anthropic")?.models.values() ?? [])
              editor.add({
                info: {
                  ...Provider.Info.empty(providerID),
                  name: endpoint.name ?? id,
                  canonical: Provider.ID.anthropic,
                  activation: "enabled",
                  package: "@opencode/ai/providers/anthropic-compatible",
                  settings: {
                    baseURL: endpoint.baseURL.replace(/\/+$/, ""),
                    ...(endpoint.authToken ? { authToken: endpoint.authToken } : {}),
                    ...(endpoint.apiKey ? { apiKey: endpoint.apiKey } : {}),
                  },
                  headers: endpoint.headers,
                },
                models: source.models.map((item) => {
                  const key = item.id.replace(/\[1m\]$/i, "")
                  const template =
                    catalog.find((model) => model.id === key) ??
                    catalog.find((model) => model.id.startsWith(`${key}-`) && /-\d{8}$/.test(model.id))
                  const base = template ?? Model.Info.default(providerID, item.id)
                  return {
                    ...structuredClone(base),
                    id: item.id,
                    modelID: item.id,
                    providerID,
                    canonical: Provider.ID.anthropic,
                    name: item.display_name,
                    // Inherit metadata, never the catalog's endpoint, authentication, or billing rates.
                    package: undefined,
                    settings: undefined,
                    headers: undefined,
                    body: undefined,
                    cost: [],
                    enabled: true,
                    status: "active",
                    capabilities: template?.capabilities ?? {
                      tools: true,
                      input: ["text", "image", "pdf"],
                      output: ["text"],
                    },
                    limit: {
                      ...base.limit,
                      ...(key !== item.id ? { context: 1_000_000, input: undefined } : {}),
                    },
                  }
                }),
              })
            })

            const refresh = Effect.gen(function* () {
              const models = yield* discover(http, endpoint).pipe(Effect.timeout("10 seconds"))
              if (JSON.stringify(models) === JSON.stringify(source.models)) return
              source.models = models
              yield* ctx.provider.reload()
            }).pipe(
              // Publish only complete inventories; a failed refresh keeps the last successful one.
              Effect.catch(() => Effect.logWarning("Anthropic model discovery failed; will retry", { providerID })),
            )

            yield* refresh
            yield* Effect.sleep(options.refreshIntervalMs).pipe(
              Effect.andThen(refresh),
              Effect.forever,
              Effect.forkScoped,
            )
          }),
        { concurrency: "unbounded", discard: true },
      )
    },
    Effect.provide(FetchHttpClient.layer),
    Effect.orDie,
  ),
})

function discover(http: HttpClient.HttpClient, endpoint: typeof Endpoint.Type) {
  return Effect.gen(function* () {
    const url = new URL(`${endpoint.baseURL.replace(/\/+$/, "")}/v1/models`)
    const models: (typeof Page.Type.data)[number][] = []
    const cursors = new Set<string>()
    while (true) {
      const page = yield* http
        .execute(
          HttpClientRequest.get(url.href).pipe(
            HttpClientRequest.setHeaders({
              accept: "application/json",
              "anthropic-version": "2023-06-01",
              ...endpoint.headers,
              ...(endpoint.authToken ? { authorization: `Bearer ${endpoint.authToken}` } : {}),
              ...(endpoint.apiKey ? { "x-api-key": endpoint.apiKey } : {}),
            }),
          ),
        )
        .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Page)))
      models.push(...page.data)
      if (!page.has_more) return models
      if (!page.last_id || cursors.has(page.last_id))
        return yield* Effect.fail(new Error("Anthropic model inventory has an invalid pagination cursor"))
      cursors.add(page.last_id)
      url.searchParams.set("after_id", page.last_id)
    }
  })
}
