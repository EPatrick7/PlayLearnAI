# PlayLearnAI: Moonbase

A browser-based lunar operations game about learning to supervise AI agents through shared, live tools.

This proof of concept opens on a paused mission briefing, then follows the Aquila lander to a furnished, six-zone Moon base. The live crew enter through the airlock and begin safely inside pressure before the first incident shift starts. The page is the shared source of truth: a person can operate the response manually, while a compatible browser agent can inspect and change the same simulation through WebMCP. The point is not to ask an AI for a one-shot answer. It is to practice grounding a decision in evidence, making a bounded plan, supervising execution, and verifying the result.

PlayLearnAI is being built for the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/).

## The first-landing loop

The opening establishes the setting and the supervision loop before the clock can move:

1. Read the mission briefing at your own pace. The simulation and incident clock remain paused until **Start landing** is selected.
2. Watch Aquila descend, touch down, and deploy suited crew across the lunar surface to South Airlock. The sequence can be skipped without changing the safe handoff.
3. Begin inside a pressurized habitat, central spine, life-support room, stores, laboratory, and dedicated airlock, with exterior solar/battery equipment and a landing pad already established.
4. Inspect the incident, build a bounded response, supervise time, and verify fresh evidence. **Architect** remains available for later expansion and repair work.

The top-down map uses an original hand-painted regolith texture and code-native module art. On phones, it becomes a horizontally swipeable playfield so buildings retain useful proportions.

## The pressure-breach loop

The POC is organized around a short operational loop. Each incident seed selects a visible, deterministic risk profile so oxygen margin, power pressure, dust timing, equipment condition, and repair duration vary without becoming opaque:

1. **Ground** — inspect the vacuum-exposed laboratory, oxygen margin, dust forecast, power state, crew readiness, and location and condition of useful equipment before changing anything.
2. **Plan** — set an objective, oxygen floor, protected crew, time horizon, and stop condition. Assign suitable crew, reserve the required equipment, set priorities, and validate the Operations Plan before commit.
3. **Supervise** — commit against the current world and plan revisions, advance a bounded amount of time, and watch the same map, telemetry, crew state, equipment movement, work progress, and event history the agent is using.
4. **Verify** — compare fresh evidence with the original objective and constraints, confirm whether the laboratory is safe and research is restored, and identify any remaining oxygen or power risk.

Resetting the colony replays the arrival and restores the preset relay. **Start next incident** preserves the settlement while cycling to the next deterministic incident profile with a fresh plan and run identity.

## Play manually

WebMCP is optional for the manual path. After starting the app:

1. Review the briefing, choose **Start landing**, and continue after the crew cycles the airlock.
2. Select a furnished module, crew pawn, gear token, or numbered work site to inspect it in place.
3. In **Work**, choose an order and stage crew and required gear. The map draws the proposed routes. You can also choose **Stage example for review** to load the recommended response without committing it.
4. In **Plan**, set the oxygen floor, protected crew, horizon, and stop condition. Review the full action queue and resource forecast, resolve any inline blocker, then commit.
5. Use the persistent time controls to advance one hour or run to the bounded stop. Watch pawns and equipment relocate, work sites fill, the laboratory move through **No → Low → Yes**, and the dust front change the solar field.
6. Choose **Verify** and compare the outcome against the objective, reserve floor, power state, and declared stop condition. Start the next incident to keep the base and face a different disclosed risk profile.
7. Open **Build** for freeform expansion. Doors are contextual: a room-to-room connection is an interior pressure door, while a room-to-lunar-surface connection is an exterior airlock. Builders claim one real, available EVA suit each before cycling an airlock; unsuited workers cannot enter vacuum, and an active base cannot remove its last usable exterior airlock.

The simulation remains playable in a normal browser when WebMCP is unavailable.

### Fast successful run

For a deterministic smoke test of the default **Balanced Front**, choose **Stage example for review** from the Work drawer. It atomically prepares a 12-hour horizon, a 12-hour oxygen floor, and an **Objective complete** stop with:

- Mateo + EVA Suit 01 + Engineering Kit 01 for the breach;
- Soo-jin + EVA Suit 03 + Engineering Kit 02 for repressurization while the lab is still at vacuum;
- Leila for Regolith Sintering research; and
- Nia + EVA Suit 02 + the Kestrel rover for the solar bank.

The preview reports a valid 10-hour plan. Review it, commit, choose **Run to stop**, then **Verify outcome**; all five outcome checks pass.

Vacuum and exterior assignments—including construction—require one physical EVA suit per exposed colonist. On completion, EVA crews return through a valid exterior airlock before their suits and field gear become available again. A room cannot be deliberately vented while occupied unless every affected colonist can seal a suit.

The **Leaking Margin** profile deliberately invalidates that one-shot answer: Engineering Kit 01 is below the incident-work condition floor. Its example instead stages a bounded **Seal laboratory breach** milestone plus parallel solar mitigation. Verify that milestone, then reuse Engineering Kit 02 in a fresh repressurization plan. This makes the disclosed profile change the supervision strategy rather than only the numbers.

## Why WebMCP belongs here

Colony incidents create more relevant state than a player should have to copy into a chat window. A compatible agent can instead use structured Site Tools to:

- inspect live colony, pressure, crew, equipment, and incident state;
- prepare or apply bounded response actions;
- advance the simulation by a controlled amount; and
- retrieve fresh evidence for outcome verification.

