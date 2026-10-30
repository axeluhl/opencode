import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const client = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

it.live("lists schedules across all enabled sessions when sessionID is omitted", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-schedule-list-")).path
    const global = path.join(dir, "global")
    const projectA = path.join(dir, "project-a")
    const projectB = path.join(dir, "project-b")
    yield* Effect.promise(async () => {
      await Promise.all([global, projectA, projectB].map((item) => fs.mkdir(item, { recursive: true })))
      await fs.writeFile(path.join(projectA, "opencode.json"), JSON.stringify({ experimental: { schedules: true } }))
      await fs.writeFile(path.join(projectB, "opencode.json"), JSON.stringify({ experimental: { schedules: true } }))
    })
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: path.join(dir, "opencode.db") },
      config: { directory: global, project: true, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const api = client(handler)

    let expectedID = ""
    yield* Effect.promise(async () => {
      const sessionA = await api.session.create({ location: { directory: projectA } })
      const sessionB = await api.session.create({ location: { directory: projectB } })

      const first = await api.experimental.schedule.create({
        sessionID: sessionA.id,
        name: "a-watch",
        when: { every: "1 hour" },
        prompt: "ping a",
      })
      expectedID = first.id
      const second = await api.experimental.schedule.create({
        sessionID: sessionB.id,
        name: "b-watch",
        when: { every: "2 hours" },
        prompt: "ping b",
      })

      const all = await api.experimental.schedule.list()
      expect(all.map((item) => item.id)).toEqual([first.id, second.id])

      const onlyA = await api.experimental.schedule.list({ sessionID: sessionA.id })
      expect(onlyA.map((item) => item.id)).toEqual([first.id])

      // Turning schedules off in project B hides project B's schedules from the cross-session list.
      await fs.writeFile(path.join(projectB, "opencode.json"), JSON.stringify({ experimental: { schedules: false } }))
    })
    const reloaded = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: path.join(dir, "opencode.db") },
      config: { directory: global, project: true, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    yield* Effect.promise(async () => {
      const filtered = await client(reloaded).experimental.schedule.list()
      expect(filtered.map((item) => item.id)).toEqual([expectedID])
    })
  }),
)
