# XR integration

## Architecture and responsibilities

`XRIntegration` owns session lifecycle and translates input into `xr.input` events.
Its `shared` dependencies are the host's existing StateContract, EventContract and
SimulationContract instances. It never forks state or advances a simulation.

`WebXRBridge` implements XRBridge with browser WebXR. Native OpenXR, Meta Quest,
Vision Pro/visionOS and future runtimes implement that same bridge in their host.
A Quest browser may use WebXR directly. There is no native SDK bundled in core.
Rendering, pose mapping, frame timing and reference spaces belong to host bridges
or rendering services; this foundation translates session lifecycle and basic
input. It does not render an XR scene.

## Public APIs

- `WebXRBridge(system?)`: runtime = webxr, supported(mode), request(mode).
  Defaults to navigator.xr when present. Structural `WebXRSystem`, `WebXRSession`
  and `WebXRInputEvent` avoid platform SDK dependencies.
- `XRBridge`: runtime identifier, supported, request.
- `XRSessionBridge`: end, onInput, onEnd; subscriptions return cleanup functions.
- `XRIntegration(bridge, shared)`: active, start(mode), stop, shared.
- `XRDependencies`: state, events, simulation, onError diagnostic callback.
- `XREvents`: `xr.input` portable JSON input. WebXR translates select/squeeze
  variants, input source handedness and target-ray mode; it retains no native data.

## Example

```ts
const xr = new XRIntegration<{ ticks: number }, number>(new WebXRBridge(), {
  state, events, simulation, onError: error => console.error(error)
});
// Call from a user gesture; browser permissions/session policy still apply.
const result = await xr.start('immersive-vr');
if (!result.supported) console.log(result.reason);
await xr.stop();
```

## Failure modes

Unavailable capabilities, permission rejection, request errors and active/start
conflicts return unsupported outcomes. A failed partial startup ends the allocated
session. Host end events release input/session ownership. stop during a transition
rejects. stop releases references even when session end fails. Async event-handler
errors go to onError; exceptions from diagnostic reporting are contained.

## Recovery

On unsupported sessions continue the shared non-XR runtime. Restore permission or
inject a supported bridge and retry start. Stop before replacing the integration.
After host session end, start may be retried from a fresh user gesture. A failing
native cleanup still needs host resource repair; discarding a JS reference cannot
guarantee a native resource was released. Test real entitlements/hardware per host.
