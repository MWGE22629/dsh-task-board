/**
 * Task board Host half.
 *
 * Owns exactly one small JSON document — the board pointer table — and serves it
 * over the connection's exact-route RPC carrier:
 *
 *   POST /api/dsh-task-board   { type:'client-request', rpcId, method, payload:{method,payload} }
 *
 * The document holds only what cannot be derived: the pinned set, the draft
 * cards (with their unsent prompt), and the card -> session mapping. Session
 * bodies stay in the Session log, never here.
 */
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { spawn } from 'node:child_process'

const ENDPOINT = 'dsh-task-board'
const ROUTE = `/api/${ENDPOINT}`
const DOC_VERSION = 1

/** Resolve the board document beside the other DSH storages. */
function boardFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'storages', ENDPOINT, 'board.json')
}

/** Reject anything that cannot be a board document, then fill the defaults. */
function normalize(input) {
  const doc = input !== null && typeof input === 'object' ? input : {}
  const cards = Array.isArray(doc.cards) ? doc.cards : []
  return {
    version: DOC_VERSION,
    pinned: Array.isArray(doc.pinned) ? doc.pinned.filter((id) => typeof id === 'string') : [],
    partitions: Array.isArray(doc.partitions)
      ? doc.partitions.filter((id) => typeof id === 'string')
      : [],
    laneRows: doc.laneRows === 2 || doc.laneRows === 3 ? doc.laneRows : 1,
    cards: cards
      .filter((card) => card !== null && typeof card === 'object' && typeof card.id === 'string')
      .map((card, index) => ({
        id: card.id,
        title: typeof card.title === 'string' ? card.title : '',
        state: typeof card.state === 'string' ? card.state : 'draft',
        sessionId: typeof card.sessionId === 'string' ? card.sessionId : null,
        workspaceId: typeof card.workspaceId === 'string' ? card.workspaceId : null,
        workspacePath: typeof card.workspacePath === 'string' ? card.workspacePath : '',
        draftPrompt: typeof card.draftPrompt === 'string' ? card.draftPrompt : '',
        slot: Number.isInteger(card.slot) ? card.slot : index,
        createdAt: Number.isFinite(card.createdAt) ? card.createdAt : 0,
        // The classified Turn ending travels with the card so a restarted Host
        // never has to re-derive it from a session log.
        outcome: normalizeOutcome(card.outcome),
        lastText: typeof card.lastText === 'string' ? card.lastText.slice(0, 400) : '',
      })),
  }
}

/** One persisted `turn/end` classification, or null. */
function normalizeOutcome(value) {
  if (value === null || typeof value !== 'object') return null
  if (typeof value.kind !== 'string') return null
  const outcome = { kind: value.kind }
  if (typeof value.cause === 'string') outcome.cause = value.cause
  if (typeof value.code === 'string') outcome.code = value.code
  if (typeof value.message === 'string') outcome.message = value.message.slice(0, 400)
  if (Number.isFinite(value.turn)) outcome.turn = value.turn
  if (Number.isFinite(value.at)) outcome.at = value.at
  if (typeof value.text === 'string' && value.text !== '') outcome.text = value.text.slice(0, 400)
  return outcome
}

/**
 * Serialized access to the board document.
 *
 * Deliberately NOT memoized: `save()` never refreshed the cached copy, so a
 * second read (a page reload, an HMR re-apply, or a second window) was served
 * the document as of the FIRST read and silently reverted everything written
 * since. Reads always go to disk; the file is a few kilobytes.
 *
 * Writes are temp-file + atomic rename, and both directions share one queue so
 * a read can never interleave with a half-finished write.
 */
