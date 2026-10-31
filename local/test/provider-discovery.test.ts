import { expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import Discovery from "../plugins/anthropic-discovery/index"
import { testEffect } from "../../packages/core/test/lib/effect"
import { PluginTestLayer } from "../../packages/core/test/plugin/fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("test-proxy")
const item = (id: string) => ({ id, display_name: `Advertised ${id}` })
const page = (...ids: string[]) => ({ data: ids.map(item), has_more: false, last_id: ids.at(-1) ?? null })

const setup = Effect.fn(function* (endpoint: { baseURL: string; authToken?: string; apiKey?: string }) {
  const plugins = yield* Plugin.Service
  const ctx = yield* PluginHost.make(plugins)
  yield* Discovery.effect({
    ...ctx,
    options: { providers: { [providerID]: { name: "Local Proxy", ...endpoint } } },
  })
})

it.live("loads all pages over HTTP and preserves advertised IDs, names, and authentication", () =>
  Effect.gen(function* () {
    const requests: { path: string; authorization: string | null; version: string | null }[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            const url = new URL(request.url)
            requests.push({
              path: url.pathname + url.search,
              authorization: request.headers.get("authorization"),
              version: request.headers.get("anthropic-version"),
            })
            return Response.json(
              url.searchParams.has("after_id")
                ? page("claude-sonnet-4-6[1m]", "future-model")
                : { data: [item("claude-sonnet-4-6")], has_more: true, last_id: "claude-sonnet-4-6" },
            )
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    yield* setup({ baseURL: `${server.url.origin}/anthropic/`, authToken: "test-token" })
    const models = yield* Model.Service
    const providers = yield* Provider.Service
    expect(
      (yield* models.available()).filter((model) => model.providerID === providerID).map((model) => model.id),
    ).toEqual(["claude-sonnet-4-6", "claude-sonnet-4-6[1m]", "future-model"])
    expect(yield* models.get(providerID, Model.ID.make("future-model"))).toMatchObject({
      modelID: "future-model",
      name: "Advertised future-model",
      limit: { context: 200_000, output: 32_000 },
      capabilities: { tools: true, input: ["text", "image", "pdf"] },
    })
    expect(yield* models.get(providerID, Model.ID.make("claude-sonnet-4-6[1m]"))).toMatchObject({
      modelID: "claude-sonnet-4-6[1m]",
      limit: { context: 1_000_000 },
    })
    expect(yield* providers.get(providerID)).toMatchObject({
      name: "Local Proxy",
      package: "@opencode/ai/providers/anthropic-compatible",
      settings: { baseURL: `${server.url.origin}/anthropic/v1`, authToken: "test-token" },
    })
    expect(requests).toEqual([
      { path: "/anthropic/v1/models", authorization: "Bearer test-token", version: "2023-06-01" },
      {
        path: "/anthropic/v1/models?after_id=claude-sonnet-4-6",
        authorization: "Bearer test-token",
        version: "2023-06-01",
      },
    ])
  }),
)

it.effect("inherits catalog metadata without importing unadvertised models or upstream request settings", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const ctx = yield* PluginHost.make(plugins)
    yield* ctx.provider.transform((editor) => {
      editor.add({
        info: { ...Provider.Info.empty(Provider.ID.anthropic), activation: "disabled" },
        models: ["claude-haiku-4-5-20251001", "unadvertised"].map((id) => ({
          ...Model.Info.default(Provider.ID.anthropic, Model.ID.make(id)),
          limit: { context: 200_000, input: 180_000, output: 64_000 },
          settings: { baseURL: "https://wrong.example", apiKey: "catalog-secret" },
          headers: { "x-upstream": "wrong" },
          body: { model: "wrong" },
          variants: [
            { id: Model.VariantID.make("high"), settings: { thinking: { type: "enabled", budgetTokens: 16000 } } },
          ],
        })),
      })
    })
    const headers: (string | null)[] = []
    const http = transport((request) => {
      headers.push(request.headers.get("x-api-key"))
      return Response.json(page("claude-haiku-4-5"))
    })
    yield* setup({ baseURL: "http://proxy/anthropic", apiKey: "test-key" }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, http),
    )
    const models = yield* Model.Service
    const model = yield* models.get(providerID, Model.ID.make("claude-haiku-4-5"))
    expect(model).toMatchObject({
      limit: { context: 200_000, input: 180_000, output: 64_000 },
      variants: [{ id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } }],
      settings: { baseURL: "http://proxy/anthropic/v1", apiKey: "test-key" },
    })
    expect(model?.headers?.["x-upstream"]).toBeUndefined()
    expect(model?.body?.model).toBeUndefined()
    expect(yield* models.get(providerID, Model.ID.make("unadvertised"))).toBeUndefined()
    expect(headers).toEqual(["test-key"])
  }),
)

