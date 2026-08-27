# PlayLearnAI: Emberdeep

An agent-native colony management game that teaches people how to delegate effectively to AI.

Emberdeep presents the player with a living settlement: twenty colonists, competing work orders, scarce resources, injuries, fatigue, and cascading risks. The human sees a legible command interface. Their browser agent receives a structured WebMCP toolbelt that can inspect the same state and make bounded changes. Success comes from prompting the agent to gather evidence, act with clear constraints, and verify the outcome.

This project is being built for the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/).

## Why WebMCP belongs in the game

The colony is intentionally too information-dense to optimize by clicking through one worker at a time. WebMCP lets an agent query skills and risks, assemble a reasoned batch of assignments, and update the exact same browser state the player is watching. The page remains the shared, visual source of truth; the agent becomes a capable staff officer rather than a separate chatbot.

The learning loop is visible in the interface:

1. **Inspect** — ask for evidence and tradeoffs before authorizing changes.
2. **Act** — delegate a specific outcome with constraints and a rationale.
3. **Verify** — advance a small amount of time, check effects, and adjust.

## Current vertical slice

- Deterministic, browser-local colony simulation with 20 colonists.
- Resource consumption, fatigue, health, work progress, injuries, and risk alerts.
- Shared UI and agent state with persistent demo progress.
- Eight imperative WebMCP tools registered through `document.modelContext.registerTool()`:
  - `get_colony_brief`
  - `query_colonists`
  - `list_work_orders`
  - `create_work_order`
  - `assign_colonists`
  - `set_work_order_priority`
  - `advance_colony_time`
  - `verify_colony_outcome`
- A Promptcraft coach that rewards inspect → act → verify behavior.
- Manual time advancement and instant scenario reset for demos.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

Open the Vite URL in either:

- ChatGPT's in-app browser, which supports WebMCP; or
- Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled, followed by a browser restart.

In a browser without WebMCP support the simulation and UI still run, but the header reports `WebMCP unavailable` and no agent tools are registered.

## Try the core scenario

With Emberdeep open in a supported browser, ask the browser agent:

> Assess Emberdeep's three biggest risks. Use the colony tools, cite the evidence you found, and do not make any changes yet.

Then delegate a bounded response:

> Choose the single highest-leverage response. Explain your constraints, then make only the work-order and assignment changes needed. Protect injured or exhausted colonists.

Finally, close the loop:

> Advance only two hours, then verify whether the intervention worked. Compare the evidence with your expectation, report side effects, and stop before taking another action.

## Project commands

```bash
npm run dev       # start local development
npm run build     # type-check and create a production build
npm run lint      # run ESLint
npm test          # run the simulation tests once
npm run preview   # serve the production build locally
```

## Documentation

- [Challenge requirements](docs/CHALLENGE.md)
- [Game and learning design](docs/GAME_DESIGN.md)
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md)

## Status

This is an early hackathon build created after the challenge opened on August 25, 2026. The simulation is client-only and uses no API keys. Hosting, incident progression, outcome comparison, and the polished demo scenario are next.

## License

[MIT](LICENSE)
