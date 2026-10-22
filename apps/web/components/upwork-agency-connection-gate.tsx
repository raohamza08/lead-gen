"use client";

import Link from "next/link";
import { SectionCard } from "./chart-kit";

/** Shared return shape of GET /upwork-api/status (Part: Upwork API
 *  integration — enterprise UI shell, 2026-10-23) -- the API client's
 *  `getUpworkApiStatus` has no declared generic, so every page reading
 *  it casts through this type rather than repeating the shape inline. */
export interface UpworkConnectionStatus {
  connected: boolean;
  status?: "CONNECTED" | "EXPIRED" | "DISCONNECTED" | "ERROR";
  scope?: string;
  organizationId?: string | null;
  organizationName?: string | null;
  connectedAt?: string;
  tokenExpiresAt?: string;
  lastSyncAt?: string;
  lastSyncError?: string | null;
}

/** Shared "not connected" state for every dedicated Upwork Agency page
 *  (Part: Upwork API integration — enterprise UI shell, 2026-10-23) —
 *  extracted once used across more than a handful of pages rather than
 *  repeating the same markup in each. */
export function UpworkAgencyConnectionGate({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <SectionCard title="Not connected">
        <p className="text-sm text-ink/55">
          Connect your Upwork agency account to see real data here.{" "}
          <Link href="/settings/upwork-api" className="text-accent underline">
            Go to Connection Settings
          </Link>
          .
        </p>
      </SectionCard>
    </div>
  );
}
