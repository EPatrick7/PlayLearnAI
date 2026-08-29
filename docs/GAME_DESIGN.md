# PlayLearnAI: Moonbase — Game Design Document

**Status:** Locked concept; implementation scope still subject to jam cuts

**Working title:** PlayLearnAI: Moonbase

**Platform:** Web

**Mode:** Solo

**Genre:** Replayable lunar-colony simulation and AI-literacy game

**Primary showcase:** OpenAI WebMCP Challenge

**Jam integration target:** A compatible WebMCP-capable agent host in the supported challenge environment

This document defines the target game. It is not a claim that every system described below exists in the current prototype.

## 1. Product definition

### One-sentence pitch

Grow humanity's first lunar outpost into a resilient settlement while launch windows, scarce reserves, research, remote expeditions, and cascading failures keep changing the plan; every operation can be performed manually or delegated through WebMCP Site Tools to a compatible external agent host.

### Experience promise

The player sees and shapes a living top-down lunar base. Colonists walk, haul equipment, build modules, research technology, prepare rockets, respond to emergencies, and leave on long missions. A compatible external agent host receives the same game state and actions through WebMCP Site Tools.

The human supplies intent, spatial judgment, values, and authority. The agent supplies coordination bandwidth: it can inspect several systems, stage a cross-system plan, monitor execution, stop on exceptions, and verify the outcome. Neither receives hidden advantages.

### Audience

PlayLearnAI is designed for AI literacy. Its target player understands chat-based AI but may not yet think in terms of tools, live state, bounded authority, verification, reusable skills, or parallel subagents.

The challenge judges are the primary audience for the jam build. The educational value is demonstrated through play rather than framed as a classroom product or formal curriculum.

### Product goals

- Deliver a satisfying colony simulation even when played manually.
- Demonstrate non-trivial, visible WebMCP collaboration.
- Teach the transition from asking for answers to supervising agentic work.
- Create multiple valid solutions through interacting systems and seeded variation.
- Make better task specification and supervision produce visibly better outcomes.
- Keep the science recognizable without turning the interface into a textbook.

### Non-goals

- Multiplayer or team-based play.
- An in-page chatbot or fictional station-AI character.
- A single scripted puzzle with one correct prompt.
- A realistic gas-fluid, orbital-mechanics, or chemistry simulator.
- Full diplomacy, tactical combat, aliens, or a second playable world map.
- Grading the wording of a player's prompt.
- Giving the agent a hidden `solve_colony` or `optimize_mission` action.

## 2. Design pillars

### Living system, not authored answer

The game generates situations from colony state, geography, traffic, maintenance, and an incident director. The learning objectives remain stable while the exact problems and valid responses vary.

### Same verbs, different bandwidth

Every implemented gameplay action is available through both the manual interface and WebMCP. The agent is faster at inspection, batching, forecasting, and multi-front coordination; it does not receive exclusive actions or information.

### Rockets are the strategic clock

Arrivals and departures create deadlines. Passenger capacity, cargo mass, equipment, launch pads, propellant, research, crew readiness, and emergencies make each flight a colony-wide commitment.

### Failure creates another plan

Most mistakes cause injury, delay, lost resources, damaged equipment, stranded crews, or reduced support rather than an immediate reset. Recovery and rescue are central stories.

### Science is structural, not ornamental

Resources, technology names, and recipes use real lunar geology and established chemical processes. The main interface communicates only what the player needs to decide.

### Quiet, authored presentation

The world uses smooth, readable sprites and a restrained mission-control interface. Copy is short and mechanical; the complete presentation guardrails live in Section 19.

## 3. Game structure

### Guided Run

The primary mode begins with contextual guidance and becomes unrestricted play without a mode break.

- A normal run lasts roughly 30–45 minutes of real time.
- The colony advances through several in-game years.
- All manual controls and WebMCP actions are available from the start.
- Guidance responds to suitable live situations instead of forcing a fixed chapter order.
- Hints identify a missing thinking step, not an exact prompt or solution.
- Guidance fades as the player demonstrates complete operating loops.
- After the victory milestone, the player may continue in endless play.

### Victory

The scored run ends successfully when the player:

1. establishes a self-sustaining lunar settlement for survival-critical bulk needs; and
2. completes a successful main-belt resource-return mission.

Self-sustaining does not mean independent from Earth. Electronics, precision machinery, polymers, seals, medicines, nitrogen, and nutrient salts remain valuable imports.

### Loss and continuation

The run continues through casualties, failed launches, lost spacecraft, and damaged habitats. It ends only when no viable population or habitat remains, or when the player abandons the colony.

### Core loop

1. Inspect the base, people, schedules, research, and remote missions.
2. Choose an objective and define constraints, authority, time horizon, and stop conditions.
3. Stage construction, work, equipment, research, rocket, or mission orders.
4. Preview costs, conflicts, risks, and expected effects.
5. Commit manually or authorize the agent to commit within its mandate.
6. Advance time while watching visible execution.
7. Stop on a milestone, exception, or threshold.
8. Verify the result against the original objective.
9. Adapt the plan and continue.

## 4. Setting and tone

The game takes place at humanity's first permanent lunar base. The starting settlement is a barely functional outpost near a favorable south-polar site: six colonists, one lander, a habitat, basic life support, solar power, storage, and limited equipment.

Several fictional Earth sponsors provide missions, passengers, equipment, contracts, and launch capacity. They emphasize different priorities—science, settlement, industry, safety, or prestige—but do not create a diplomacy game.

