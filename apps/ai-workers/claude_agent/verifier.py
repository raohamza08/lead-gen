"""
Deterministic verification (Part C3) — never LLM-only. A candidate only counts
as qualified once it clears the minimum bar: verified email AND (verified
website OR verified LinkedIn) AND a confirmed company name.
"""
import httpx
from config import settings


async def verify_website(url: str | None) -> bool:
    if not url:
        return False
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8) as client:
            resp = await client.get(url)
            return resp.status_code < 400 and len(resp.text) > 200
    except httpx.HTTPError:
        return False


async def verify_linkedin(url: str | None) -> bool:
    if not url or "linkedin.com" not in url:
        return False
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8) as client:
            resp = await client.head(url)
            # LinkedIn often blocks HEAD/bare requests with 999/429 even for real
            # profiles — treat "reachable, not a 404" as a pass rather than
            # requiring a clean 200, and note this is an approximation.
            return resp.status_code not in (404, 410)
    except httpx.HTTPError:
        return False


async def verify_email(email: str | None) -> bool:
    if not email or "@" not in email:
        return False
    if not settings.neverbounce_api_key:
        # DEMO MODE: syntactic check only. Real implementation calls
        # NeverBounce/ZeroBounce for an SMTP/MX-verified result (Part C3) and
        # rejects catch-all/unknown below a confidence threshold.
        domain = email.split("@")[-1]
        return "." in domain
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://api.neverbounce.com/v4/single/check",
            params={"key": settings.neverbounce_api_key, "email": email},
        )
        if resp.status_code != 200:
            return False
        result = resp.json().get("result")
        return result == "valid"


async def verify_candidate(candidate: dict) -> dict:
    website_ok = await verify_website(candidate.get("website"))
    linkedin_ok = await verify_linkedin(candidate.get("linkedinUrl"))
    email_ok = await verify_email(candidate.get("email"))

    qualifies = bool(candidate.get("companyName")) and email_ok and (website_ok or linkedin_ok)
    return {
        "verifiedWebsite": website_ok,
        "verifiedLinkedin": linkedin_ok,
        "verifiedEmail": email_ok,
        "qualifies": qualifies,
    }