it.effect("refreshes every minute, keeps the last good inventory on failure, and accepts empty lists", () =>
  Effect.gen(function* () {
    const remote = { response: Response.json(page("first")), requests: 0 }
    const http = transport(() => {
      remote.requests++
      return remote.response.clone()
    })
    yield* setup({ baseURL: "http://proxy/anthropic" }).pipe(Effect.provideService(FetchHttpClient.Fetch, http))
    const models = yield* Model.Service
    const ids = models
      .available()
      .pipe(Effect.map((items) => items.filter((model) => model.providerID === providerID).map((model) => model.id)))
    expect(yield* ids).toEqual(["first"])

    remote.response = Response.json(page("second"))
    yield* TestClock.adjust("60 seconds")
    yield* until(ids, (items) => items.join() === "second")
    expect(remote.requests).toBe(2)

    remote.response = new Response("Unavailable", { status: 503 })
    yield* TestClock.adjust("60 seconds")
    expect(remote.requests).toBe(3)
    expect(yield* ids).toEqual(["second"])

    remote.response = Response.json({ data: [item("partial")], has_more: true, last_id: null })
    yield* TestClock.adjust("60 seconds")
    expect(remote.requests).toBe(4)
    expect(yield* ids).toEqual(["second"])

    remote.response = Response.json(page())
    yield* TestClock.adjust("60 seconds")
    yield* until(ids, (items) => items.length === 0)
    expect(remote.requests).toBe(5)
  }),
)

it.effect("recovers from a failed startup and stops requests when the plugin unloads", () =>
  Effect.gen(function* () {
    const remote = { response: new Response(null, { status: 503 }), requests: 0 }
    const http = transport(() => {
      remote.requests++
      return remote.response.clone()
    })
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
    yield* setup({ baseURL: "http://proxy/anthropic" }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, http),
      Scope.provide(scope),
    )
    const models = yield* Model.Service
    expect(yield* models.get(providerID, Model.ID.make("recovered"))).toBeUndefined()
    remote.response = Response.json(page("recovered"))
    yield* TestClock.adjust("60 seconds")
    yield* until(models.get(providerID, Model.ID.make("recovered")), (model) => model !== undefined)
    expect(remote.requests).toBe(2)
    yield* Scope.close(scope, Exit.void)
    yield* TestClock.adjust("120 seconds")
    expect(remote.requests).toBe(2)
    expect(yield* models.get(providerID, Model.ID.make("recovered"))).toBeUndefined()
  }),
)

it.effect("cancels an in-flight refresh when the plugin unloads", () =>
  Effect.gen(function* () {
    const started = Promise.withResolvers<void>()
    const aborted = Promise.withResolvers<void>()
    const requests = { count: 0 }
    const http = transport((request) => {
      requests.count++
      if (requests.count === 1) return Response.json(page("first"))
      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener(
          "abort",
          () => {
            aborted.resolve()
            reject(new Error("aborted"))
          },
          { once: true },
        )
        started.resolve()
      })
    })
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
    yield* setup({ baseURL: "http://proxy/anthropic" }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, http),
      Scope.provide(scope),
    )
    yield* TestClock.adjust("60 seconds")
    yield* Effect.promise(() => started.promise)
    yield* Scope.close(scope, Exit.void)
    yield* Effect.promise(() => aborted.promise)
    yield* TestClock.adjust("120 seconds")
    expect(requests.count).toBe(2)
  }),
)

function transport(respond: (request: Request) => Response | Promise<Response>) {
  return Object.assign(
    (input: string | URL | Request, init?: RequestInit) => Promise.resolve(respond(new Request(input, init))),
    { preconnect: fetch.preconnect },
  )
}

// Response.json() is asynchronous even with an in-process HTTP transport. Yield to its completion without advancing
// the polling clock; the predicate observes the real model registry after the plugin publishes the inventory.
function until<A>(read: Effect.Effect<A>, ready: (value: A) => boolean) {
  return Effect.gen(function* () {
    const deadline = Date.now() + 10_000
    while (true) {
      const value = yield* read
      if (ready(value)) return value
      if (Date.now() >= deadline) return yield* Effect.fail(new Error("Model inventory did not update"))
      yield* Effect.yieldNow
    }
  })
}