The tone is grounded, optimistic near-future engineering under real danger. Colonists are professionals, not caricatures. Alerts describe the condition, deadline, and consequence without melodrama.

## 5. The player's role

The player is the settlement director. They can act directly, delegate through a compatible external agent host, or combine both approaches.

The player can:

- inspect terrain, modules, networks, inventories, colonists, risks, research, rockets, and remote missions;
- place, rotate, prioritize, pause, repair, isolate, seal, and deconstruct structures;
- designate mining, hauling, construction, research, medical, and maintenance work;
- assign workers, define shifts, protect personnel from reassignment, and set job priorities;
- move, assign, reserve, repair, and replace equipment;
- set storage targets, reserve floors, power priorities, alert thresholds, and contingency policies;
- choose one research focus and assign researchers;
- accept, defer, or reject flights and edit passenger or cargo manifests;
- plan, launch, supervise, recall, abort, rescue, and recover remote expeditions;
- pause, change speed, or advance to a bounded condition;
- preview, amend, commit, and verify an Operations Plan.

## 6. Time and simulation

### Time model

The base simulates work in hours and days while remote programs span months and years. The game deliberately compresses uneventful time so several years fit into a normal run.

Controls include:

- pause;
- normal speed for visible work and emergencies;
- several faster speeds for stable operations;
- advance to the next scheduled milestone; and
- `advance until` with explicit stop conditions.

Examples of stop conditions:

- oxygen reserve falls below 12 hours;
- a critical alert appears;
- the focused technology completes;
- a launch conflict appears;
- a construction plan blocks;
- a remote mission reaches its next phase;
- a stranded crew reaches its rescue deadline.

Critical alerts and remote mission decisions automatically pause time. The game uses **Mission Day** and **Mission Year**, not “sol.”

### Determinism

Each run has an explicit seed. The same seed and the same actions produce the same simulation outcome. Forecasts never reveal hidden future incidents.

## 7. The lunar map

### Camera and layout

- Single top-down, orthographic map.
- Square placement grid shown only while building or using an overlay.
- Three useful zoom levels: settlement, module, and worker detail.
- Module interiors remain visible through cutaway roofs.
- Distance affects walking, hauling, maintenance, construction, and emergency response.

### Terrain and geology

The starting region is a favorable, impact-mixed south-polar site. Orbital surveys show probable geology; local rover sampling reveals exact deposit type and grade.

Primary feedstocks are:

- **Ice-bearing regolith:** contaminated polar material that can yield water and trace volatiles.
- **Anorthite-rich highland regolith:** common feedstock for sintered construction material, glass-ceramics, oxygen, and later metal or silicon products. Anorthite is the mineral `CaAl₂Si₂O₈`; the regolith is a mixture, not a pure compound.
- **Mafic impact ejecta:** localized pyroxene- and olivine-bearing material richer in iron and magnesium.
- **Ilmenite-bearing regolith — FeTiO₃:** scarce high-value feedstock for hydrogen reduction.
- **Impact-metal fragments:** occasional iron–nickel salvage, never a large native-metal mine.

The map does not contain colorful fantasy ore veins. Deposits appear as assay grades within believable geological units.

### Construction

The base uses prefabricated modules placed on a grid and connected through explicit hatch ports, corridors, airlocks, power, and fluid infrastructure.

Placement matters because it changes:

- pressure-zone boundaries;
- utility connection length;
- hauling and walking time;
- emergency access;
- dust exposure near landing pads;
- available expansion space; and
- redundancy between critical modules.

## 8. Atmosphere and life support

### Tile atmosphere

Every interior tile has one of three readable states:

| State | Meaning | Gameplay |
|---|---|---|
| **Yes** | Safely pressurized | Normal work without a suit |
| **Low** | Inadequate pressure or active repressurization | Reduced performance and escalating health risk |
| **No** | Vacuum | Immediate danger without appropriate EVA equipment |

Open hatches and connected habitat tiles form pressure zones. A breach plays one clear venting effect, then immediately changes every exposed tile in that connected zone to **No**. Sealed neighboring zones remain intact.

Repressurization progresses **No → Low → Yes** and consumes oxygen, power, equipment time, and access to a functioning life-support connection. There is no per-particle or fluid gas simulation.

### Life-support systems

The colony manages:

- oxygen production and reserve;
- water recovery and storage;
- cabin gas and pressure;
- carbon-dioxide removal;
- food supply and hydroponics;
- thermal load and module condition; and
- radiation shelter capacity.

Life-support failures interact with construction, power, staffing, and equipment rather than existing as isolated meters.

## 9. Power, production, and logistics

### Power

Solar arrays, batteries, distribution connections, and module priorities form a visible network. Dust, launch activity, damage, distance, and industrial loads affect supply.

The player can isolate a circuit, change priority, reserve battery capacity, or shut down noncritical production. High-temperature research and manufacturing compete directly with life support and rocket preparation.

### Inventory rule

There is no shared colony inventory.

- Colonists carry assigned equipment.
- Rovers carry tools or cargo.
- Solids occupy local pallets, lockers, hoppers, or module storage.
- Fluids and gases occupy tanks and connected pipes.
- Jobs reserve inputs and equipment, then require physical retrieval and hauling.
- Dashboard totals are summaries, not teleporting stockpiles.

### Equipment

Equipment is deliberately simple and discrete:

- EVA suit;
- engineering kit;
- medical kit;
- survey kit;
- hauling cart;
- rover;
- mission payload modules; and
- critical machine spares.

