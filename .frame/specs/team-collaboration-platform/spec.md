# Team collaboration platform — agent-first small-team mode

## Vision

Frame's next direction: stay an agent-first dev platform, but enable
3-4 person teams to coordinate work — task assignment, shared docs,
presence — without the Jira-bloat (sprints, RBAC, custom workflows,
comment threads, multi-level hierarchies).

The bet: small teams + agents is the dominant unit of software work
going forward. Building a "lightweight Jira" is a graveyard; differentiation
must come from agent-native team coordination, not better task fields.

## Architecture decision — single codebase, not a fork

Earlier intuition was to fork Frame into "Frame Enterprise". Rejected.

Going forward instead with the **Cal.com / PostHog / Supabase model**:

- **Frame app** — open source (MIT), free, desktop. Same binary whether
  solo or team; "team mode" is a runtime feature triggered by connecting
  to a Frame Server.
- **Frame Server / Frame Cloud** — proprietary, hosted SaaS. Holds
  presence, auth, assignment notifications. Source of truth still in git.
- **Frame Server Community Edition** — open core, self-host. Lacks cloud-
  only features (SSO, audit log, SCIM) by design.

Why not fork:
- Two codebases drift; 1-2 person team can't maintain both
- Team features are additive, not a different app
- Open source story stays clean (no "feature gated OSS" perception)
- Server is where value and pricing live — fork would be over-investment

Revisit the fork question in 6 months once the product shape is clearer.

## Scope boundaries (non-goals)

- No sprints, RBAC roles, multi-level hierarchy
- No native task comments — PR review already handles discussion
- No custom fields, tag management, multi-status workflows
- No push notifications in v1 — "what's new since last open" is enough
- No 50+ person team support — explicit upper bound

## Headline feature — human + agent on one dashboard

The "What's happening now" view nobody else can build:

```
Berkay              · T3 · branch feat/auth         · active
Berkay's Claude     · T4 · wrote 3 files 2m ago     · running
Me                  · T5 · idle 8m                  · paused
```

Linear, Jira, GitHub Projects know nothing about agents. Frame already
talks to them — surfacing agent activity as a first-class participant
in the team view is the wedge.

## Data architecture

- **Source of truth in git.** tasks.json, .frame/specs/, AGENTS.md —
  versioned, mergeable, portable. Consistent with existing files-over-
  databases principle.
- **Frame Server holds ephemeral state.** Online presence, agent activity,
  assignment events, real-time notifications. Server outage doesn't lose
  data because the canonical record is in git.
- **Self-host parity expectations.** Cloud-only features (SSO, audit
  log, SCIM) stay cloud-only. Self-host gets the core. Be transparent
  about this — don't promise feature parity.
- **Auth abstraction from day one.** GitHub OAuth, Google, generic OIDC.
  Adding providers later is painful; structure for it now.

## Open questions

1. **Pricing model.** Per-seat ($8/user like Linear) vs flat-rate
   ($30/team, 5 seats included). Small teams convert better on flat-rate
   — less psychological friction at 3-person scale. Worth testing both.

2. **License.** Frame app stays MIT. Server can be BSL (Sentry pattern:
   BSL with 2-year fall-back to Apache) to block rebrand-and-resell while
   keeping community goodwill. Pure-proprietary is also an option.

3. **Web client.** Team work needs a browser path ("join via link" flow).
   The existing roadmap item — Frame Server via WebSocket transport for
   web — is the same project as team mode. Don't treat them as separate.

## First concrete step

Build Frame Server MVP — auth + a single existing IPC channel ported to
WebSocket — to validate the server-mode architecture before committing
to the full team feature set. 3-5 friendly early-access teams to test
pricing willingness and dashboard usability.
