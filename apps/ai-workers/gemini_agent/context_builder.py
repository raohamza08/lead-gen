"""
Assembles the single large-context prompt input for Email #3 (Part D2): full
lead record + review notes + a live re-fetch of the website + the best-matching
case study. Kept as one function so the "what goes into the prompt" surface is
auditable in one place rather than scattered across the drafting code.
"""
import httpx


async def fetch_website_excerpt(website: str | None, max_chars: int = 2000) -> str:
    if not website:
        return ""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8) as client:
            resp = await client.get(website)
            text = resp.text
            # Extremely lightweight tag strip — a production build should use a
            # real HTML-to-text extractor (readability/trafilatura) instead.
            import re
            text = re.sub(r"<script[\s\S]*?</script>", " ", text)
            text = re.sub(r"<style[\s\S]*?</style>", " ", text)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"\s+", " ", text).strip()
            return text[:max_chars]
    except httpx.HTTPError:
        return ""


def build_context(lead_detail: dict, website_excerpt: str, case_study: dict | None) -> dict:
    lead = lead_detail["lead"] if "lead" in lead_detail else lead_detail
    review = lead_detail.get("reviewNote") or {}

    return {
        "company_name": lead.get("companyName"),
        "industry": lead.get("industry"),
        "employee_count": lead.get("employeeCount"),
        "country": lead.get("country"),
        "tech_stack": lead.get("techStack"),
        "reviewer_notes": {
            "website_issues": review.get("websiteIssues"),
            "business_problems": review.get("businessProblems"),
            "pain_points": review.get("painPoints"),
            "suggested_offer": review.get("suggestedOffer"),
            "suggested_hook": review.get("suggestedHook"),
            "urgency_level": review.get("urgencyLevel"),
        },
        "website_excerpt": website_excerpt,
        "case_study_title": case_study.get("title") if case_study else None,
        "case_study_metrics": case_study.get("metrics") if case_study else None,
    }