Equipment has location, assignment, availability, and condition. It does not use quality tiers in the initial design.

### Core commodities

- Power
- Oxygen
- Water and ice-bearing feedstock
- Food
- Construction and pressure components
- Propellant
- Research progress
- Program Support
- Launch Allocation

Processed materials remain spatial objects even when the interface summarizes them.

## 10. Colonists and work

### Colonist model

Each colonist has:

- name and visual identity;
- role and a small skill profile;
- health;
- fatigue;
- morale;
- current location and task;
- assigned equipment; and
- one defining trait.

The initial design does not include a full relationship or social-combat simulation.

### Skills and jobs

Exact labels are subject to balancing, but the supported work covers:

- engineering and construction;
- operations and logistics;
- medicine;
- science and research;
- geology and extraction; and
- piloting and mission supervision.

Research is a real job. A colonist must work at a functioning research station with power and required equipment to generate progress.

### Morale

Morale responds to safety, workload, fatigue, privacy, injuries, mission losses, deaths, successful rescues, and settlement stability. It changes work performance and recovery but does not create elaborate social drama.

### Injury, death, and rescue

Injury and evacuation are common crisis outcomes. Permanent death is possible but strongly telegraphed. Remote mission failure normally follows:

`anomaly → damaged or stranded → rescue window → permanent loss`

Rare severe failures can destroy a craft immediately when the player accepted an explicitly extreme risk.

## 11. Research and technology

### Research economy

- The colony has one research-point type.
- Only one technology is focused at a time.
- Assigned researchers generate points while working.
- Points immediately reduce the focused technology's remaining cost.
- Changing focus preserves partial progress.
- Researcher skill, laboratory condition, equipment, and power change the rate.
- Samples and mission data grant a speed bonus or reduce remaining cost; they do not create another science currency.

Research represents adapting, prototyping, and qualifying known processes for lunar dust, vacuum, temperature, feedstock, and scale. Colonists are not rediscovering basic chemistry.

### Science presentation rule

The main recipe card shows:

- accurate process name;
- inputs and outputs;
- power requirement;
- duration; and
- important byproducts.

An expanded detail may show the chemical equation and one concise sentence of context. The game sells scientific depth without requiring the player to study paragraphs before acting.

### Target technology tree

The target tree is small enough to read at once. The player will normally complete only part of it before victory.

| Tier | Technology | Primary unlock |
|---|---|---|
| I | Geological Prospecting | Survey drill, deposit type, and grade |
| I | Regolith Sintering | Roads, pads, floors, shielding blocks |
| I | Closed-Loop Life Support | Improved water and cabin-gas recovery |
| II | Thermal Volatile Extraction | Water and mixed condensate from ice-bearing regolith |
| II | Mineral Beneficiation | Useful mineral concentrates from mixed regolith |
| II | Glass and Ceramics | Glass-ceramic stock from silicate feedstock |
| II | Water Electrolysis | Oxygen and hydrogen production |
| II | Controlled-Environment Agriculture | Hydroponic food production |
| III | Hydrogen Reduction of Ilmenite | Iron, titanium dioxide, recoverable water, and oxygen cycle |
| III | Cryogenic Gas Handling | LOX/LH₂ storage and rocket refueling |
| III | Local Fabrication | Mechanical spares and locally framed pressure modules |
| III | Autonomous Flight | Robotic navigation, rendezvous, and remote supervision |
| IV | Molten Regolith Electrolysis | Oxygen and metal/silicon products from bulk regolith |
| IV | Lunar Photovoltaic Fabrication | Local solar assemblies using imported precision components |
| IV | Robotic Expeditions | Fully autonomous survey, extraction, and return missions |

### Representative recipes

| Process | Simplified recipe |
|---|---|
| Thermal volatile extraction | Ice-bearing regolith + heat → dirty water + dry tailings |
| Water purification | Dirty water + filtration → H₂O + contaminant concentrate |
| Water electrolysis | `2 H₂O → 2 H₂ + O₂` |
| Microwave sintering | Sized regolith + heat → glass-ceramic construction stock |
| Mineral beneficiation | Ilmenite-bearing regolith + power → ilmenite concentrate + silicate tailings |
| Hydrogen reduction | `FeTiO₃ + H₂ → Fe + TiO₂ + H₂O` |
| Sabatier recycling | `CO₂ + 4 H₂ → CH₄ + 2 H₂O` |
| Molten regolith electrolysis | Molten oxide-rich regolith + extreme power → O₂ + metal/silicon products |
| Cryogenic processing | O₂ + H₂ + cooling → LOX/LH₂ propellant |
| Pressure component | Iron frame + glass-ceramic + imported liner and seals → pressure component |
| Solar assembly | Purified silicon + conductor + imported dopants/electronics → photovoltaic assembly |

### Scientific constraints

- Lunar oxygen is chemically bound in oxides and silicates; releasing it requires substantial energy.
- Hydrogen reduction produces titanium dioxide, not finished titanium metal.
- Molten regolith electrolysis is a high-temperature late-game process, not an early universal refinery.
- Carbon and nitrogen remain scarce and import-dependent even when aggressively recycled.
- Water and polar volatiles are finite on gameplay timescales.
- Helium-3, effortless rare-earth mining, and invented universal ores are excluded from the core economy.

## 12. Earth traffic and sponsors

### Strategic currencies

The colony uses two external support currencies instead of ordinary cash:

