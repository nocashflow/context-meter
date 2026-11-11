# context-meter

See how full your Claude Code context is, without leaving the chat.

context-meter is a Claude Code plugin that shows your context window, plan usage limits and session cost as a slim **band above the prompt**, a detailed **side panel**, or both. It updates after every reply and after compaction.

## What it shows

**Band** — one quiet line above the message box:

```
▬▬▬▬───────  15%  152k / 1M  · +4.2k last reply  · 5h 15%  · $3.55     Details  ✕
```

- A bar that turns amber at 70% and red at 85%, with a tick where auto-compact kicks in
- How many tokens the last reply added, so you can see what's eating your context
- Your 5-hour plan limit and the session cost

**Side panel** — the full picture:

- A ring gauge with the percentage, token count and **about how many replies are left** before compaction, based on your recent pace
- A chart of context growth over the session
- **What's using it**: a colour-coded breakdown (messages, tools, memory files, …)
- 5-hour and weekly plan limits, with reset countdowns
- Session cost

On the desktop app, VS Code and mobile it draws real graphics; in the terminal it falls back to text bars.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install context-meter --marketplace nocashflow/context-meter
```

Answer `y` to add the marketplace, then pick a scope (the user scope makes it load in every session).

From a shell:

```bash
claude plugin install context-meter --marketplace nocashflow/context-meter
```

In the Claude desktop app: click **+** next to the prompt box, then **Plugins** → **Add marketplace** with `nocashflow/context-meter`, then **Add plugin**.

## Use

| Command | What it does |
| --- | --- |
| `/context-view` | Flip between band and side panel |
| `/context-view band` | Band only |
| `/context-view pane` | Side panel only |
| `/context-view both` | Band and side panel |
| `/context-view off` | Hide everything |

You can also switch with the buttons in either view. Your choice is remembered across sessions, and closing the panel by hand falls back to the band.

## Privacy

context-meter only reads your session's own usage numbers — the same ones `/context` and `/cost` show. The breakdown is estimated locally, so it sends no extra requests. It has no file, shell or network access, never reads your messages, and stores just one thing: which view you picked.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

Load it from this folder while you work on it:

```bash
claude --plugin-dir .
```

## License

[MIT](LICENSE) © nocashflow
