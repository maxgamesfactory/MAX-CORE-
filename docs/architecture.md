# Architecture and repository rules

## Authority

MAX-CORE is the universal platform and runtime foundation for Portal-OS1, MAX Games,
MAX Media, MAX Art, MAX Institute, Quantum XR and future MAX products.

Dependency direction is **MAX-CORE → runtime → adapters → products** when read from
foundation to consumer; import direction points toward the foundation. Products
may depend on core. Core must never depend on products, game logic, business
workflows, dashboards, React, Vue, Angular or Next.js.

## Responsibilities and boundaries

- `contracts/` has only interfaces, type aliases and type-only imports/exports.
- State, events and simulation are independent engines over contracts. They share
  only the JSON snapshot utility. Simulations own no timers or host services.
- Runtime owns execution lifecycle and replaceable services, never product state.
- Storage owns persistence and generic versioned deltas, never product schemas.
- Adapters translate host interfaces, never business, dashboard or simulation logic.
- XR holds references to the same state/event/simulation instances as other hosts.
- Intelligence is a reserved boundary. Provider models and product agents are out
  of core until a platform-neutral contract is specified.

The architecture checker inspects TypeScript imports, rejects external/dynamic
runtime imports and forbidden layer edges, and rejects runtime/peer/optional
package dependencies. Review must also reject product logic even if it appears
under an allowed directory: static import checks cannot infer business meaning.
No subsystem is merge-ready without APIs, examples, failures and recovery docs.

## Data and time

Data crossing state, event and storage boundaries is finite, acyclic JSON with
plain objects. Inputs are copied and deeply frozen. Missing storage keys use
`undefined`; JSON `null` remains a stored value. A generic storage `get<T>` is a
caller assertion, not a domain schema validator. Validate external schemas at
consumption boundaries. BigInts, functions, Dates, undefined children, sparse
arrays, NaN and Infinity are rejected. Special object keys are ordinary data.

Runtime time is injected; simulation time is solely `tick * stepMs`. Determinism
requires pure reducers and identical initial state/configuration/seed and code.
No platform detection occurs at module import. Capability and feature failures
have explicit outcomes. No global singleton owns the ecosystem.

## Storage layers

1. IndexedDB persists the local document.
2. A durable coalescing queue records unacknowledged versioned deltas in that same
   document, making each local write atomic with its queue entry.
3. A serial SyncAuthority may use a Durable Object storage binding.
4. D1Storage persists the authority document or other portable key/value state.

The library provides drivers and a transport contract. A deploying host creates
and authenticates its transport, chooses one authority per document and binds
cloud resources. D1 is not contacted from browsers and is not transparently
chained behind Durable Objects; deployment ordering and replication belong to
host infrastructure. The core does not create shared cloud data.

## Platform policies

- iOS: identify Safari/WebKit, persistent storage and memory class. Use conservative
  memory policy even when memory is unknown. Advertise image proxy, offline and
  storage recovery policies to the host. Renderer probing falls back to DOM.
- Android: distinguish Chrome, Samsung Internet and Edge. Prefer WASM when
  available and advertise service workers, persistent storage, GPU capabilities.
- Desktop/web: use the same contracts with host capability probes.
- XR: browser WebXR implementation and native XRBridge contract support Quest,
  Vision Pro and OpenXR hosts without owning product behavior.

Policy flags describe required host behavior. The core does not implement a DOM
renderer, image proxy server, service worker, native store or native XR engine.
Hosts must act on policy flags and handle actual render/context/storage failures,
which may occur after successful probes. No renderer is required to run engines.

## Failure and recovery

Failure semantics are specified in each subsystem guide. Do not discard a queue,
reset durable data, change conflict rules or weaken deterministic behavior to hide
an error. Keep failed operations observable and retry after repairing the cause.
Native device, store and real cloud deployment verification is a host integration
requirement; synthetic contract tests do not prove native hardware readiness.