- **Program Support:** political and organizational willingness to fund the settlement. It is earned through scientific results, contracts, exports, rescues, population milestones, and successful missions, then spent on people, spacecraft, equipment, medicine, precision parts, food, nitrogen, or emergency relief.
- **Launch Allocation:** Earth-to-Moon launch slots and payload quota. It replenishes at scheduled sponsor windows and through major contract rewards. Booking an Earth-origin flight reserves allocation according to payload mass and urgency; it is consumed at launch. Canceling before the manifest lock returns the reservation, while a late cancellation loses part of it.

Launch Allocation is separate from local pad capacity, transfer windows, spacecraft, and propellant. Having one does not guarantee the others.

### Flights

Each rocket has:

- arrival or departure window;
- passenger manifest;
- cargo manifest and mass limit;
- pad and handling requirement;
- propellant and reserve requirement;
- mission owner or sponsor; and
- consequences for delay, rejection, or failure.

The player can accept, defer, reject, or renegotiate manifests. A useful specialist may also create immediate housing, food, equipment, and oxygen pressure.

## 13. Remote Operations

Remote Operations are managed from Mission Control. They never open a second playable map. The player controls them through target data, plans, schedules, equipment commitments, progress phases, telemetry, and event orders.

### Mission classes

#### Lunar subsites

- Nearby craters, permanently shadowed regions, lava tubes, and exposed geological units.
- Survey, sample return, equipment deployment, limited extraction, automated site establishment, service, recall, and rescue.
- Shorter travel measured in Mission Days or months.

#### Near-Earth asteroid expeditions

- Survey, sample return, pilot extraction, and bulk-return development.
- Multi-year programs with meaningful launch-window, vehicle, autonomy, and return-capacity constraints.

#### Main-belt campaigns

- Late-game crew-supervised or autonomous resource expeditions.
- Long-duration commitments spanning several Mission Years.
- Completing a main-belt resource return is part of the victory condition.

### Mission phases

1. **Survey:** reveal composition ranges, hazards, transfer information, and assay confidence.
2. **Plan:** select objective, vehicle, payload, crew, reserves, risk ceiling, and abort rules.
3. **Stage:** fabricate parts, reserve equipment, load cargo, fuel the craft, and secure a launch window.
4. **Transit:** advance through scheduled milestones and possible navigation, radiation, communication, or equipment events.
5. **Operate:** survey, anchor, sample, extract, repair, extend, or depart early.
6. **Return:** preserve enough capacity for rendezvous, capture, descent, and recovery.
7. **Recover cargo:** reserve a pad, unload physical pallets, haul them into storage, and process the feedstock.

### Mission orders

Every mission plan records:

`objective + target + craft + crew + payload + schedule + reserve margins + autonomy policy + intervention thresholds + abort conditions`

### Crew and automation

Early asteroid missions may carry humans for supervision. Crewed missions require seats, food, water, oxygen, radiation shelter, medical capacity, and appropriate skills. Assigned people and equipment are physically unavailable to the base.

Research progressively unlocks automatic navigation, rendezvous, extraction, and return. Later robotic missions trade crew safety and availability for greater dependence on sensors, equipment condition, and contingency planning.

### Asteroid resource categories

- **Hydrated Carbonaceous Regolith:** water-bearing minerals, carbon compounds, carbonates, sulfides, and phosphates.
- **Silicate Feedstock:** olivine- and pyroxene-rich material for ceramics, shielding, and energy-intensive processing.
- **Fe–Ni Metal:** metal-rich feedstock that still requires refining.
- **Sulfide Concentrate:** useful sulfur- and metal-bearing material with processing hazards.
- **Volatile Ice:** uncommon volatile-rich targets rather than a property of every carbonaceous asteroid.

### Mission risk

Risk comes from visible causes:

- poor survey confidence;
- insufficient power or propellant reserve;
- weak anchoring on low-cohesion targets;
- inadequate autonomy;
- communication delay;
- radiation exposure;
- equipment wear;
- launch congestion;
- aggressive extraction policy; and
- inadequate return or recovery capacity.

Most failures produce delay, partial data, reduced cargo, contamination, damaged equipment, a rescue opportunity, or a stranded craft. Permanent spacecraft loss remains possible. Replacement craft can be ordered from Earth or built locally after sufficient research and industrial development.

## 14. Incidents, emergence, and replayability

### Seeded variation

Each run uses separate deterministic streams for:

- terrain and deposit grades;
- starting crew and skills;
- equipment condition;
- rocket traffic and manifests;
- remote targets;
- component faults; and
- external hazards.

A curated showcase seed may be used for the judge demo, but it follows the same simulation rules as other runs.

### Incident director

Incidents come from authored mechanical templates with variable targets, timing, and severity. The game does not generate event prose.

Major hazards are usually telegraphed. Minor faults are less predictable but influenced by visible wear, staffing, redundancy, and maintenance.

Potential incidents include:

- solar-radiation warning;
- micrometeorite damage;
- moonquake activity;
- pressure breach;
- life-support contamination;
- power shortfall;
- landing dust damage;
- pad or launch delay;
- medical emergency;
- remote communication loss;
- stranded expedition;
- equipment failure; and
- emergency arrival or evacuation request.

### Fairness rules

- No early catastrophic combinations without a viable response.
- Severe incidents have at least one reachable mitigation or expensive emergency escape.
- Event pressure allows recovery time after major losses.
- Failures exploit existing weak points more often than arbitrary bad luck.
- Forecasts show known risks and ranges but never reveal hidden future events.

