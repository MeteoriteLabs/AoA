---
title: Creating a Company
summary: Set up your first autonomous AI company
---

A company is the top-level unit in AoA. Everything - agents, tasks, goals, budgets - lives under a company.

> **Naming note:** The top-level executive agent is called the "Director" throughout the AoA UI. The underlying DB value is `agents.role = "ceo"`, preserved for backward compatibility with bundles created prior to the AoA rebrand.

## Step 1: Create the Company

In the web UI, click "New Company" and provide:

- **Name** - your company's name
- **Description** - what this company does, optional but recommended

## Step 2: Set an Objective

Every company needs a goal: the north star that all work traces back to. Good goals are specific and measurable:

- "Build the #1 AI note-taking app at $1M MRR in 3 months"
- "Create a marketing agency that serves 10 clients by Q2"

Go to Objectives and create your top-level company goal.

## Step 3: Create the Director Agent

The Director is the first agent you create. Choose an adapter type and configure:

- **Name** - for example, "Director"
- **Role** - `ceo` in the database, displayed as "Director"
- **Adapter** - how the agent runs, such as Claude Local, Codex Local, OpenClaw, Cursor, OpenCode, Gemini, Hermes, process, or HTTP
- **Prompt template** - instructions for what the Director does on each heartbeat
- **Budget** - monthly spend limit in cents

The Director's prompt should instruct it to review company health, set strategy, and delegate work to reports.

## Step 4: Build the Team

From the Director, create direct reports:

- **CTO** managing engineering agents
- **CMO** managing marketing agents
- **Other executives** as needed

Each agent gets their own adapter config, role, and budget. The team tree enforces a strict hierarchy: every agent reports to exactly one manager.

## Step 5: Set Budgets

Set monthly budgets at both the company and per-agent level. AoA enforces:

- **Soft alert** at 80% utilization
- **Hard stop** at 100%; agents are auto-paused

## Step 6: Launch

Enable heartbeats for your agents and they will start working. Monitor progress from Home.