Manual controls and agent tools operate on the same browser-local game state and use the same simulation rules. Agent actions become visible on the page rather than disappearing into a separate chatbot. There is no hidden solver, in-page model, API key, or privileged agent-only game state.

The header reports **Agent access ready** when the browser has registered those tools. That is availability, not a live connection claim: nothing changes until the player copies the suggested prompt into a Codex task, reviews the staged response, and explicitly commits it.

### Phase-safe Site Tools

The registered catalog follows the visible game phase, so an agent cannot skip the first landing or inspect the hidden incident early:

- While the briefing and arrival sequence are visible, the simulation is not mounted and no Site tools are registered.
- After the crew enters the preset base, eleven tools cover construction plus live incident inspection, planning, bounded advancement, and verification.
- The four-tool establishment catalog remains covered as a lower-level construction regression fixture, but it is not part of the default new-game path.

Construction tools use the same placement validators, material reservations, queue priorities, cancellations, worker simulation, and readiness check as Architect. State-bearing results include an opaque, persisted run identity plus the settlement phase and current world revision; the identity deliberately reveals neither the incident seed nor its hidden construction-phase profile. Every mutation must present the inspected run identity; planning mutations additionally use plan and world revisions where appropriate. `stage_operations_plan` accepts one assignment per work order—crew plus the equipment they should reserve—and supplies disclosed safe defaults for the objective, oxygen floor, protected crew, 12-hour horizon, and objective-complete stop. It expands that intent into the same atomic plan edits used by manual play, but never commits or advances time. Complete plan staging and multi-action removal publish transactionally, so malformed, stale, or cancelled batches cannot leak partial edits. The page re-registers the catalog when the phase changes, and retained operational callbacks still refuse to reveal or mutate incident state after a reset.

Plan inspection is lifecycle-aware. Drafts return validation for review; committed plans report supervision state; completed plans report that they are awaiting verification; and verified plans return the recorded evidence without revalidating a closed draft or recommending another advance.

Registered callbacks validate their advertised schemas before changing state and accept hosts that omit execution options or a cancellation signal. Pausing construction requires only the current run ID, so worker ticks cannot race the pause; inspect again before other edits. `manage_construction` also exposes the visible builder preference through `assign_builder`, with `crewId: null` restoring Automatic. Registration failures roll back partial catalogs instead of leaving stale tools active.

The [WebMCP testing guide](docs/WEBMCP_TESTING.md) provides exact Site tools calls, a disposable production preview, the construction callback fixture, and recorded browser evidence. The default production-preview path begins with no tools during arrival and exposes the eleven-tool operations catalog after safe handoff; native Chrome and host-delivered cancellation remain unverified.

## Implemented POC scope

The current POC is intentionally narrow:

- a paused mission briefing, skippable lander-and-airlock opening, and furnished six-zone preset base;
- a persisted freeform Architect with one-tile walls, wall-replacing doors, automatic room detection, worker-built blueprints, and independent multi-tile objects;
- three deterministic pressure-breach risk profiles with disclosed oxygen, power, dust, equipment, and repair tradeoffs, including a profile that requires verified equipment reuse across plans;
- engineering, science, medicine, and operations skills plus crew health, fatigue, morale, location, and work state;
- physical EVA suits, engineering and medical kits, and a rover with location, condition, reservation, transit, and deployment state;
- oxygen, food, water, construction stock, solar generation, demand, battery charge, and a dust forecast that can reduce power;
- a playable **Seal breach → Repressurize laboratory → Research Regolith Sintering** work chain, with a parallel solar-cleaning response;
- a run- and revision-checked Operations Plan with objective, constraints, horizon, whole-objective or work-order milestone stops, transactional edits, preview, validation, and commit;
- a complete Ground → Plan → Supervise → Verify response loop;
- manual play and equivalent WebMCP interaction categories over shared state;
- phase-aware construction WebMCP parity, including typed blueprints, queue control, and first-shift transition;
- bounded time advancement with visible consequences and evidence-based verification; and
- browser-local progress, deterministic colony reset, and settlement-preserving incident replay.

Given the same incident seed and actions, the simulation produces the same result. Use the reset control to discard the current run and replay the preset-base arrival, or start the next incident to retain the relay while cycling the operational challenge.

## Later vertical-slice targets

The larger game design is not represented as implemented POC functionality. Planned vertical-slice work includes:

- incoming and returning flights competing for landing access;
- cargo recovery and physical pallet hauling;
- utility routing and deeper construction-resource simulation; and
- additional research and production chains, settlement growth, and the full campaign progression described in the game design.

Those systems are deliberately outside this first playable loop. See [the game design document](docs/GAME_DESIGN.md) for the target experience and explicit jam cuts.

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Use a compatible WebMCP host to test agent collaboration; otherwise, use the complete manual path in a standard browser.

## Project commands

```bash
npm run dev          # start the local development server
npm run build        # type-check and create a production build
npm run lint         # run ESLint
npm test             # run all tests once
npm run test:webmcp   # run WebMCP callback and lifecycle regressions
npm run preview      # serve the production build locally
```

## Project boundaries

- Single-page React and TypeScript application.
- Browser-local simulation and persistence; no backend required for the POC.
- Direct WebMCP Site Tool registration in supported environments.
- No model API calls or credentials inside the game.

## Documentation

- [Challenge requirements](docs/CHALLENGE.md)
- [Game and learning design](docs/GAME_DESIGN.md)
- [WebMCP testing and browser evidence](docs/WEBMCP_TESTING.md)
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md)

## License

[MIT](LICENSE)
