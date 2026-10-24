-- Part: Upwork -> ClickUp card automation, Meeting status, 2026-10-24
-- (explicit user request: add a "Meeting" option to the Bidding/Invite
-- status dropdown that creates a ClickUp card the same way WON/TEST_TASK
-- already do, routed to the list's real "meeting" status).
ALTER TYPE "UpworkProposalStatus" ADD VALUE 'MEETING' AFTER 'TEST_TASK';
