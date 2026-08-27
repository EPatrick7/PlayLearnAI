# Emberdeep game and learning design

## Product premise

The player is the overseer of a small underground colony. Their interface is a spatial, atmospheric command dashboard. Their browser agent is a staff officer with WebMCP tools for structured inspection and bounded action. Neither side is ideal alone: the human supplies intent, judgment, and oversight; the agent can synthesize dozens of changing variables without click-heavy micromanagement.

The game is inspired by the systemic colony-management genre, but its setting, characters, visual language, rules, and assets are original.

## The problem it teaches

Many people use AI as a one-shot answer machine. Effective delegation is closer to good management:

- establish shared context;
- define the outcome instead of dictating every click;
- include constraints and decision criteria;
- ask for evidence and rationale;
- make reversible, bounded changes;
- verify results before expanding scope.

Emberdeep converts those habits into survival mechanics.

## Core loop

1. A readable incident appears: dwindling food, untreated injuries, exhaustion, flooding, or morale collapse.
2. The player asks the agent to inspect relevant state without acting.
3. The agent queries structured colony tools and explains the tradeoff.
4. The player authorizes a constrained action plan.
5. Agent writes update the live colony UI immediately.
6. A small amount of simulation time passes.
7. Player and agent verify evidence, catch side effects, and decide whether to continue.

## Why this is agent-native

Twenty colonists already expose hundreds of relevant values across skills, condition, assignment, location, and relationships. Later scenarios will scale this to 60–100 colonists plus supply chains and scheduled incidents. The workload is deliberately unpleasant to solve by clicking, yet tractable for an agent given narrowly designed tools.

The agent does not receive a magic `solve_colony` function. It gets composable primitives:

- compact situation brief;
- filtered colonist query;
- work-order inspection;
- bounded work creation and prioritization;
- explicit batch assignment;
- bounded time advance;
- outcome verification.

This preserves meaningful reasoning and human oversight.

## Learning model

The browser page cannot reliably or privately grade every word the user writes to an external agent. The current design therefore scores observable collaboration behavior:

- inspecting before acting;
- providing action rationales;
- making bounded batches;
- advancing a small observation window;
- verifying after a state change.

Future scoring should add outcome deltas and scenario-specific objectives, while remaining transparent about what is measured. It should coach rather than punish experimentation.

## Hackathon scope

### Must ship

- One polished 5–8 minute playable scenario that demos well in under three minutes.
- Real WebMCP inspection and mutation tools.
- Visible human-agent shared state and action history.
- A clear before/after outcome from one strong delegation loop.
- Resettable demo state, responsive UI, deployment, and judge instructions.

### Valuable if time permits

- A timed cave-in or blight that forces replanning.
- Before/after verification diffs.
- Two difficulty modes: guided and unassisted.
- End-of-scenario report explaining which delegation habits helped.
- Tool-call replay for the demo and accessibility testing.

### Avoid for this deadline

- Procedural world generation.
- Multiplayer or accounts.
- A large tech tree.
- Server persistence.
- Built-in model/API calls; the browser agent is already the AI collaborator.
- Pixel-art asset production that competes with the agent-native experience for time.

## Design principles

- **Human-visible:** every write changes the shared UI and is recorded.
- **Bounded:** write tools cap batches and simulation time.
- **Reversible:** the scenario has a prominent reset and future undo checkpoints.
- **Specific:** tool names, schemas, and descriptions reflect colony decisions, not generic CRUD.
- **Consequential:** a superficially reasonable action can create fatigue or medicine side effects.
- **Teachable:** coaching names the next collaboration habit without solving the colony.
