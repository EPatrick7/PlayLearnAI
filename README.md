# PlayLearnAI: Moonbase

A browser-based lunar operations game about learning to supervise AI agents through shared, live tools.

This proof of concept puts the player in charge of a small Moon base during a pressure breach. The page is the shared source of truth: a person can operate the response manually, while a compatible browser agent can inspect and change the same simulation through WebMCP. The point is not to ask an AI for a one-shot answer. It is to practice grounding a decision in evidence, making a bounded plan, supervising execution, and verifying the result.

PlayLearnAI is being built for the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/).

## The pressure-breach loop

The POC is organized around one short operational loop:

1. **Ground** — inspect the vacuum-exposed laboratory, oxygen margin, dust forecast, power state, crew readiness, and location and condition of useful equipment before changing anything.
2. **Plan** — set an objective, oxygen floor, protected crew, time horizon, and stop condition. Assign suitable crew, reserve the required equipment, set priorities, and validate the Operations Plan before commit.
3. **Supervise** — commit against the current world and plan revisions, advance a bounded amount of time, and watch the same map, telemetry, crew state, equipment movement, work progress, and event history the agent is using.
4. **Verify** — compare fresh evidence with the original objective and constraints, confirm whether the laboratory is safe and research is restored, and identify any remaining oxygen or power risk.

Resetting the scenario makes it easy to try a different crew assignment or response order and compare outcomes.

## Play manually

WebMCP is optional for the manual path. After starting the app:

1. Start on the colony map. Select a furnished module, crew pawn, gear token, or numbered work site to inspect it in place.
2. Use the bottom **Work**, **Crew**, **Gear**, **Plan**, and **Log** dock to open only the command surface you need. On a small screen these open as scrollable bottom sheets, so the map remains the primary view.
3. In **Work**, choose an order and stage crew and required gear. The map draws the proposed routes. You can also choose **Stage a response** to load the recommended response for review.
4. In **Plan**, set the oxygen floor, protected crew, horizon, and stop condition. Review the full action queue and resource forecast, resolve any inline blocker, then commit.
5. Use the persistent time controls to advance one hour or run to the bounded stop. Watch pawns and equipment relocate, work sites fill, the laboratory move through **No → Low → Yes**, and the dust front change the solar field.
6. Choose **Verify** and compare the outcome against the objective, reserve floor, power state, and declared stop condition. Reset the deterministic seed to try another approach.

The simulation remains playable in a normal browser when WebMCP is unavailable.

### Fast successful run

For a deterministic smoke test, choose **Stage a response** from the incident card or Work drawer. It prepares a 12-hour horizon, a 12-hour oxygen floor, and an **Objective complete** stop with:

- Mateo + EVA Suit 01 + Engineering Kit 01 for the breach;
- Soo-jin + Engineering Kit 02 for repressurization;
- Leila for Regolith Sintering research; and
- Nia + EVA Suit 02 + the Kestrel rover for the solar bank.

The preview reports a valid 10-hour plan. Review it, commit, choose **To stop**, then **Verify**; all five outcome checks pass.

## Why WebMCP belongs here

Colony incidents create more relevant state than a player should have to copy into a chat window. A compatible agent can instead use structured Site Tools to:

- inspect live colony, pressure, crew, equipment, and incident state;
- prepare or apply bounded response actions;
- advance the simulation by a controlled amount; and
- retrieve fresh evidence for outcome verification.

Manual controls and agent tools operate on the same browser-local game state and use the same simulation rules. Agent actions become visible on the page rather than disappearing into a separate chatbot. There is no hidden solver, in-page model, API key, or privileged agent-only game state.

## Implemented POC scope

The current POC is intentionally narrow:

- one fixed lunar-base scenario with six named crew and an active laboratory pressure breach;
- engineering, science, medicine, and operations skills plus crew health, fatigue, morale, location, and work state;
- physical EVA suits, engineering and medical kits, and a rover with location, condition, reservation, transit, and deployment state;
- oxygen, food, water, construction stock, solar generation, demand, battery charge, and a dust forecast that can reduce power;
- a playable **Seal breach → Repressurize laboratory → Research Regolith Sintering** work chain, with a parallel solar-cleaning response;
- a revision-checked Operations Plan with objective, constraints, horizon, stop condition, editable actions, preview, validation, and commit;
- a complete Ground → Plan → Supervise → Verify response loop;
- manual play and equivalent WebMCP interaction categories over shared state;
- bounded time advancement with visible consequences and evidence-based verification; and
- browser-local progress plus deterministic scenario reset.

Given the same reset state and the same actions, the simulation produces the same result. Use the reset control to discard the current run and restore the original breach scenario.

## Later vertical-slice targets

The larger game design is not represented as implemented POC functionality. Planned vertical-slice work includes:

- incoming and returning flights competing for landing access;
- cargo recovery and physical pallet hauling;
- broader corridor and habitat construction planning; and
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
npm run dev       # start the local development server
npm run build     # type-check and create a production build
npm run lint      # run ESLint
npm test          # run the simulation tests once
npm run preview   # serve the production build locally
```

## Project boundaries

- Single-page React and TypeScript application.
- Browser-local simulation and persistence; no backend required for the POC.
- Direct WebMCP Site Tool registration in supported environments.
- No model API calls or credentials inside the game.

## Documentation

- [Challenge requirements](docs/CHALLENGE.md)
- [Game and learning design](docs/GAME_DESIGN.md)
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md)

## License

[MIT](LICENSE)
