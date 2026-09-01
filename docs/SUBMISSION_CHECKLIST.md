# Submission checklist

Deadline: **September 3, 2026 at 1:00 p.m. PT**. Internal target: freeze the judged build by September 2.

## Registration and compliance

- [ ] Join the challenge on Devpost.
- [ ] Confirm entrant eligibility against the official rules.
- [ ] Decide individual vs. team entry and name the representative.
- [ ] Add all teammates on Devpost.
- [x] New repository created during the submission period.
- [x] Public-source plan and MIT license selected.
- [ ] Audit all visual, audio, code, and data licenses.

## Product

- [x] Working browser-local simulation.
- [x] Non-trivial imperative WebMCP implementation.
- [x] Human-visible updates from agent tool calls.
- [x] Resettable demo scenario.
- [x] Add a scenario win/fail state and outcome comparison.
- [x] Test every tool in Codex's in-app Browser against the production build: all 12 unique tools across both phases ([test record](WEBMCP_TESTING.md#recorded-live-results)).
- [ ] Repeat in the judged ChatGPT in-app Browser if its host differs from the tested Codex Browser.
- [ ] Test in Chrome 149+ with WebMCP testing enabled.
- [ ] Complete keyboard, small-screen, and reduced-motion checks.
- [x] Handle invalid calls and supplied cancellation signals cleanly: strict runtime validation and already-aborted callback regressions pass. The live host may reject malformed input before dispatch and did not supply a cancellation signal; host-delivered cancellation remains unverified.

## Delivery

- [ ] Choose hosting and create the production deployment.
- [ ] Confirm the live URL needs no unsupported login or provide judge credentials.
- [ ] Add live URL and exact test prompts to README.
- [ ] Make the repository public and verify GitHub detects the license.
- [ ] Add repository description, homepage, and topics.
- [ ] Run `npm run lint`, `npm test`, and `npm run build` from a clean checkout.

## Devpost story

- [ ] State the real audience and problem in one sentence.
- [ ] Explain why WebMCP is essential rather than decorative.
- [ ] Show what the human and agent accomplish together.
- [ ] Briefly explain direct `document.modelContext.registerTool()` integration.
- [ ] Include clear screenshots and testing instructions.
- [ ] Avoid claiming features that are not in the submitted build.

## Demo video (public YouTube, under 3:00)

- [ ] 0:00–0:15 — colony crisis and teaching premise.
- [ ] 0:15–0:40 — ask the agent to inspect without changing anything.
- [ ] 0:40–1:20 — show structured tool use and evidence-based plan.
- [ ] 1:20–2:05 — authorize bounded assignments; shared UI changes live.
- [ ] 2:05–2:35 — advance time and verify the outcome.
- [ ] 2:35–2:50 — explain WebMCP implementation and impact.
- [ ] Audio clearly covers what was built and how WebMCP is used.
- [ ] No unlicensed music, trademarks, or other third-party material.

## Freeze

- [ ] Tag the final submission commit.
- [ ] Save final URLs and a local production-build copy.
- [ ] Submit before the deadline, not at it.
- [ ] After close, do not modify the submitted Devpost entry, repository, or live site until winners are announced.
- [ ] If continued development is needed, work in a separate fork/copy.