### Example systemic chain

`accept six colonists → require another habitat → increase power demand → divert ice processing → reduce propellant reserve → threaten an outbound mission → launch dust lowers solar output`

The chain is an illustration of interacting mechanics, not a scripted scenario.

## 15. Human-agent collaboration

### External agent

The AI conversation takes place outside the game page. The page is the shared visual source of truth and exposes Site Tools through WebMCP. The jam build targets and names only compatible hosts tested in the challenge environment; it does not claim universal agent compatibility. There is no built-in model call or in-game chat panel.

### Parity invariant

Every implemented gameplay action—inspection or mutation—must satisfy all of the following:

- A human can perform it through the visible interface.
- A compatible external agent can perform it through a typed WebMCP tool.
- Both read through the same selectors and visibility rules.
- Mutations use the same validator, command, and simulation logic and pay the same material, labor, time, and risk costs.
- Neither can inspect hidden incident rolls or privileged simulation state.
- The result is visible on the shared page and recorded in the activity history.

Camera movement, zoom, panel layout, and other presentational preferences are not simulation actions and do not need tool equivalents. Their underlying gameplay information must still be available through bounded read tools. Parity does not require equal interaction speed: structured queries and batching are part of the agent's coordination advantage.

### Operations Plan

The central collaboration artifact is an editable, versioned Operations Plan—not a chat transcript.

It can contain:

- construction blueprints;
- work orders and assignments;
- equipment reservations;
- network and pressure changes;
- research focus;
- rocket manifest changes;
- remote mission orders;
- policies and constraints;
- forecast horizon; and
- stop conditions.

Staged actions appear in cyan on the map and relevant panels. The player may move, remove, or amend any item before commit. Agent and manual edits change the same plan revision.

### Authority

The agent may automatically commit routine actions inside a player-defined mandate. The following default to staged approval:

- rocket launch;
- mission launch, recall, or abort;
- evacuation;
- dangerous rationing;
- rejecting colonists;
- demolition of occupied or critical modules; and
- actions exceeding a declared resource or risk threshold.

### State revisions

Every state-bearing read returns the current world revision and time. Consequential writes require the revision they were planned against. Stale plans fail cleanly and identify what changed.

## 16. WebMCP action design

OpenAI describes Site Tools as its implementation of the proposed WebMCP standard: a website exposes useful actions to an agent alongside the interface people already use. PlayLearnAI applies that model directly. Site Tools reuse the game's existing logic and return enough evidence to verify a result.

### Tool principles

- Narrow, typed inputs.
- Stable entity identifiers.
- Clear read versus write behavior.
- Domain verbs rather than generic CRUD.
- No natural-language execution endpoint.
- Bounded map reads and result sizes.
- Batch limits for consequential actions.
- Preview before high-impact commit.
- Exact before/after diffs.
- Verification against the original plan baseline.

### Provisional tool families

| Phase | Tools | Purpose |
|---|---|---|
| Inspect | `inspect_colony`, `query_entities`, `inspect_map_region` | Read alerts, people, equipment, modules, storage, production, routes, atmosphere, and networks |
| Analyze | `trace_dependencies`, `inspect_research`, `inspect_flights`, `inspect_support` | Expose blockers, rates, prerequisites, deadlines, resource chains, and external capacity |
| Remote | `list_remote_targets`, `inspect_remote_target`, `inspect_remote_missions` | Read target confidence, mission plans, telemetry, phase, and risk |
| Plan | `preview_operations_plan` | Stage typed actions and show conflicts, cost, projections, and approval flags |
| Commit | `commit_operations_plan` | Atomically commit the reviewed plan or reject a stale revision |
| Operate | `manage_construction`, `manage_work`, `manage_equipment`, `configure_networks`, `configure_policies`, `manage_production`, `set_research_focus`, `manage_procurement`, `manage_flight`, `manage_remote_mission`, `respond_to_incident` | Cover the typed mutation catalog without a general command endpoint |
| Time | `set_simulation_control`, `advance_until` | Pause or set speed, or advance bounded simulation time with explicit stop conditions |
| Verify | `verify_operations_plan`, `verify_remote_mission` | Compare actual outcomes with objective, constraints, forecast, and baseline |

The exact registration catalog may be consolidated for schema reliability, but no implemented gameplay action may disappear from either surface. The shipped action registry records each inspection or mutation, manual entry point, Site Tool schema, approval rule, selector, and shared command handler where applicable. An automated parity test fails when a registered gameplay action lacks either entry point.

### Manual/WebMCP mapping

| Domain | Manual interface | Agent capability |
|---|---|---|
| Construction | Build rail, map placement, plan editor | Inspect tiles, stage coordinates, amend or commit blueprints |
| Crew and jobs | Roster, filters, assignment and priority controls | Query workers, stage assignments, set priorities and protections |
| Equipment | Inspectors, lockers, reservations, repair queue | Locate, reserve, assign, move, repair, or replace equipment |
| Storage and logistics | Storage inspectors, target and reserve controls | Inspect location and routes; set targets, reservations, and reserve floors |
| Production | Recipe cards, input selectors, production queue | Inspect chains; queue, prioritize, pause, or cancel recipes |
| Atmosphere, life support, and power | Network overlays, hatch, circuit, and priority controls | Inspect zones and loads; isolate connections, operate hatches, and set priorities |
| Research | Tech tree, focus control, researcher assignment | Inspect prerequisites, select focus, assign labor, verify unlock |
| Sponsors and procurement | Support panel, order and allocation controls | Inspect balances; order supplies or craft and reserve Launch Allocation |
| Rockets | Schedule and manifest panels | Inspect windows, edit manifests, accept, defer, reject, divert, stage, or authorize flights |
| Remote missions | Mission Control cards and plan editor | Survey, plan, update, respond, rescue, abort, recover, and verify |
| Incidents and policies | Alert actions, thresholds, contingency editor | Inspect cause and deadline; respond and set matching thresholds or contingencies |
| Time | Pause, speed controls, milestone advance | `set_simulation_control` and bounded `advance_until` with equivalent stop conditions |

