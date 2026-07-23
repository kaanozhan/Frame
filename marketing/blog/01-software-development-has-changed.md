---
title: Software development has changed. Your tools haven't.
subtitle: A field note from the other side of the paradigm shift.
slug: software-development-has-changed
author: Kaan Özhan
status: DRAFT — for Kaan to review and adjust to his voice before publishing
estimated_reading_time: 8 minutes
target_publication: frame.cool/blog (or Substack if that's where the newsletter ends up)
purpose: Founder manifesto. Sets the worldview. Twitter thread derives from this.
---

# Software development has changed. Your tools haven't.

I noticed something a while back.

I haven't opened Jira in over a year. I'm running three projects in parallel. Some days I solve problems and ship features that, measured against how I used to work, would have been two months of work.

This isn't a productivity post. It's a confession that something underneath has changed, and most of the industry hasn't caught up to it.

I'm going to try to name what changed. And then I'm going to argue that nearly every tool we still use — the IDEs, the project trackers, the wikis, the kanban boards — was designed for a world that has quietly ended in the last 18 months.

---

## The shape of work I used to do

Two years ago, my workflow looked like this. Probably yours did too.

I'd open an issue in a tracker. I'd read the spec, or write one. I'd switch to the IDE. I'd write code. I'd commit. I'd open a PR. Somebody (or I) would review it. We'd merge. The tracker would update. The wiki, if anyone still maintained it, would slip a little further behind reality.

The smallest meaningful unit of work was a function or a small PR. The day's accomplishment, on a good day, was a handful of these. The tools were shaped around this rhythm. Jira was a tracker for many small things because we shipped many small things. The IDE was the center of gravity because most of the day was spent inside it. Confluence existed because the work outpaced our ability to write it down, so we built a parallel surface for documentation that no agent ever read.

That was the paradigm. It worked. We accepted it as the shape of the work.

## What it looks like now

I'm running three projects in parallel. On a normal day I move between them — review a diff in one, scope a feature in another, ship a fix in the third. The work itself happens in agents. I describe what I want, the agent breaks it into tasks, the agent writes the code, the agent tells me what it actually shipped and what it changed from the plan. I read everything. I edit some. I reject a few. But I'm not the author in the way I used to be.

Some days I look back at what closed — a feature here, a bug there, a refactor in the third project — and I realize that, measured against how I used to work two years ago, this was maybe two months of work. Now it's a Tuesday.

The unit of work is no longer "function." It's "spec → outcome." A complete cycle takes thirty minutes to a few hours. A solo dev or a small team running this way ships what would have required a 20-person org two years ago.

The shape of the work has changed.

## Why the tools feel wrong now

Here's the part most people sense but can't quite name.

When you've crossed into this new way of working, your old tools start to feel mis-shaped. Not bad — *mis-shaped*. They're solving the right problem for a paradigm that ended.

Jira wants you to estimate story points for tasks that take 45 minutes. The estimation theatre that made sense for two-week sprints is friction now — by the time you've groomed the backlog, you could have shipped the thing.

Cursor (and JetBrains, and VS Code-as-an-IDE) optimizes for the human typing in the editor. But you don't type much anymore. You orchestrate. The editor as the center of gravity assumes a workflow where the editor was where work happened. For more and more people, that's no longer true.

Confluence assumes someone will keep the wiki current. Nobody does, because nobody can — the rate of change outpaces the rate of human documentation. Worse, no agent reads Confluence. So the documentation isn't even feeding the system that's now doing the work.

These tools aren't bad products. They're correct answers to last paradigm's questions.

## "AI features" are not the answer

The vendor response to all of this has been to add AI features. Cursor added tab completion. JetBrains added an assistant pane. Jira added an AI to summarize tickets. GitHub added Copilot Workspaces.

None of this changes the shape of the tool. The IDE is still designed for a human typing. The tracker is still designed for many small estimated tickets. The wiki is still designed for humans to maintain.

You can sprinkle AI on a product that was designed for a human-centric workflow. You will get an incrementally improved version of the wrong product. The architecture predates the paradigm shift; bolting on an assistant doesn't relocate the center of gravity.

Most of what gets called "AI dev tooling" in 2026 is, structurally, a 2022 product with a chat panel glued on.

## The inversion: built for agents, observed by humans

I've come to believe the actual question isn't "how do we add AI to dev tools." It's: *what does a tool look like if you build it with the assumption that agents are the primary user?*

Almost every existing tool is the inverse of this. The human is the primary user; AI is an assistant the human can summon. The surface is optimized for the human. The artifacts are optimized for human consumption.

But if agents are doing most of the actual work — writing the code, navigating the codebase, executing tasks — then the surface should be optimized for *them*. Context structures the agent can read at boot. Module maps the agent can use to navigate without re-grepping. Decision logs the agent can reference instead of re-asking. Spec workflows the agent can step through autonomously.

The human still matters. The human decides what to build, when to ship, when to course-correct. The human reads the outputs, approves the merges, holds the taste. But the *primary surface* — the place the platform's design effort goes — should be the agent's, not the human's.

Built for agents, observed by humans.

This is the inversion most tools haven't made. And it's a hard inversion to make from inside an existing product, because your existing users are humans who depend on the existing human-first surface. Pivoting to agent-first means making the product worse for the people who currently pay you.

So existing tools can't really make this move. New tools have to.

## What it looks like in practice

I'm going to make this concrete because manifestos without evidence are theology.

In the workflow I described above, the platform I use is built around files, not databases. Specifically:

- A markdown file at the project root that the agent reads on boot. It contains the project's rules, conventions, and decisions. This is the agent's onboarding doc — not the human's. Humans can read it too, but it wasn't written for them.
- A structure file that maps concepts to file paths. When the agent needs to find "where the authentication code lives," it doesn't grep — it looks up. The cost of "where is X" drops to zero.
- A spec workflow with four files per feature: what we're building, how we'll build it, the broken-down tasks, and — critically — what actually shipped. That last file is written by the agent after each task, while its memory is fresh. Plans are intent. Code is reality. The file in between is the story.
- A tasks file synced to disk, version-controlled, agent-readable. Not a database with an API. A markdown file with structure. If the platform disappeared tomorrow, the artifacts still work.

All of this is portable. All of it is git-versioned. All of it is markdown. None of it requires a proprietary database or a vendor's cloud.

The human surface — the panels, the kanban, the spec dashboards — exists as a viewport into these files. It's a good viewport. But it's a *secondary* surface. The primary surface, the one the platform is actually optimized for, is what the agents see.

This is what "built for agents, observed by humans" looks like when you implement it.

## Roles are merging too

There's a corollary to the paradigm shift that I want to flag because it changes who the tools should serve.

In the old paradigm, "PM" and "engineer" were distinct roles because one person couldn't do both well. The PM wrote specs and managed scope; the engineer wrote code and managed implementation. The tools reflected this split — Jira for PMs, IDE for engineers, Confluence for the docs nobody read.

In the new paradigm, a single person — with reasonable taste and reasonable technical fluency — can do both. A PM with some technical chops can ship code now. An engineer with some product sense can write the specs. The distinction that justified separate tool stacks doesn't survive when productivity per person is 100×.

I see this in small teams everywhere. Three or four people running the work of what used to be twenty. The roles don't fit anymore. Neither do the tool stacks designed around the old roles.

The platform for these merged-role teams looks different from a platform for a 50-engineer org with a PM, an EM, a TPM, and a tooling team. The platform for the merged role is integrated, agent-first, low-ceremony. There's no need for multi-week sprint planning when the work runs in hour-long cycles. There's no need for a separate wiki when the spec files *are* the wiki.

This is the team Frame is built for. And it's the team that's growing fastest right now, even if the tooling industry hasn't caught up.

## Where this goes

A few predictions, calibrated to my own conviction level:

The next 12-18 months of dev tooling will sort into two categories: products that accepted the paradigm shift and rebuilt accordingly, and products that bolted AI onto pre-shift architectures. The former will look weird at first — terminal-centric, file-canonical, agent-first surfaces — and they'll be small. The latter will look familiar and they'll be big, but they'll be solving the wrong problem with increasing sophistication.

Consolidation will happen, but not the way most people predict. The big players won't all win. Some of them — the ones whose product DNA is most tied to the human-first paradigm — will struggle, because they can't make the inversion without alienating their existing audience. The indie tools that started agent-first will compound.

The category name for the post-paradigm dev platform doesn't exist yet. People are reaching for it with phrases like "agentic IDE" or "AI-native dev." Neither quite gets there. The phrase that wins will probably be coined by someone shipping in this space — not by a category analyst.

And: the people who have already crossed will find each other. The new paradigm has a distinct posture. You can spot it in a tweet. You can spot it in a Twitter bio. You can spot it in someone's response to a Jira ticket. The community is small and it's vocal and it's growing.

## What I'm building

I want to be honest about my position. I'm building a platform called Frame that tries to embody everything in this post.

Frame is terminal-first. Frame puts agents (Claude Code, Codex, Gemini) at the center and the human surface around them. Frame replaces the project tracker, the spec docs, the structure docs, the decision log, and the way you orchestrate AI tools — with one integrated platform and a directory of markdown files that any AI tool can read.

Frame is open source. The artifacts are portable. If Frame disappeared, your project would still work in any AI tool, because the files are the canonical thing — not a Frame database.

I'm building it because I needed it. I crossed the paradigm shift a while back and the friction with my old tools got physical. Now I'm trying to give the same thing to the people who are crossing now.

frame.cool, if you want to look.

But that's not really the point of this post. The point is the worldview underneath. Frame is just my attempt at giving the worldview a working surface. There will be others. Some of them will be better. What matters is that the inversion happens — that we stop pretending the old tools just need an AI sidebar and start building for what the work actually is now.

---

## Closing line

If you're reading this and recognizing yourself in it — if you've been quietly wondering why your modern AI-augmented setup still feels mis-shaped — you're not alone. You crossed something. There's a small group of us on the other side. The tools are coming.

---

## Editor's notes (resolved 2026-05-20)

- Anecdotes confirmed real (1+ year off Jira, 3 projects in parallel, "a day's work = 2 months' worth in the old paradigm"). Opening + "What it looks like now" updated with Kaan's actual numbers.
- Title kept: "Software development has changed. Your tools haven't."
- Length: ~2,000 words, manifesto-appropriate.
- Frame mentions: light, end-of-post placement. Calibrated for publishing on frame.cool/blog (audience already knows what Frame is).

Twitter thread derivation plan (after blog goes live):
- Thread opener: "I haven't opened Jira in over a year. I run three projects in parallel. Some days I ship what used to be two months of work."
- Tweet 2: the paradigm shift framing — old shape (function/PR) vs new shape (spec → outcome)
- Tweet 3: "Most dev tools are 2022 products with a chat panel glued on."
- Tweet 4: the inversion — "Built for agents, observed by humans."
- Tweet 5: what it looks like in practice (AGENTS.md + spec workflow compressed to one tweet)
- Tweet 6: a prediction about where this goes
- Tweet 7: link to the blog post + frame.cool

Punchy version of the manifesto, pinned tweet material.
