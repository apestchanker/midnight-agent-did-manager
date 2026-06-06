# Problem-Statement Worksheets & Tools: Agentic-DIDs

Reusable, blank versions of the tools used to produce `problem-statement-agentic-dids.md`. Drop these into Notion/Docs and re-run them whenever a new interview, segment, or candidate problem comes in. Method source: `problem_solution_resource_pack.pdf` (Week 2). Companion to the Week 1 instruments (`customer-interview-guide-agentic-dids.md`, `customer-discovery-log-agentic-dids.csv`).

How these fit the week:

1. **Problem-statement skeleton** — write the crude draft (§01).
2. **5 Whys worksheet** — push the draft from symptom to root cause (§02).
3. **Worth-solving quick test** — decide if it's worth pursuing (§03).
4. **Privacy-framing check** — confirm the privacy angle is load-bearing (§04).
5. **HMW seed** — turn the validated problem into solution questions (§05), the bridge to the solution overview.

---

## 1. Problem-Statement Skeleton (one page)

Fill every row. If any is blank, the statement isn't done. The verb in **Pain** matters — keep it ("prove", "trust", "verify"), not "store/configure".

| Field | Prompt | Your answer |
| --- | --- | --- |
| **Who** | The specific user/role/segment — not "people". | |
| **Situation** | When and where the pain occurs. What triggers it? | |
| **Pain** | What they try to do and fail at. Keep the verb. | |
| **Evidence** | Data, interviews, behaviours. Quote at least one real user. | |
| **Gap** | Why current alternatives don't close it. Be honest about workarounds. | |
| **Privacy framing** | What data, disclosure, or trust is at the centre? | |

**Posture reminder:** a good problem statement is short, falsifiable, and a little embarrassing to write. If your draft sounds smooth, you're describing a category, not a problem. Rewrite it until it reads like a complaint with evidence attached.

**Done-check (all five must be present):** Who · Situation · Pain · Evidence · Gap. Privacy framing is the sixth for this track.

---

## 2. 5 Whys Worksheet

Ask "why" five times from the surface complaint. Stop early only if you hit a belief/behaviour that, if changed, removes the surface pain.

| Level | Statement |
| --- | --- |
| **Surface pain** | _The first thing the user complained about._ |
| **Why? — 1** | |
| **Why? — 2** | |
| **Why? — 3** | |
| **Why? — 4** | |
| **Why? — 5 (root)** | _If addressed, does the surface pain go away?_ |

**Diagnostic rule (which level are you at?):**

| If the statement describes… | You are at… | Action |
| --- | --- | --- |
| A missing **feature** ("users can't filter by X") | Symptom | Keep going. |
| A missing **outcome** ("users can't trust the data they receive") | Closer | Keep going one more level. |
| A missing **belief or behaviour** ("users assume their data will leak, so they self-censor") | Likely root | Stop. Build the problem statement here. |

Run this after every interview. If two interviews bottom out at different roots, you have two problems — split them.

---

## 3. Worth-Solving Quick Test

Four yes/no checks. If three of four are weak, reframe the problem or move on.

| # | Test | Yes / Partial / No | Evidence |
| --- | --- | --- | --- |
| 1 | Can you name three real people who felt this pain in the last 30 days? | | |
| 2 | Do they currently spend time or money on a workaround? | | |
| 3 | Is the underlying behaviour growing? | | |
| 4 | Does a 10% better solution change their day noticeably? | | |

**Sizing (bottom-up, defensible at pre-seed — don't take it from a report):**

| Driver | Estimate | How you got it |
| --- | --- | --- |
| How many users in the target slice? | | |
| How often does the pain event occur? | | |
| What does one painful event cost (time/money/risk)? | | |
| What would they pay or save with a 10%-better fix? | | |

**Verdict:** ___ / 4 strong → (pursue this slice / reframe / drop). Name the weak tests and the interview that will close them.

---

## 4. Privacy-Framing Check

Restate the problem in this template. Every bracket must be fillable, or the privacy angle isn't load-bearing — sharpen it or drop the privacy claim.

> **[User]** wants to **[do X / prove Y / receive Z]** without **[disclosing W to party V]**, because the current trade-off **[forces over-disclosure / blocks the action / creates regulatory or reputational risk]**.

Then map pain to primitive (only the rows that apply):

| User pain (in their words) | Privacy primitive it invokes | Notes |
| --- | --- | --- |
| | Selective disclosure / ZK proof of a claim | |
| | Status / revocation proof against commitment state | |
| | Data minimisation (anchor commitments, not payloads) | |
| | MPC / federated computation ("learn from data you can't see") | |
| | Differential privacy (aggregate without exposing individuals) | |

**Load-bearing check:** if you can fill the restatement *and* at least one primitive maps cleanly to a stated pain, the privacy angle is real. If you're reaching for the primitive before the pain, drop it.

> Implementation note: primitives here are product-framing language. Any concrete Compact/Midnight technical claim (what a circuit proves, what goes on-chain, disclosure rules) must be verified separately before it enters a technical spec — do not promote framing language to an implementation guarantee.

---

## 5. HMW Seed (bridge to the solution overview)

Once the problem survives §§1–4, generate 10–20 "How might we…?" questions, then cluster and pick the abstraction altitude that's neither too narrow ("how might we add a status field") nor too vague ("how might we build trust"). These feed directly into the solution overview and the solution-side of the Problem–Solution Canvas.

| # | How might we… | Altitude (narrow / right / vague) |
| --- | --- | --- |
| 1 | | |
| 2 | | |
| 3 | | |
| … | | |

Then convert the best cluster into a falsifiable hypothesis (resource pack §05):

> We believe that **[a solution with these capabilities]**
> will result in **[this measurable outcome]**
> for **[this specific user segment]**
> because **[this underlying assumption about behaviour or pain]**.
> We'll know we're right when **[this observable signal]** reaches **[this threshold]**.

If you can't fill the last line, the hypothesis isn't testable yet — it isn't ready for the solution overview.

---

## How to use these across the week

1. Draft the skeleton (§1) crude and fast.
2. Run 5 Whys (§2) on it; if you're solving a symptom, rewrite the skeleton.
3. Score worth-solving (§3); if it's weak, reframe or drop before investing more.
4. Apply the privacy-framing check (§4); keep the privacy claim only if it's load-bearing.
5. Seed HMWs and the hypothesis (§5); carry them into the solution overview.
6. Tag every answer back to an interview ID in `customer-discovery-log-agentic-dids.csv` so the problem statement stays evidence-bound, not opinion-bound.
