# Security and trust boundaries

This is a private local evaluation build. Public distribution, host networking, model execution and mobile acceptance have separate gates; implemented library code is not evidence that all gates passed.

## Data and rendering

The seed catalog preserves sources and unknown physical values. Editorial sensory priors are not measurements. Recipe source, target preferences, prediction and consenting user's actual review remain separately named data. React escapes recipe/model text; there is no executable HTML renderer. Tauri CSP disallows frames, objects and arbitrary remote connections. UI capabilities do not grant shell execution or arbitrary filesystem operations. Source opener is restricted to the catalog publisher HTTPS domain.

## Persistence and host authority

Local preferences do not authorize orders. HostStore owns identities, tickets, serving specifications, immutable order snapshots and outbox writes. No seed recipe is automatically orderable. The local SQLite reference implementation is never exposed as a network service. A future/configured transport must preserve the authenticated account context and TLS certificate binding.

## Inference

No weight is bundled or downloaded by this build. A local adapter may accept only an explicitly configured executable and GGUF, with loopback binding, randomized port and per-process credential. No user or model text is interpolated into a shell command. Model output may select from validated candidate IDs and provide bounded plain-text names; it cannot set ingredient quantities, nutrition, permission or ticket results. A transport/parser mock passing is not a real-model benchmark.

## Operational changes

The development toolchain is project-local and process environment only. No firewall or security permission was changed. No automatic elevation. Windows installer uses per-user installation. This build expects an existing WebView2 runtime and does not silently install it with elevated privileges.

## Unverified acceptance gates

Two physical devices, certificate rotation, mobile native local-network permission denial/recovery, real model cancellation/OOM and clean-machine upgrade/uninstall must be independently recorded. Public data/artwork rights, signing identity and model-license approval are not inferred from private development authorization.
