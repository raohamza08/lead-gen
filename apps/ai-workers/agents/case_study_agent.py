"""
Reviews an operator-submitted case study before it becomes usable in outreach
(Part: case studies). Standalone rather than chained into another pipeline —
nothing else in the fleet needs "review one case study", and the moment it
belongs in a bigger pipeline is easy to add later without disturbing this one.

The agent never expands on what the operator wrote — see
shared/prompts/case_study_review.txt's hard rules. It's an editor, not an
author: tightening language and picking the niche the story actually
supports, never inventing a number or claim that wasn't already there.
"""
from __future__ import annotations

import json
import logging

from claude_agent import cli_client
from shared.prompts import load_prompt

from .base import Agent, AgentContext, AgentResult, AgentStatus

logger = logging.getLogger("agents.case_study")


class CaseStudyReviewAgent(Agent):
    name = "case_study_review"
    responsibility = "Reviews a submitted case study for a real niche fit and email-ready wording, never inventing a number the operator didn't state."
    requires = ("case_study_input",)
    provides = ("case_study_result",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        submission = ctx.get("case_study_input")
        org_context = ctx.get("org_context")

        input_json = json.dumps(
            {
                "title": submission.get("title") or "(no title given)",
                "story": submission["rawStory"],
                "niche_picked_by_operator": submission["submittedIndustry"],
            },
            default=str,
        )[:6000]

        prompt = f"{load_prompt('case_study_review', org_context)}\n\nSUBMISSION\n{input_json}"

        try:
            envelope = await cli_client.query(prompt)
        except cli_client.ClaudeCliUnavailable as err:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"case_study_result": {}},
                error=str(err),
                notes=["review not generated — Claude CLI unavailable"],
            )

        data = cli_client.extract_json(envelope.get("result", "")) or {}
        if not data or "summary" not in data:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"case_study_result": {}},
                notes=["review returned unparseable output"],
            )

        return AgentResult(status=AgentStatus.OK, data={"case_study_result": data})