### Activity history

The page records concise state transitions:

`Observed → Planned → Changed → Verified`

Each entry identifies author, time, targets, and state diff. Raw tool details remain expandable. The page does not invent agent reasoning or generated captain's-log prose.

## 17. AI-literacy design

### Learning objective

The game teaches a move from chat-style requests to supervised agentic operation:

- ground decisions in live evidence;
- define outcome and constraints;
- establish authority and stop conditions;
- use tools to act on shared state;
- parallelize genuinely independent work;
- monitor and adapt;
- verify the actual outcome; and
- turn repeatable procedures into reusable skills.

### Contextual learning arc

1. **Ground:** ask the agent to inspect live state and support its claims with telemetry.
2. **Delegate:** provide an objective, constraints, authority, time horizon, and stop conditions.
3. **Supervise:** observe bounded execution and intervene when priorities or state change.
4. **Verify:** compare fresh evidence with the original objective and residual risks.
5. **Parallelize:** delegate separable workstreams and reconcile conflicts in the parent plan.
6. **Reuse:** encode a successful recurring procedure as an external skill and apply it to a changed situation.

The first four beats form the jam tutorial. Parallelization and skill reuse form the capstone.

### Capstone

The capstone prepares a major asteroid mission while the visible base remains active. Suggested independent analyses are:

- base and life-support readiness;
- crew, health, and equipment readiness;
- spacecraft, payload, launch, and return logistics; and
- research prerequisites and opportunity cost.

The main agent combines those results into one Operations Plan. The capstone then has the player create an external **Mission Controller** skill from the successful procedure and reuse it on a different target or seed.

### Evidence, not prompt grading

The game never assigns a numeric “prompt quality” score. It recognizes observable practices:

- **Inspected**
- **Set Constraints**
- **Delegated**
- **Adapted**
- **Verified**

The webpage can evaluate its own tool calls, plans, constraints, state changes, and outcomes. **Delegated** appears only when the host provides explicit provenance metadata; otherwise subagent and skill use remain visible in the external agent interface and unscored by the page. The game never infers invisible host behavior.

### Results

The end-of-run report separates:

- **Colony outcome:** survival, safety, reserves, population, science, mission success, losses, and support.
- **Workflow evidence:** grounding, constraints, bounded action, adaptation, delegation evidence, and verification.

Manual play can achieve an excellent colony result without falsely receiving an agentic-workflow score.

## 18. Interface design

### Primary screen

The lunar map dominates the page.

- **Top strip:** Mission Day/Year, speed, population, oxygen, power, water, thermal status, research focus, and next rocket.
- **Left rail:** construction, work, overlays, and planning tools.
- **Right inspector:** selected tile, person, module, equipment, rocket, or mission.
- **Bottom timeline:** incidents, work transitions, launches, mission milestones, and verification results.
- **Drawers:** Research, Mission Control, Operations Plan, and Agent Activity.

Panels collapse so the game remains usable beside an external agent window.

### Overlays

Initial overlays are limited to:

- Atmosphere
- Power
- Logistics

Build previews show footprint, hatch access, pressure sealing, utility connections, route implications, required materials, and projected network effects.

### Shared action language

- Dashed cyan ghost: staged plan.
- Solid queued shape: committed order.
- Visible worker motion: active work.
- Amber marker: blocked.
- Brief check and timeline entry: complete.
- Red pulse and zone fill: critical hazard.

Agent actions become ordinary game orders after commit. Provenance appears as a subtle label, not a special visual power.

### Copy rules

- Use stable nouns: Crew, Module, Rocket, Order, Incident, Plan, Equipment, Mission.
- Use direct verbs: Build, Assign, Launch, Recall, Repair, Inspect, Seal, Research, Verify.
- Alerts fit one sentence with condition, deadline, and consequence.
- Tutorial objectives fit one line, with optional details.
- No assistant banter, lore dumps, fake quotations, or decorative telemetry.

Example:

> Solar storm in 3h 20m. Four crew remain outside shelter.

## 19. Visual and audio direction

### Visual identity

The target is a **lunar operations diorama**: readable top-down colony sprites on muted regolith, paired with a calm mission-control interface.

- Smooth antialiased flat sprites, not ASCII and not pixel art.
- Strong silhouettes and two-value shading.
- One consistent shadow direction.
- Modular suit, helmet, role-stripe, rover, rocket, and building parts.
- Cutaway interiors and unmistakable hatches, routes, pressure states, and equipment.

### Palette

- Regolith gray, graphite, and off-white for the world.
- Cobalt for selection.
- Cyan for staged plans.
- Amber and red for hazards.
- Green for nominal state.
- Color is always paired with an icon, pattern, or shape.

### Anti-slop guardrails

