# MAX-CORE contributor instructions

MAX-CORE is the portable runtime foundation below all MAX products. Treat
`docs/architecture.md` and subsystem guides as the repository contract.

- No product imports, Portal-OS1, UI frameworks, dashboard/game/business workflows.
- Contracts are TypeScript types only. Preserve layer separation.
- No runtime/peer/optional dependencies. Native features use injected host bridges.
- Share state, events and simulation across platforms including XR; adapters translate.
- State snapshots are immutable JSON. Simulation is deterministic and replayable.
- Preserve offline queues and tombstones on failures; document concurrency limits.
- Document architecture, responsibilities, APIs, examples, failure modes and recovery
  for every subsystem. Do not merge undocumented core behavior.
- Every public export requires tests. State/events/simulation/runtime/storage require
  >=95% lines, statements, functions and branches; general systems require >=80%.
- Use Node 22 (22.13+), 24, or 26+ and npm. Setup: `npm ci --ignore-scripts`. Validate: `npm run check`
  and `npm audit --audit-level=moderate`. Browser verification: `npm run preview`
  after build, then open http://localhost:3100. The repository is a library; the
  preview is a development verification harness, not a product app.
- Keep credentials and provider SDKs outside core. Native hardware and real cloud
  integration must be verified in deploying hosts; never claim fixture tests prove it.