function createStore(file) {
  let queue = Promise.resolve()
  const chain = (run) => {
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  const load = () => chain(queue.then(async () => {
    try {
      return normalize(JSON.parse(await readFile(file, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') return normalize(null)
      throw error
    }
  }))

  const save = (next) => chain(queue.then(async () => {
    await mkdir(dirname(file), { recursive: true })
    // Keep the pre-shrink document. A client that rolled back to an older read
    // must never be able to shrink a larger board without a recoverable copy.
    try {
      const previous = normalize(JSON.parse(await readFile(file, 'utf8')))
      if (next.cards.length < previous.cards.length) {
        await writeFile(`${file}.bak`, `${JSON.stringify(previous, null, 2)}\n`, 'utf8')
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // An unreadable previous document is not a reason to refuse the write.
      }
    }
    const temp = `${file}.${process.pid}.tmp`
    const handle = await open(temp, 'w')
    try {
      await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, file)
    return next
  }))

  return { load, save }
}

function reply(rpcId, result) {
  return Response.json({ type: 'server-response', rpcId, result })
}

function failure(rpcId, code, message) {
  return reply(rpcId, { ok: false, error: { code, message, details: {} } })
}

export const name = ENDPOINT

/** `connection` supplies the exact-route carrier; without it persistence is off. */
export const inject = ['connection']

/** Keep the outcome table bounded; only recent cards are ever asked about. */
const OUTCOME_LIMIT = 400

/**
 * Last terminal Turn outcome per Session, folded from the Host `session/event`
 * feed. `turn/end` carries the whole `TurnEndReason`: completed / aborted (with
 * its AgentCancelCause) / blocked / error / max-tokens / interrupted / forked.
 *
 * Recorded Host-side on purpose: the Client must not subscribe to a parked
 * Session's stream, and the framework's Client status feed only carries a
 * boolean `running` — so "failed" and "stopped" are indistinguishable there.
 */
function createOutcomes() {
  const table = new Map()
  return {
    record(session, event, digest) {
      if (event?.type !== 'turn/end') return
      const reason = event.data?.reason
      if (reason === null || reason === undefined) return
      const sessionId = session?.id
      if (typeof sessionId !== 'string') return
      const entry = {
        kind: typeof reason.kind === 'string' ? reason.kind : 'unknown',
        turn: Number.isFinite(event.data?.turn) ? event.data.turn : null,
        at: Number.isFinite(event.time) ? event.time : Date.now(),
      }
      if (reason.kind === 'aborted') entry.cause = reason.reason?.kind ?? null
      if (reason.kind === 'error') {
        entry.code = reason.error?.code ?? null
        entry.message = reason.error?.message ?? null
      }
      // Carry the last visible output with the outcome: it is the only digest
      // field worth keeping after this Host process goes away.
      if (typeof digest?.text === 'string' && digest.text !== '') entry.text = digest.text
      table.delete(sessionId)
      table.set(sessionId, entry)
      if (table.size > OUTCOME_LIMIT) {
        const oldest = table.keys().next().value
        if (oldest !== undefined) table.delete(oldest)
      }
    },
    read(sessionIds) {
      const value = {}
      for (const id of sessionIds) {
        if (typeof id === 'string' && table.has(id)) value[id] = table.get(id)
      }
      return value
    },
    /** One entry, for the log-recall merge. */
    get(sessionId) {
      return table.get(sessionId)
    },
  }
}

/**
 * A compact live digest per Session, folded from the same Host `session/event`
 * feed: what the Turn is doing right now, and the last thing it produced.
 *
 * This exists because a parked board card has no Session stream of its own. The
 * Host folds one small record per Session and the Client polls it in one batch
 * (only while something is running), so the card can say "Bash · asar.mjs list"
 * or "正在写：…" without any Client-side subscription.
 */
const DIGEST_LIMIT = 400
const HINT_PREVIEW = 48
const TEXT_PREVIEW = 180

/** Collapse whitespace and cut to a readable preview. */
function clip(value, limit) {
  if (typeof value !== 'string') return ''
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

const HINT_KEYS = [
  'command', 'path', 'file_path', 'filePath', 'pattern', 'query', 'url',
  'name', 'description', 'prompt', 'text', 'title', 'goal',
]

/** The most meaningful short string inside a Tool call's arguments JSON. */
function toolHint(argumentsJson) {
  if (typeof argumentsJson !== 'string' || argumentsJson === '') return ''
  try {
    const parsed = JSON.parse(argumentsJson)
    if (parsed !== null && typeof parsed === 'object') {
      for (const key of HINT_KEYS) {
        const value = parsed[key]
        if (typeof value === 'string' && value.trim() !== '') return clip(value, HINT_PREVIEW)
        if (Array.isArray(value) && value.length > 0) {
          const joined = value.filter((item) => typeof item === 'string').join(' ')
          if (joined.trim() !== '') return clip(joined, HINT_PREVIEW)
        }
      }
      const first = Object.values(parsed).find((value) => typeof value === 'string' && value.trim() !== '')
      if (typeof first === 'string') return clip(first, HINT_PREVIEW)
    }
  } catch {
    // Arguments that are still streaming are not JSON yet; fall through to raw text.
  }
  return clip(argumentsJson, HINT_PREVIEW)
}

/** Joined `text` blocks of one Message. */
function messageText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join(' ')
}

// --- session-content search ----------------------------------------------
//
// The board searches only the sessions its cards already point at. That is a
// deliberate scope: those sessions exist, they have a window to open, and the
// search never turns the board into a second session browser.
//
// The query itself is a literal, case-insensitive, whitespace-flexible scan
// over the semantic text of user/assistant messages. It goes through
// `ctx.sessionQuery.filterEvents`, which is a full-log read with no FTS index
// — so it works with the default `openAt: never` deployment, at the price of
// reading each card's log per distinct query (memoized briefly below).

const SEARCH_MIN_CHARS = 2
const SEARCH_LIMIT = 40
const SEARCH_PER_SESSION = 4
const SEARCH_MAX_SESSIONS = 40
const SEARCH_SESSION_TIMEOUT_MS = 5000
const SEARCH_TOTAL_BUDGET_MS = 8000
const SEARCH_CACHE_TTL_MS = 15000
const SEARCH_CACHE_LIMIT = 24

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** Literal, case-insensitive, whitespace-flexible query pattern. */
function searchPattern(query) {
  const parts = query.trim().split(/\s+/u).map(escapeRegExp)
  return new RegExp(parts.join('\\s+'), 'iu')
}

/** Collapse all whitespace runs to one space. */
function collapseText(value) {
  return value.replace(/\s+/gu, ' ').trim()
}

/** A short excerpt centred on the first match, or null when it does not match. */
function snippetAround(text, pattern) {
  const match = pattern.exec(text)
  if (match === null) return null
  const start = Math.max(0, match.index - 70)
  const end = Math.min(text.length, match.index + match[0].length + 90)
  const head = start > 0 ? '…' : ''
  const tail = end < text.length ? '…' : ''
  return `${head}${collapseText(text.slice(start, end))}${tail}`
}

/** Semantic prose of one event, for the no-sessionQuery fallback. */
function eventProse(event) {
  if (event?.type === 'user/message') return messageText({ content: event.data?.content })
  if (event?.type === 'assistant/message') return messageText(event.data?.message)
  return ''
}

/** Reject after `ms`; the losing promise is left to settle on its own. */
function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('search timed out'), { code: 'taskboard/search-timeout' }))
    }, ms)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Search the sessions parked on the board.
 *
 * Cards are the authorization boundary: a session id reaches this function
 * only because a card on the board already carries it, and the card's
 * workspace decides which lane-scoped query can see it.
 */
