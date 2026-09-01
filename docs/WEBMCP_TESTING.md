# WebMCP testing

**Agent access ready** proves registration only. Test actual **Site tools** calls and confirm that their results match the visible game. The browser host setup is described in the [official Site tools guide](https://learn.chatgpt.com/docs/webmcp).

## Automated checks

```bash
npm run test:webmcp
npm test
npm run build
npm run lint
```

`test:webmcp` runs the focused callback, registration lifecycle, construction safety, and full-flow regressions. `npm test` also checks the rest of the game. The full-flow test starts with the real starter layout and 14 materials, queues blueprints through registered callbacks, advances real worker construction, then stages, commits, advances, and verifies an operations plan. It does not bootstrap readiness with legacy module construction or increase the test timeout.

Covered fixes include execution options without a cancellation signal, strict runtime input validation, pausing while worker ticks change the world revision, and registration cleanup/rollback after failures or phase changes.

## Open an isolated production build

After building, start a preview on an unused port:

```bash
npm run preview -- --host 127.0.0.1 --port 4187 --strictPort
```

Open `http://127.0.0.1:4187/` in the in-app Browser. Use a different unused port if that origin already contains a save. Saved games are scoped to the origin; **do not reset the user's existing game to run this test**. Confirm the disposable game starts in landing with 14 construction materials and no open orders.

Open the browser's built-in **Site tools** menu and confirm these four registrations:

- `inspect_construction`
- `place_construction_blueprint`
- `manage_construction`
- `begin_first_shift`

Perform the following through those tools, not by changing the store in developer tools. The in-app Browser against a production preview is the host under test. Native Chrome interoperability needs a separate run and is not established by these checks.

## Construction calls

1. Call `inspect_construction` with `{}` and retain its `runId`.
2. Pause with `manage_construction` using `{"expectedRunId":"<runId>","action":"set_speed","speed":0}`. Pausing deliberately does not require a world revision, so live worker ticks cannot prevent the pause.
3. Inspect again. Every other construction mutation requires this run ID and the latest `worldRevision` as `expectedRunId` and `expectedWorldRevision`. Use the revision returned by each successful call for the next mutation. Never guess revisions.

Exercise queue controls while paused using a temporary wall from `(12,9)` to `(13,9)`. Retain the returned `commandId` and `orderIds`, then call:

| `manage_construction` action | Additional fields | Check |
| --- | --- | --- |
| `set_command_priority` | `commandId`, `priority: 5` | Both orders change priority. |
| `set_order_priority` | One `orderId`, `priority: 4` | Only that order changes. |
| `assign_builder` | `orderId`, `crewId: "crew-mateo-alvarez"` | The visible builder preference changes. |
| `assign_builder` | Same `orderId`, `crewId: null` | Automatic assignment returns. |
| `cancel_order` | One `orderId` | The individual ghost disappears. |
| `cancel_command` | `commandId` | Remaining command ghosts disappear. |

Inspect after the drill: stock should remain 14 and the queue should be empty. Assignment can legitimately reject an unavailable builder, unmet prerequisites, or an incompatible material carrier; it must report the reason without changing the preference.

For the reproducible first-shift layout, submit these `place_construction_blueprint` inputs **in this order**, adding fresh expected run/world fields to each:

| Order | Blueprint fields |
| --- | --- |
| 1 | `kind: "wall"`, `start: {x:8,y:7}`, `end: {x:11,y:7}` |
| 2 | `kind: "door"`, `start: {x:8,y:7}`, `end: {x:8,y:7}` |
| 3 | `kind: "wall"`, `start: {x:11,y:8}`, `end: {x:11,y:9}` |
| 4 | `kind: "wall"`, `start: {x:8,y:10}`, `end: {x:11,y:10}` |
| 5 | `kind: "workstation"`, `workstationType: "life-support"`, `workstationId: "first-shift-life-support"`, `origin: {x:9,y:8}`, `rotation: 0` |

This adds a second room beside the starter habitat. Ten final boundary cells plus life support consume the original 14 materials; replacing the temporary wall with a door recovers that wall's material. Doors require existing or projected walls. Build the north exit before closing the shell, and keep the pallet at `(8,9)` and the exit passage clear.

Calling `begin_first_shift` before completion must return `not_ready`. Resume with `set_speed`, `speed: 1` and the latest expected revision. Let the visible workers haul and build. Inspect until `readyForFirstShift: true` and `construction.openOrderCount: 0`; queued ghosts alone do not establish readiness. Pause, inspect once more, and call `begin_first_shift` with fresh expected fields.

The catalog must switch from **4 to 11 tools without reloading**. `begin_first_shift` disappears; the three construction tools remain beside eight operations tools.

## Operations demonstration

Use this prompt with the browser agent:

> Use the page's Site tools to inspect this first incident and compare crew and equipment. Stage a plan to restore the laboratory and complete Regolith Sintering, protecting Jonah Reed, with a 12-hour oxygen floor, a 12-hour horizon, and an objective-complete stop. Inspect validation before committing. Advance at most 12 hours, then verify the actual outcome. Show the changes in the visible Plan and Verify panels and stop if validation rejects the plan.

For a deterministic first-incident fixture, use these work-level assignments with `stage_operations_plan`:

| Work order | `crewId` | `equipmentIds` |
| --- | --- | --- |
| `work-seal-lab` | `crew-mateo-alvarez` | `equipment-eva-01`, `equipment-engineering-01` |
| `work-repressurize-lab` | `crew-soo-jin-park` | `equipment-eva-03`, `equipment-engineering-02` |
| `work-research-sintering` | `crew-leila-haddad` | None |
| `work-clean-solar` | `crew-nia-kimani` | `equipment-eva-02`, `equipment-rover-01` |

Bootstrap with `inspect_operations_plan` and `{}` to obtain the current run ID. Use that run ID for `inspect_moonbase` and `query_crew_and_equipment`, then inspect the plan again for fresh revisions. Supply the inspected run, world, and plan revisions plus `assignments`. The omitted safeguards intentionally resolve to the disclosed recommendation: the incident objective, its oxygen-floor recommendation, no protected crew, a 12-hour horizon, and an objective-complete stop. Pass any safeguard explicitly when the situation or player intent calls for a different value. Later incidents may need different assignments or a milestone stop; inspect their disclosed conditions instead of reusing this fixture blindly.

Staging must return a draft and must not commit or advance time. Inspect immediately afterward and check `review.kind: "draft"` plus `validation.valid: true` before committing. After bounded execution reaches its stop, inspection must instead return `review.kind: "awaiting_verification"`, `validation: null`, and verification as the next action. After verification, it must return `review.kind: "verified"`, `validation: null`, and must not recommend another advance.

Exercise `edit_operations_plan` by removing one action, rebasing, and staging the full response again. When staging with `mode: "replace"`, include the assignments again; safeguards may use their defaults. Re-inspect immediately before `commit_operations_plan` and use its exact revisions. Call `advance_until` with the committed world revision and `hours: 12`; then call `verify_operations_plan` with the returned world revision.

Success means objective-complete execution, laboratory atmosphere `yes`, research `complete`, verification status `success`, every verification check passing, no residual risks, and one completed learning loop. Check the visible interface as well as the returned JSON. After verification, `edit_operations_plan` with `operation: "clear"` should open a fresh draft.

## Refusals, reset, and evidence

- Reuse an old world revision after a successful queue mutation: expect `stale_world` and no state change. Pause remains allowed with a stale world revision when its run ID is current.
- Stage with an incorrect plan revision: expect `stale_revision`, with no partial edits or assignments.
- Send malformed inputs, extra properties, unsupported values, or coordinates outside `x: 0–23`, `y: 0–17`. If the host dispatches them, the application must return `invalid_input` without mutation. A host may instead reject them against the advertised schema before the callback runs; the callback regressions test the application's independent validation.
- Only on the disposable origin, choose reset after the operations test and accept its native confirmation dialog. The catalog must return to four landing tools. Calls retaining the old run ID must return `stale_run` even if a numeric revision matches the new run. Callback tests additionally retain old operations callbacks to verify this guard after catalog replacement.
- The observed browser host omits the execution cancellation signal. Missing, empty, and null execution options are exercised automatically; supplied already-aborted signals must return `cancelled` before mutation. This does **not** establish end-to-end cancellation delivery by that host.
- Capture desktop and phone screenshots from the actual build, including construction/placement, an open Plan panel, and the verified result. Save them under `docs/screenshots/`, describe what they validate, and restore temporary viewport overrides.

## Recorded live results

On **2026-08-31**, the production preview at `http://127.0.0.1:4187/` was tested in **Codex's in-app Browser** using actual Site tools calls. All **12 unique tools** were exercised across landing and operations. The user's existing saved game was left intact on its original origin.

| Check | Observed result |
| --- | --- |
| Construction | The real starter stock of 14 materials completed the layout above through worker hauling/building. The live catalog switched from 4 to 11 tools without reloading. |
| Queue controls | Builder assignment and Automatic restoration, priorities, individual/command cancellation, and refund to 14 materials worked. |
| Concurrent changes | Stale world edits were refused; pausing with an outdated world revision succeeded. A manual UI edit raised the plan's oxygen floor from 12 to 13 hours, and the old commit returned `stale_plan`. |
| Bounded execution | A fresh commit with the amended 13-hour floor and 12-hour horizon stopped on `objective_complete` after 10 simulated hours; all four work orders completed. |
| Verification | All five checks passed, minimum observed oxygen was 20.8 hours, battery charge was 35.2 kWh, residual risks were empty, and one learning loop completed. |
| Persistence | Reload preserved the completed operational state. |
| Reset and stale run | Live reset could not be completed because browser control stopped responding after the native confirmation opened. Automated reset, catalog replacement, and retained-callback stale-run checks pass. |
| Automated checks | 42 focused WebMCP tests and 421 full-suite tests passed; production build and lint passed. |

The [saved outcome JSON](testing/2026-08-31-webmcp-outcome.json) contains the committed plan and verification evidence. These screenshots show the real production build:

- [Landing desktop](screenshots/2026-08-31-webmcp-landing-desktop.png): validates the construction interface and placed layout.
- [Verified desktop](screenshots/2026-08-31-webmcp-verified-desktop.png): validates the visible successful outcome and verification panel.
- [Verified phone](screenshots/2026-08-31-webmcp-verified-phone.png): validates the same result at phone size.

The current intended-use review adds these production-build views:

- [First-shift desktop](screenshots/2026-08-31-intended-use-first-shift-desktop.png) and [phone](screenshots/2026-08-31-intended-use-first-shift-phone.png): validate the persistent readiness evidence and promoted **Begin operations** action.
- [Agent access desktop](screenshots/2026-08-31-intended-use-agent-access-desktop.png) and [phone](screenshots/2026-08-31-intended-use-agent-access-phone.png): validate registration-accurate language, Codex-task guidance, and the copyable prompt.
- [Staged plan desktop](screenshots/2026-08-31-intended-use-staged-plan-desktop.png): validates that grouped work assignments become a visible draft with defaults, safeguards, and forecast before commit.
- [Verified desktop](screenshots/2026-08-31-intended-use-verified-desktop.png) and [phone](screenshots/2026-08-31-intended-use-verified-phone.png): validate the distinct verified state, visible check evidence and residual risks, result-first phone order, and next-incident action. The completed run was reloaded through the current production bundle for this read-only review.

Native Chrome, a separate ChatGPT browser host, and cancellation delivered by the host remain unverified. The live reset remains unverified because of the native-dialog browser-control failure above. Successful callback tests do not establish interoperability with an untested host.
