---
name: blog-writer-research
description: Phase 1 escape hatch for the blog-writer skill. Use only when the information-gathering interview surfaces a specific named factual gap requiring external sourcing (a stat, date, quote attribution, citation). NOT for open-ended background research or "improve the research" — that imports the generic AI claims blog-writer exists to prevent.
---

# blog-writer-research

Targeted external research for a single named factual gap surfaced during blog-writer Phase 1.

## When to use

Only when Dylan articulates a specific question that:
1. Is a single, named factual gap (e.g., "what was the exact date of the original AutoGPT post?", "current pricing of competitor X?")
2. Can't be answered from existing source materials
3. A brief web pull would definitively close it

**NOT for:**
- Background context or "improve the research"
- Open-ended exploration
- Hunches Dylan didn't bother to look up

## Instructions

1. Restate the specific factual question being answered.
2. Use WebSearch and/or WebFetch to find a reliable, citable source.
3. Extract the answer and the citation (source name, URL, date accessed).
4. Write a short appendix entry and append it to `/workspace/group/blog-writer/<slug>/research.md`:

```
## Externally-sourced appendix

**Question:** [the specific factual gap]
**Answer:** [the finding]
**Source:** [title, URL, date accessed]
```

5. Return to the Phase 1 gate — do not advance the workflow.

## Constraints

- One question per invocation. If multiple gaps exist, surface them all in Phase 1 and invoke separately for each.
- If no reliable source is found, note that explicitly and return. Do not fabricate or infer.
- The appendix is clearly labeled as externally sourced so it's easy to audit later.
