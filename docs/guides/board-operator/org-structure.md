---
title: Team and Organization
summary: Team tabs, reporting hierarchy, humans, agent teams, and the Crew Board
---

AoA models work as a company, not a loose set of bots. Use **Team** to manage humans, agents, reporting lines, reusable teams, and the built-in AoA crew.

## Team Sections

The Team page has five sections:

| Section | What it is for |
|---------|----------------|
| Organization | Pan/zoom reporting chart for humans, agents, invites, and team overlays |
| Agents | List, create, inspect, terminate, or delete individual agents |
| Humans | Members, invites, roles, pending invites, and admin transfer |
| Teams | Reusable grouped agent teams and imported team packages |
| AoA Team | Built-in crew roster, crew tasks, kanban, and governance |

The legacy `/org` route redirects to `/team`.

## Organization Chart

The organization chart shows who reports to whom. It supports pan, zoom, fit-to-view, agent and human nodes, pending invites, team overlays, and node action menus.

Rules:

- The reporting graph is acyclic.
- Each agent has one manager.
- Humans and agents can both appear in the company structure.
- Cross-team work can still be assigned outside the reporting line when permissions allow it.

## Agents

The Agents tab lists all company agents. Founders can create agents, update configuration, terminate running agents, and delete agents when safe.

Agent detail pages remain the place to inspect runtime state, configuration revisions, instructions, heartbeat runs, and task sessions.

## Humans

The Humans tab shows company members, role filters, search, pending invites, Add Member, and system-admin transfer controls.

Roles remain:

- `founder`
- `team_lead`
- `team_member`

Team leads are department-scoped. Founders and instance admins have broader control.

## Teams

The Teams tab lists grouped agent teams. New teams can be built from scratch or imported from a team package.

## AoA Team and Crew Board

The AoA Team section covers the built-in crew. It has sub-tabs for roster, tasks, kanban, and governance.

The sidebar **Crew Board** shortcut opens the AoA Team task board. It is a flat board of active crew-agent tasks. Create work from Discussions, Tasks, or approved crew flows; use Crew Board to monitor and move existing crew work.
