# Execution rendering scale — Windows evidence

On 2026-11-08, `e2e/exec_render_probe.py` was executed against the production
Portal bundle on Windows, using real Chromium and the real loopback
`PortalServer`. The input stream is synthetic and probe-only; production
telemetry capacity remains unchanged.

Command:

```text
uv run --with playwright --with pytest python e2e/exec_render_probe.py \
  --out audit/exec-render-current-2026-11-08-full.json
```

## Measured results

| events | `/execution` DOM elements | visible rows | JS heap | `/events` | payload | node delta | listener delta |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 1,502 | 50 | 7.9 MB | 35.5 ms | 16 KiB | +11 | +1 |
| 500 | 2,858 | 100 | 8.6 MB | 33.6 ms | 154 KiB | -13 | 0 |
| 1,000 | 2,868 | 100 | 9.2 MB | 35.2 ms | 308 KiB | -7 | 0 |
| 5,000 | 2,945 | 100 | 16.0 MB | 102.8 ms | 1.51 MiB | +1 | 0 |
| 10,000 | 3,033 | 100 | 12.2 MB | 192.2 ms | 3.03 MiB | 0 | 0 |

The fixed 100-row page and bounded DOM show that the execution surface is
paginated rather than rendering every recorded event at once. The repeated
dashboard/execution navigation probe found no listener growth and at most one
node of noise at the smallest scale.

This is a rendering and loopback serialization baseline, not a production SLO:
the events are synthetic, one Windows host was used, and authenticated remote
providers were not involved. The graph engine has separate scale limits and is
covered by `docs/perf/portal-2.1-benchmarks.md`.

## Portability fix

The probe previously printed the Unicode delta character in its progress line.
That crashed on a Windows `cp1252` console before writing the report. Progress
labels now use ASCII (`task_delta`, `nodes_delta`, `listeners_delta`) so the
benchmark itself is portable across the supported terminal surfaces.

Raw evidence: `audit/exec-render-current-2026-11-08-full.json`.