- No purple-blue gradient wash.
- No holographic clutter, bloom, or glass-card wall.
- No robot mascot, sparkles, brain icons, or emojis.
- No invented technical jargon.
- One icon family, one primary sans family, and one numeric mono face.
- Every animation must communicate a state change.

### Priority animation

Landing and launch receive the most polish. Other animations remain short and functional: walking, hauling, door operation, construction progress, equipment use, damage, venting, and recovery.

### Audio

Audio is restrained and informational:

- low mechanical ambience;
- short hatch, machinery, rover, launch, and decompression cues;
- distinct warning levels without constant alarm noise; and
- no unlicensed music in the challenge build.

## 20. Scoring

The score communicates tradeoffs rather than prescribing one play style.

Suggested categories:

- **Resilience:** life-support margins, redundancy, maintenance, and recovery.
- **Settlement:** surviving population, capacity, morale, and local production.
- **Science:** completed research and useful mission data.
- **Operations:** launch reliability, mission success, cargo return, and rescue outcomes.
- **Support:** sponsor commitments fulfilled and emergency assistance consumed.

Deaths, abandoned crews, destroyed craft, failed contracts, and emergency resupply reduce relevant categories but do not automatically invalidate a run.

## 21. Challenge vertical slice

The target design is larger than the jam build. The submission is a polished 12–18 minute established-colony scenario, not a shortened campaign. It proves one compound operational problem, the shared command architecture, and the complete inspect-to-verify loop. Systems outside the slice action registry must not appear as actionable controls.

### Must-ship simulation

- One fixed, approximately 24×18 top-down sprite map with a prebuilt base, one small expansion area, and seeded parameter variations. The slice does not generate a new terrain layout.
- Six crew with four skills—engineering, science, medicine, and operations—and compact health, fatigue, morale, task, and trait state.
- Eight readable module types: Corridor, Habitat, Life Support, Storage, Laboratory, Airlock, Solar/Battery Skid, and Landing Pad. Only corridors and one habitat extension are placeable in the slice; the other modules can be inspected, prioritized, and repaired.
- Atmosphere states **Yes / Low / No**, hatch-defined zones, one breach effect, sealing, and repressurization.
- Six physical equipment objects drawn from EVA suits, engineering kits, medical kits, and one rover. Location, reservation, retrieval, and condition have gameplay consequences.
- Four operational reserves—oxygen, water, food, and construction stock—plus live power generation, demand, and battery charge.
- One science-rooted production job: microwave sintering of prepared regolith into construction stock.
- One working research payoff, **Regolith Sintering**, with one active focus and assigned researcher; completing it unlocks the slice's production job. Other target-tree nodes need not function in the slice.
- One incoming crew transport and one returning remote cargo craft competing for the single pad. Mission Control exposes only the decisions needed for this return: inspect telemetry and cargo, change its pad schedule, order a holding orbit or emergency diversion, authorize landing, and order cargo recovery.
- Returned cargo represented as physical pallets that must be unloaded and hauled.
- Two parameterized incident families: a micrometeorite pressure breach and dust-related power loss. Flight timing, affected module, crew strengths, equipment condition, and reserve margins vary by seed.
- A bounded action union: place corridor or habitat blueprint, assign or prioritize work, reserve equipment, operate a hatch, repair a module, repressurize a zone, queue production, set research focus, manage either flight, and control time.
- An editable Operations Plan with preview, commit, approval gates, world/plan revision checks, bounded advance, and verification.
- Manual/WebMCP parity for every action in that union, enforced by the action registry.
- Contextual **Ground → Delegate → Supervise → Verify** guidance, deterministic reset, and a tested short judge path.

### Required challenge integration

- The complete slice loop works end to end in at least one named, compatible agent host in the supported challenge environment.
- The longer capstone performs a real read-only subagent fan-out in that host, with only the parent agent allowed to stage or commit writes.
- The player creates or refines an external **Mission Controller** skill from a successful procedure and reuses it after changing the seed or mission constraints.
- The page scores only the tool calls and resulting game state it can observe. Subagent and skill use are demonstrated in the external host and are not falsely inferred by the game.

### Valuable if time permits

- A third incident family based on a life-support equipment fault.
- Rescue instead of simple recall or loss for the returning craft.
- A second live production recipe or research payoff.
- End-of-scenario colony and workflow report.

### Explicit cuts for the jam

- Multiplayer, accounts, and server persistence.
- A second local or asteroid map.
- Procedural terrain generation, deposit exploration, and mining.
- Whole-base construction and freely routed utility networks.
- Modular spacecraft construction.
- Full multi-year campaign progression and complete victory sequence.
- More than one live production chain or research payoff, plus detailed material-purity simulation.
- Complete lunar-subsite, sponsor, contract, rescue, and replacement-craft economies.
- Program Support and Launch Allocation procurement systems.
- Planning a remote expedition from survey through launch; the slice begins with a craft already returning.
- Human asteroid travel beyond mission records, manifests, telemetry, and event decisions.
- Full relationships or social combat.
- Complex gas, temperature, orbital, or chemical simulation.
- Dynamic lighting, multiple biomes, complex particles, and full directional animation.
- Procedurally generated prose.
- An in-page model or API integration.

### Initial art budget

- Eight compact module kits, with construction states only for Corridor and Habitat.
- Modular crew sprites assembled from a small set of suit and role parts.
- One rover.
- Cargo pallet and equipment sprites.
- One rocket with landed, launching, and in-flight states.
- Breach, vacuum, low-pressure, and dust/power hazard states.
- Approximately 16 consistent interface icons.