function createSearch(ctx, store) {
  const cache = new Map()

  const remember = (key, value) => {
    cache.delete(key)
    cache.set(key, { at: Date.now(), value })
    if (cache.size > SEARCH_CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }

  const cached = (key) => {
    const entry = cache.get(key)
    if (entry === undefined) return undefined
    if (Date.now() - entry.at > SEARCH_CACHE_TTL_MS) {
      cache.delete(key)
      return undefined
    }
    return entry.value
  }

  /** Matching user/assistant documents for one session, live-first and surface-aware. */
  const documents = async (sessionId, query) => {
    const sessionQuery = ctx.get('sessionQuery')
    if (typeof sessionQuery?.filterEvents === 'function') {
      const docs = await sessionQuery.filterEvents(sessionId, [{ kind: 'text', text: query }])
      if (!Array.isArray(docs)) return []
      return docs.filter((doc) => doc.surface === 'current'
        && (doc.type === 'user/message' || doc.type === 'assistant/message'))
    }

    // Fallback for a deployment without the session-query service: read the
    // log through the persistence seam the board already uses for recall.
    const persistence = ctx.get('sessionPersistence')
    if (typeof persistence?.open !== 'function' || typeof persistence?.stat !== 'function') {
      throw new Error('session search is unavailable')
    }
    const snapshot = await persistence.stat(sessionId)
    if (snapshot === null || snapshot === undefined) return []
    const handle = await persistence.open(sessionId, 'read')
    try {
      const { events } = await handle.read()
      if (!Array.isArray(events)) return []
      const pattern = searchPattern(query)
      const hits = []
      for (const event of events) {
        const text = eventProse(event)
        if (text === '' || !pattern.test(text)) continue
        hits.push({ sessionId, seq: event.seq, type: event.type, time: event.time, text })
      }
      return hits
    } finally {
      await handle.close()
    }
  }

  return async function search(payload) {
    const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
    const requested = Array.isArray(payload?.workspaceIds)
      ? payload.workspaceIds.filter((id) => typeof id === 'string')
      : []
    const workspaceIds = requested.length > 0 ? requested : null
    if (query.length < SEARCH_MIN_CHARS) {
      return { items: [], scanned: 0, truncated: false, failed: 0 }
    }

    const doc = await store.load()
    const eligible = doc.cards.filter((card) => typeof card.sessionId === 'string'
      && (workspaceIds === null || workspaceIds.includes(card.workspaceId)))

    // One search per session even if two cards somehow point at it.
    const targets = []
    const seen = new Set()
    for (const card of eligible) {
      if (seen.has(card.sessionId)) continue
      seen.add(card.sessionId)
      targets.push(card)
      if (targets.length >= SEARCH_MAX_SESSIONS) break
    }

    const key = JSON.stringify([query.toLowerCase(), workspaceIds === null ? null : [...workspaceIds].sort()])
    const hit = cached(key)
    if (hit !== undefined) return hit

    const pattern = searchPattern(query)
    const items = []
    let scanned = 0
    let failed = 0
    let truncated = targets.length < eligible.length
    const startedAt = Date.now()

    for (const card of targets) {
      if (items.length >= SEARCH_LIMIT) {
        truncated = true
        break
      }
      if (Date.now() - startedAt > SEARCH_TOTAL_BUDGET_MS) {
        truncated = true
        break
      }
      scanned += 1
      let docs
      try {
        docs = await withTimeout(documents(card.sessionId, query), SEARCH_SESSION_TIMEOUT_MS)
      } catch (error) {
        failed += 1
        ctx.logger?.warn?.(`[dsh-task-board] search skipped ${card.sessionId}: ${error?.message ?? error}`)
        continue
      }
      const total = docs.length
      for (const item of docs.slice(0, SEARCH_PER_SESSION)) {
        if (items.length >= SEARCH_LIMIT) {
          truncated = true
          break
        }
        const snippet = snippetAround(item.text, pattern)
        if (snippet === null) continue
        items.push({
          cardId: card.id,
          sessionId: card.sessionId,
          seq: item.seq,
          type: item.type,
          time: Number.isFinite(item.time) ? item.time : null,
          snippet,
          total,
        })
      }
    }

    const value = { items, scanned, truncated, failed }
    remember(key, value)
    return value
  }
}

/** The text produced so far by one Assistant stream record list. */
function streamText(stream) {
  if (!Array.isArray(stream)) return ''
  const parts = []
  for (const record of stream) {
    if (record?.type === 'text-chunks' && Array.isArray(record.texts)) {
      for (const text of record.texts) if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('')
}

/**
 * Reveal one local path in the operating system's file manager.
 *
 * Reveal — not "run with the default application" — on purpose. This machine's
 * `.js` association is `JSFile → WScript.exe "%1"`, so handing a script to the
 * shell executes it silently instead of opening an editor; a code path that
 * claims to "open a file" must never run the file. Selecting the item in the
 * file manager is safe for every extension and leaves the choice of application
 * to the user.
 *
 * The Harness Web client exposes no path bridge of its own: the desktop preload
 * publishes only locale, a directory picker and `getPathForFile`, and
 * `/api/present.open` addresses only files a Tool present-ed inside a Session.
 * A plugin Host half is an ordinary Node process next to the user, so it asks
 * the shell directly.
 *
 * `ctx.subprocess` is deliberately not used: it is a managed-child seam whose
 * handles this process owns and would tear down on dispose, while a file-manager
 * window must outlive the request. argv is passed as a vector, never a shell
 * string, so a path with spaces or quotes cannot become command syntax.
 */
function revealerFor(platform) {
  if (platform === 'win32') {
    // `/select,` takes the path as ONE argument; explorer keeps its window.
    return { command: 'explorer.exe', args: ['/select,'] }
  }
  if (platform === 'darwin') return { command: 'open', args: ['-R'] }
  // Most Linux file managers have no portable reveal verb; the directory is the
  // closest honest equivalent.
  return { command: 'xdg-open', args: [], revealDirectory: true }
}

function createOpener(ctx) {
  return function openPath(request) {
    const target = typeof request === 'string' ? request : request?.path
    const base = typeof request === 'object' && request !== null ? request.base : undefined
    if (typeof target !== 'string' || target.trim() === '') {
      throw new Error('open: a path is required')
    }
    // A file mention often carries a path relative to the Session directory.
    const absolute = isAbsolute(target)
      ? target
      : (typeof base === 'string' && base !== '' ? join(base, target) : target)
    if (!isAbsolute(absolute)) {
      throw new Error(`open: cannot resolve "${target}" without a working directory`)
    }
    const { command, args, revealDirectory } = revealerFor(process.platform)
    const target_ = revealDirectory ? dirname(absolute) : absolute
    const child = spawn(command, [...args, target_], { detached: true, stdio: 'ignore' })
    child.on('error', (error) => {
      ctx.logger?.warn?.(`[dsh-task-board] reveal failed -> ${error?.message ?? error}`)
    })
    child.unref()
    ctx.logger?.warn?.(`[dsh-task-board] reveal -> ${absolute}`)
    return { opened: true, path: absolute }
  }
}

function createDigests() {
  const table = new Map()

  const touch = (sessionId, next) => {
    table.delete(sessionId)
    table.set(sessionId, next)
    if (table.size > DIGEST_LIMIT) {
      const oldest = table.keys().next().value
      if (oldest !== undefined) table.delete(oldest)
    }
  }

  return {
    record(session, event) {
      const sessionId = session?.id
      if (typeof sessionId !== 'string') return
      const type = event?.type
      if (typeof type !== 'string') return
      const time = Number.isFinite(event.time) ? event.time : Date.now()
      const previous = table.get(sessionId) ?? {
        phase: 'idle', turn: null, startedAt: null, lastEventAt: null,
        tool: null, text: '', stream: '',
      }
      const next = { ...previous, lastEventAt: time }

      if (type === 'turn/start') {
        next.turn = Number.isFinite(event.data?.turn) ? event.data.turn : null
        next.startedAt = time
        next.phase = 'thinking'
        next.tool = null
        next.stream = ''
        next.text = ''
      } else if (type === 'step/start') {
        next.phase = 'thinking'
        next.stream = ''
      } else if (type === 'tool/call') {
        next.phase = 'tool'
        next.stream = ''
        next.tool = {
          name: typeof event.data?.name === 'string' ? event.data.name : 'tool',
          hint: toolHint(event.data?.arguments),
          at: time,
          status: 'running',
        }
      } else if (type === 'tool/result') {
        if (next.tool !== null && next.tool !== undefined) {
          next.tool = {
            ...next.tool,
            status: event.data?.error === undefined ? 'ok' : 'error',
            endedAt: time,
          }
        }
        next.phase = 'thinking'
      } else if (type === 'assistant/attempt') {
        const text = streamText(event.data?.stream)
        if (text !== '') {
          next.stream = clip(text.slice(-TEXT_PREVIEW * 2), TEXT_PREVIEW)
          next.phase = 'writing'
        }
      } else if (type === 'assistant/message') {
        const text = messageText(event.data?.message)
        if (text !== '') next.text = clip(text, TEXT_PREVIEW)
        next.stream = ''
        next.phase = 'thinking'
      } else if (type === 'turn/end') {
        next.phase = 'idle'
        next.stream = ''
        next.tool = null
      }

      touch(sessionId, next)
    },
    read(sessionIds) {
      const value = {}
      for (const id of sessionIds) {
        if (typeof id === 'string' && table.has(id)) value[id] = table.get(id)
      }
      return value
    },
    get(sessionId) {
      return table.get(sessionId)
    },
  }
}

/** One `turn/end` record reduced to what a card shows. */
function outcomeOf(event) {
  const reason = event?.data?.reason
  if (reason === null || reason === undefined) return null
  const entry = {
    kind: typeof reason.kind === 'string' ? reason.kind : 'unknown',
    turn: Number.isFinite(event.data?.turn) ? event.data.turn : null,
    at: Number.isFinite(event.time) ? event.time : null,
  }
  if (reason.kind === 'aborted') entry.cause = reason.reason?.kind ?? null
  if (reason.kind === 'error') {
    entry.code = reason.error?.code ?? null
    entry.message = reason.error?.message ?? null
  }
  return entry
}

/**
 * The durable fallback for anything the live feed missed.
 *
 * `turn/end` is how a Turn's real ending is recorded — including the synthetic
 * ending DSH appends when it restarts while a Turn was still open ("本轮已中止").
 * Those events land during session restore, often before this plugin row is
 * activated, so the live table can be empty. Reading the session log on demand
 * recovers both the ending and the last assistant text.
 *
 * `stat()` deliberately does not expose an event count on the JSONL backend
 * (`eventCount` is optional in the contract and this backend omits it), so the
 * window cannot be computed from metadata. The whole log is read and scanned
 * backwards instead; the result is cached per revision, and a scan stops at the
 * first hit for each of the two facts it needs.
 */
function createRecall(ctx, outcomes, digests) {
  const cache = new Map()

  const fromLog = async (id) => {
    const persistence = ctx.get('sessionPersistence')
    if (typeof persistence?.stat !== 'function' || typeof persistence?.open !== 'function') return null
    const snapshot = await persistence.stat(id)
    if (snapshot === null || snapshot === undefined) return null
    const revision = String(snapshot.revision)
    const cached = cache.get(id)
    if (cached !== undefined && cached.revision === revision) return cached
    const handle = await persistence.open(id, 'read')
    try {
      const { events } = await handle.read()
      if (!Array.isArray(events) || events.length === 0) return null
      let outcome = null
      let text = ''
      // Backwards: the last Turn ending and the last assistant text that actually
      // carries words (a pure tool-call message has none and must not win).
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const item = events[index]
        if (item === null || item === undefined) continue
        if (outcome === null && item.type === 'turn/end') {
          outcome = outcomeOf(item)
        } else if (text === '' && item.type === 'assistant/message') {
          const candidate = messageText(item.data?.message)
          if (candidate !== '') text = clip(candidate, TEXT_PREVIEW)
        }
        if (outcome !== null && text !== '') break
      }
      const record = { revision, outcome, text }
      cache.delete(id)
      cache.set(id, record)
      if (cache.size > OUTCOME_LIMIT) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      return record
    } finally {
      await handle.close()
    }
  }

  return async function recall(sessionIds) {
    const value = {}
    for (const id of sessionIds) {
      if (typeof id !== 'string') continue
      let outcome = outcomes.get(id) ?? null
      let text = digests.get(id)?.text ?? ''
      if (outcome === null || text === '') {
        try {
          const record = await fromLog(id)
          if (record !== null) {
            if (outcome === null) outcome = record.outcome
            if (text === '') text = record.text
          }
        } catch (error) {
          ctx.logger?.warn?.('[dsh-task-board] session log recall failed:', error?.code ?? error?.message ?? error)
        }
      }
      // Always answer for a requested id, even when both fields are empty: the
      // caller must be able to tell "asked, nothing there" from "not asked".
      value[id] = { outcome, text }
    }
    return value
  }
}

export function apply(ctx) {
  const outcomes = createOutcomes()
  const digests = createDigests()
  const recall = createRecall(ctx, outcomes, digests)
  const openPath = createOpener(ctx)
  ctx.effect(
    () => ctx.on('session/event', (session, event) => {
      digests.record(session, event)
      outcomes.record(session, event, digests.get(session?.id))
    }, { global: true }),
    'dsh-task-board: turn outcomes',
  )

  const registry = ctx.connection?.fetch
  if (typeof registry?.register !== 'function') {
    ctx.logger?.warn?.('[dsh-task-board] connection.fetch is unavailable; the board will not persist')
    return
  }

  const store = createStore(boardFile())
  const search = createSearch(ctx, store)

  const handle = async (method, payload) => {
    if (method === 'read') return { ok: true, value: await store.load() }
    if (method === 'search') return { ok: true, value: await search(payload) }
    if (method === 'write') {
      const next = normalize(payload?.doc)
      await store.save(next)
      return { ok: true, value: { saved: true } }
    }
    if (method === 'outcomes') {
      const sessionIds = Array.isArray(payload?.sessionIds) ? payload.sessionIds : []
      return { ok: true, value: await recall(sessionIds) }
    }
    if (method === 'digests') {
      const sessionIds = Array.isArray(payload?.sessionIds) ? payload.sessionIds : []
      return { ok: true, value: digests.read(sessionIds) }
    }
    if (method === 'recall') {
      const sessionIds = Array.isArray(payload?.sessionIds) ? payload.sessionIds : []
      return { ok: true, value: await recall(sessionIds) }
    }
    if (method === 'open') {
      return { ok: true, value: openPath(payload) }
    }
    return { ok: false, error: { code: 'taskboard/bad-method', message: `unknown method ${method}`, details: {} } }
  }

  const dispose = registry.register({
    path: ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
      const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (type !== 'application/json') return new Response('content type must be application/json', { status: 415 })
      let message
      try {
        message = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }
      const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request'
      const call = message?.payload
      if (message?.type !== 'client-request' || typeof message.rpcId !== 'string' || message.method !== ENDPOINT
        || call === null || typeof call !== 'object' || typeof call.method !== 'string') {
        return failure(rpcId, 'gateway/bad-request', 'Invalid task board request.')
      }
      try {
        return reply(rpcId, await handle(call.method, call.payload))
      } catch (error) {
        // The logger folds unknown objects to `{}`, which hid the real cause for
        // three debugging rounds: always surface the method and a flat message.
        const detail = error instanceof Error
          ? `${error.name}: ${error.message}`
          : (() => {
            try {
              return JSON.stringify(error)
            } catch {
              return String(error)
            }
          })()
        ctx.logger?.warn?.(`[dsh-task-board] ${call.method} failed -> ${detail}`)
        return failure(rpcId, 'taskboard/io', detail)
      }
    },
  })

  ctx.effect(() => () => {
    dispose()
    void rm(`${boardFile()}.${process.pid}.tmp`, { force: true })
  }, 'dsh-task-board: board route')
}
