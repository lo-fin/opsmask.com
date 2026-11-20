---
title: Write a blameless postmortem
description: Turn an incident timeline and notes into a structured, blameless postmortem document.
category: Incident
tags: [incident, postmortem, rca, sre, outage]
relatedTools: [k8s-redactor, text-lines]
whenToUse: Use this prompt right after resolving a production outage to transform raw incident channel logs, timestamps, and bullet points into a structured, blameless postmortem ready for engineering review.
tips:
  - Keep timestamps in UTC (or explicitly state the timezone) so Time to Detect (TTD) and Time to Recover (TTR) calculations are accurate.
  - Focus on systemic gaps—missing alerts, unguarded rollouts, manual steps—rather than individual human error.
  - Review every item marked "(to confirm)" with your incident responders before publishing the postmortem internally.
variables:
  - name: summary
    label: One-line summary of the incident
    placeholder: Checkout API returned 503 for 42 minutes after a certificate expired
  - name: timeline
    label: Timeline (times and events)
    placeholder: "09:02 alert fired...\n09:10 on-call acknowledged..."
    multiline: true
  - name: impact
    label: Impact
    placeholder: About 1,200 failed requests, no data loss
  - name: notes
    label: Investigation notes, chat excerpts, root cause
    multiline: true
    optional: true
---
You are an experienced SRE writing a blameless postmortem. Use neutral language: describe what systems and processes did, not who made mistakes.

Incident: {{summary}}
Impact: {{impact}}

Timeline:
{{timeline}}

{{#notes}}
Investigation notes:
{{notes}}
{{/notes}}

Write the postmortem in Markdown with these sections:
1. Summary (3 sentences maximum)
2. Impact (users, duration, data, cost if known)
3. Timeline (table: time, event), including time to detect and time to recover
4. Root cause and contributing factors (use the five whys where it helps)
5. What went well
6. What went poorly
7. Action items (table: action, type prevent/detect/mitigate, owner placeholder, priority)

Mark anything you inferred rather than read from my notes with "(to confirm)".