## 22. Judge demonstration shape

The showcase seed starts in an active colony rather than a fixed-answer puzzle. An inbound crew transport needs another habitat, a returning cargo craft needs the same pad soon afterward, one pressure zone has poor fault margin, the correct equipment is inconveniently stored, and a dust forecast threatens power.

### Four-to-five-minute golden path

1. The judge gives an objective, reserve floor, protected crew member, authority boundary, and stop condition.
2. The compatible agent inspects the compound state and stages one bounded Operations Plan.
3. The judge moves one proposed corridor or removes one assignment on the shared page.
4. The agent re-reads the changed plan revision, commits permitted work, and advances to the next milestone or exception.
5. The agent verifies the outcome against the original constraints.

The page visibly shows the inspected region, cyan blueprints, equipment reservations, crew assignments, hatch and flight orders, walking and hauling, the pressure response, and concise before/after evidence.

### Ten-to-twelve-minute capstone

The extended demonstration adds two or three read-only subagents for base safety, crew/equipment readiness, and flight/cargo timing. The parent reconciles their findings and owns all writes. After the first resolution, the player captures the procedure as the external **Mission Controller** skill, resets to a changed seed or constraint set, and invokes it again. Successful reuse means the procedure adapts through fresh inspection; it does not replay fixed coordinates or answers.

## 23. Technical product boundaries

- Single-page web application.
- Compatible-host collaboration through WebMCP Site Tools, tested against the named challenge environment rather than presented as universal interoperability.
- Browser-local simulation and saves for the jam unless a later feature requires a backend.
- No model API key or hidden AI service inside the game.
- Seeded, deterministic simulation suitable for reset and replay.
- Shared domain commands beneath manual UI and Site Tools.
- Synchronous, bounded Site Tool calls; long game time advances through simulation steps rather than a tool waiting on real time.
- Bounded map queries and compact results to avoid overwhelming the agent context.

## 24. Principal risks

| Risk | Response |
|---|---|
| Scope exceeds the challenge window | Protect one coherent slice; cut content before cutting parity or verification |
| Map looks spatial but distance has no consequence | Require walking, hauling, access, hatch, and utility effects in the shipped slice |
| Agent tools become ordinary CRUD | Center plans on cross-system objectives, previews, constraints, stop conditions, and verification |
| Random incidents destabilize the demo | Use deterministic showcase seed and fair authored templates |
| One generic tool hides all reasoning | Use composable typed reads and domain actions; prohibit `solve_*` endpoints |
| Hundreds of tiny tools hurt discovery | Group actions by domain while preserving narrow schemas and complete parity |
| Science overwhelms play | Keep formulas in details and decisions in the primary card |
| Asteroid travel feels trivial | Preserve multi-year in-game durations and compress only uneventful simulation time |
| Agent action becomes invisible | Highlight inspected areas, staged plans, exact diffs, execution, and verification |
| Art production consumes the jam | Use modular smooth sprites, geometric modules, and a strict asset budget |

## 25. Definition of done for the vertical slice

The challenge slice is successful when:

- the action-registry test proves that every shipped gameplay inspection and mutation has both a manual entry point and a compatible Site Tool entry point, with mutations using the same command, rules, and costs;
- spatial layout, local equipment, walking, hauling, power, and pressure zones visibly affect the compound scenario;
- at least one generated situation has multiple viable responses;
- the tested compatible host can stage, survive a human plan edit, commit, advance, and verify without a hidden solver;
- the run can recover from a meaningful failure;
- the showcase seed resets deterministically and the four-to-five-minute golden path is reliable; and
- the longer capstone authentically demonstrates external subagent analysis and Mission Controller skill reuse without claiming the webpage detected either capability.

## 26. Reference basis

The design uses these sources to keep terminology and major resource chains grounded:

- [Official OpenAI Site Tools documentation](https://learn.chatgpt.com/docs/webmcp)
- [NASA: Moon Composition & Structure](https://science.nasa.gov/moon/composition/)
- [USGS: Assessment of Lunar Resource Exploration](https://pubs.usgs.gov/publication/cir1507)
- [NASA: Lunar surface and ISRU technology](https://www.nasa.gov/lunar-surface-technology/)
- [NASA NTRS: Hydrogen reduction reactor](https://ntrs.nasa.gov/citations/20110011479)
- [NASA NTRS: Molten regolith electrolysis](https://ntrs.nasa.gov/citations/20205007780)
- [NASA NTRS: Microwave-sintered lunar infrastructure](https://ntrs.nasa.gov/citations/20205010871)
- [NASA: Bennu sample contains carbon and water-bearing minerals](https://www.nasa.gov/news-release/nasas-bennu-asteroid-sample-contains-carbon-water/)
- [NASA: Psyche mission and main-belt travel](https://science.nasa.gov/mission/psyche/)
- [NASA: OSIRIS-REx mission timeline](https://science.nasa.gov/mission/osiris-rex/osiris-rex-faq/)

## 27. Remaining implementation decisions

These do not block the design direction:

- Final title and subtitle.
- Exact map dimensions and pathfinding resolution.
- Final crew skill taxonomy and numeric balance.
- Technology costs and which subset ships in the challenge slice.
- Sponsor names, authored contracts, and visual identifiers.
- Exact action grouping in the registered WebMCP catalog.
- Final sprite production pipeline and animation frame counts.
- Hosting, save export, and challenge deployment details.
