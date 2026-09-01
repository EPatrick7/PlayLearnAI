# Terra blind Site tools playtest — 2026-08-31

## Setup

- Player: a separate GPT-5.6 Terra Codex task with high reasoning.
- Interface: the real production build in the Codex in-app Browser.
- Constraint: follow the visible tutorial and Site tools descriptions without source-code knowledge.
- Goal: complete landing, then one Ground → Plan → Supervise → Verify loop.

## Findings and fixes

1. Terra placed Life Support where its completed 2×2 footprint blocked the only working pressure door. The old validation accepted the order, then construction could not deliver material. Queue validation now checks the projected completed layout, requires an enclosed-room placement, preserves the floor immediately inside every working door, and requires a pallet-to-workstation approach route before mutating state.
2. The example response used to claim Plan completion as soon as it was loaded. It is now **Stage example for review**; Plan completes only on a validated commit.
3. A one-hour observation used to complete Supervise. It now records a checkpoint and keeps Supervise current until a declared stop is reached.
4. The next incident was offered before the learner completed the first loop. It now unlocks only after one verified loop.
5. The connection panel exposed internal tool counts and capabilities. It now shows connection state, setup help, and a phase-specific tutorial prompt with clear inspect, stage, commit, advance, and verify boundaries.
6. A single inspection could claim Ground completion, and a post-checkpoint inspection could be mislabeled as Ground. Ground now requires both incident telemetry and a crew/equipment comparison; checkpoint inspections remain Supervise evidence.

## Final blind run

- The known blocked placement (working exterior airlock at 8,7; Life Support origin at 8,8) was rejected before queueing with visible guidance to leave the floor inside working doors clear.
- Terra recovered with a reachable placement at 9,9 and completed the landing.
- Ground reviewed the breach, reserves, power, dust timing, crew, and equipment before planning.
- An 8-hour draft failed review because the forecast required 10 hours. Terra revised the horizon and committed only after validation.
- Advancing one hour left the workflow in Supervise. Terra reviewed the changed oxygen, battery, and dust state, then continued to the declared objective-complete stop.
- Verify confirmed the breach was sealed, atmosphere restored, research completed, oxygen stayed above the floor, power remained positive, and no residual risks remained.

Result: the full landing and supervision tutorial completed without a blocker.
