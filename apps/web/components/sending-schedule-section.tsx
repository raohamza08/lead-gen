"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";
import { useRealtimeEvent } from "../lib/realtime";

interface SendingSchedule {
  enabled: boolean;
  frequency: "DAILY" | "ONE_TIME";
  sendTime: string;
  timezone: string;
  oneTimeDate: string | null;
  lastTriggeredAt: string | null;
}

const EMPTY: SendingSchedule = {
  enabled: false,
  frequency: "DAILY",
  sendTime: "09:00",
  timezone: "UTC",
  oneTimeDate: null,
  lastTriggeredAt: null,
};

/**
 * Settings > Lead Generation's scheduler section (Part: Preparation
 * Pipeline / Sending Queue, 2026-09-01) — the backend's real answer to
 * requirement #4: no schedule (the default) means every fully-prepared
 * email sends the moment it's ready; a schedule here holds them until the
 * configured time, wherever each one is in the 5-email sequence.
 */
export function SendingScheduleSection() {
  const [schedule, setSchedule] = useState<SendingSchedule | null>(null);
  const [nextFireAt, setNextFireAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    api
      .getSendingSchedule()
      .then((res: any) => {
        setSchedule(res.schedule ?? EMPTY);
        setNextFireAt(res.nextFireAt ?? null);
      })
      .catch((err) => setError((err as Error).message));
  }

  useEffect(load, []);
  // The scheduler's own fire (or a manual re-save elsewhere) can move
  // lastTriggeredAt/nextFireAt — reflect that live rather than requiring a
  // page reload to see the schedule actually ran.
  useRealtimeEvent("sendingSession.updated", load);

  async function save(next: SendingSchedule) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res: any = await api.updateSendingSchedule({ ...next });
      setSchedule(res.schedule);
      setNextFireAt(res.nextFireAt ?? null);
      setNotice(res.schedule.enabled ? "Schedule saved." : "Scheduling disabled — emails send as soon as they're ready.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!schedule) return null;
  const set = <K extends keyof SendingSchedule>(key: K, value: SendingSchedule[K]) =>
    setSchedule({ ...schedule, [key]: value });

  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <h2 className="mb-1 text-sm font-semibold tracking-tight">Sending Schedule</h2>
      <p className="mb-4 text-xs text-ink/50">
        Off by default: every email sends the moment it finishes preparation. Turn this on to hold
        all fully-prepared emails — across every step of the sequence — until a set time.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">
          {notice}
        </div>
      )}

      <label className="mb-4 flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={schedule.enabled}
          disabled={saving}
          onChange={(e) => save({ ...schedule, enabled: e.target.checked })}
        />
        <span>
          <span className="block text-sm font-medium text-ink">Enable scheduled sending</span>
          <span className="block text-xs text-ink/50">
            Applies uniformly to every email in the sequence, not just the first outreach.
          </span>
        </span>
      </label>

      {schedule.enabled && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-ink/60">
              <span className="mb-1 block">Frequency</span>
              <select
                className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
                value={schedule.frequency}
                disabled={saving}
                onChange={(e) => set("frequency", e.target.value as SendingSchedule["frequency"])}
              >
                <option value="DAILY">Daily</option>
                <option value="ONE_TIME">One time</option>
              </select>
            </label>
            <label className="text-xs text-ink/60">
              <span className="mb-1 block">Send time</span>
              <input
                type="time"
                className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
                value={schedule.sendTime}
                disabled={saving}
                onChange={(e) => set("sendTime", e.target.value)}
              />
            </label>
            <label className="text-xs text-ink/60">
              <span className="mb-1 block">Timezone</span>
              <input
                type="text"
                className="w-40 rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
                placeholder="e.g. America/New_York"
                value={schedule.timezone}
                disabled={saving}
                onChange={(e) => set("timezone", e.target.value)}
              />
            </label>
            {schedule.frequency === "ONE_TIME" && (
              <label className="text-xs text-ink/60">
                <span className="mb-1 block">Date</span>
                <input
                  type="date"
                  className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
                  value={schedule.oneTimeDate ?? ""}
                  disabled={saving}
                  onChange={(e) => set("oneTimeDate", e.target.value)}
                />
              </label>
            )}
          </div>
          <div>
            <button
              onClick={() => save(schedule)}
              disabled={saving}
              className="rounded-md bg-accent px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save schedule"}
            </button>
          </div>
          <div className="text-[11px] text-ink/45">
            {nextFireAt
              ? `Next run: ${new Date(nextFireAt).toLocaleString()} (estimate — the backend clock decides exactly when)`
              : "No upcoming run scheduled."}
            {schedule.lastTriggeredAt && (
              <> · Last ran {new Date(schedule.lastTriggeredAt).toLocaleString()}</>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
