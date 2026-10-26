# Intelligence boundary

## Architecture and responsibilities

The directory reserves a place for future portable intelligence contracts. The
repository requirements specify no intelligence API or provider. Its current
module intentionally exports no runtime features. Product agent behavior, model
selection, network SDKs, credentials and business decisions must stay in consumers.

## Public APIs and example

There are no intelligence exports. A consumer may register its own lifecycle service:

```ts
kernel.register('consumer-agent', { start: async context => {
  // Initialize the consumer-owned agent outside MAX-CORE.
  if (context.signal.aborted) return;
} });
```

## Failure modes and recovery

No intelligence subsystem is implicitly initialized. If a consumer's agent fails,
use runtime lifecycle rollback and replace that consumer service. Introduce a
portable, tested contract before adding core intelligence behavior; do not import
product workflows under this reserved directory.
