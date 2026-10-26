# Storage and synchronization

## Architecture and responsibilities

All drivers implement `get<T>(key)`, `set(key, json)`, `remove(key)`, `keys()`.
Missing is `undefined`; null is a real value. Writes clone and validate JSON. Keys
are listed in deterministic order. There are no product schemas or UI behaviors.

- `MemoryStorage`: ephemeral, frozen snapshots, suitable for unsupported hosts and
  isolated tests. This fallback is explicitly nonpersistent.
- `IndexedDBStorage(name = 'max-core', factory = globalThis.indexedDB)`: browser
  persistence with a fixed `values` store, commits before resolving writes,
  closes on version change, retries failed opens, and exposes `close()`.
- `DurableObjectStorage(binding)`: translates Cloudflare-compatible get/put/delete/list.
- `D1Storage(binding)`: initialize the fixed `max_core_kv` table with `initialize()`;
  parameterized upsert/read/delete and sorted keys. Errors propagate. Bindings are
  supplied only by the server host. Stored strings are validated JSON on read.

### Offline delta model

`SyncReplica(localStorage, transport, nodeId, documentKey?)` persists format-1 data
as one atomic storage value containing a Lamport clock, records and queue. Writes
coalesce by key. Tombstones prevent deleted values from reappearing. A new instance
rehydrates from the same storage. Every operation rereads the durable document.

`flush()` serializes with local operations, sends pending deltas, validates remote
deltas, merges winning versions and acknowledges only after local persistence
succeeds. Network calls block operations on that instance until they settle; hosts
must bound transport latency. No background worker, automatic retry, or network
access occurs without a host calling flush. `pending()` counts distinct queued
keys. `rehydrate()` validates durable state and rejects corruption.

`compareVersions(a,b)` orders counter first and node ID second by UTF-16 ordering.
This is last-logical-write-wins, with deterministic concurrent ties; it is not a
wall-clock ordering or a field-level merge. Each writer must have a unique stable
node ID and must never reuse a version for different data. Deleting or restoring a
replica backup requires a **new node ID** to avoid reusing old logical versions.

`SyncAuthority(storage, documentKey?)` implements the `SyncTransport.exchange`
contract: serialize exchanges, merge idempotently, persist, return all current
records. This full response is a simple baseline without pagination or tombstone
compaction. Payload size grows with the number of keys. Only one serial authority
may own a document. Durable Object storage is a suitable binding; a D1-backed
authority requires the deploying host to enforce single-writer ownership.

Only one SyncReplica may write each local document. Multiple instances can be
used sequentially for recovery; parallel tabs/processes need host locks or distinct
storage/document namespaces and node IDs. The in-process queue is not a distributed
lock. A custom transport must atomically/idempotently apply versions before
acknowledging and return remote deltas, never silently reject writes. The included
authority enforces serialization only within its instance.

## Examples

```ts
const local = new IndexedDBStorage('max-local');
// Server-side authority; browsers receive an authenticated transport instead.
const authority = new SyncAuthority(new MemoryStorage());
const replica = new SyncReplica(local, authority, 'persisted-client-id');
await replica.rehydrate();
await replica.set('checkpoint', { tick: 20 }); // works offline
console.log(await replica.pending());
await replica.flush();
console.log(await replica.get('checkpoint'));
await replica.remove('checkpoint');
await replica.flush();
await local.close();
```

```ts
// In the appropriate cloud host, supplied bindings implement structural interfaces.
const durable = new DurableObjectStorage(bindings.durableStorage);
const d1 = new D1Storage(bindings.database);
await d1.initialize();
// Choose backing storage deliberately; resources/deployment are host-owned.
const authority = new SyncAuthority(durable);
```

## Failure modes

IndexedDB may be absent, blocked, evicted, denied or out of quota. A driver failure
rejects; a previously selected durable driver never silently switches to memory.
Probing persistence is advisory and does not request a browser permission. Server
binding and SQL failures reject. Queued writes survive network failures and failed
acknowledgment persistence; retry may deliver the same delta again. A failed local
write does not acknowledge or mutate the document. Invalid document/delta schema
rejects without dropping the queue. Counter exhaustion rejects new writes.

## Recovery procedures

1. Offline: retain the same local storage and node ID; reconnect and retry flush.
2. Blocked IndexedDB: close older connections/tabs, call close, then retry. Browser
   eviction may destroy all local data; a new replica can pull authority state but
   unsynced evicted data cannot be recovered.
3. Quota: free host-owned space or request persistence via host UI; retry the failed
   write. Never clear the queue as a quota workaround.
4. Corruption: keep a copy of the stored document, restore a known valid snapshot,
   allocate a new node ID and reconcile with the authority. `rehydrate` is validation,
   not an automatic reset or domain migration. Restoring intentionally old domain
   values requires new writes, since remote newer versions win.
5. Unsupported host: inject durable native storage. If memory is acceptable, choose
   MemoryStorage explicitly and disclose its ephemeral lifetime to the product.

Cloud access control, user scoping, resource deployment, cross-process concurrency,
encryption, schema migrations and retry scheduling are host responsibilities.
