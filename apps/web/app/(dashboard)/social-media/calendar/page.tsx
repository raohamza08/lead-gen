"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { Spinner } from "../../../../components/spinner";

interface Post {
  id: string;
  status: string;
  scheduledAt: string | null;
  versions: { account: { platform: string; username: string; displayName: string | null } }[];
}

type CalendarView = "month" | "week" | "day";

const EMPTY_POSTS: Post[] = [];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Sunday-anchored, matching the existing month grid's weekday header. */
function startOfWeek(d: Date): Date {
  return addDays(d, -d.getDay());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const STATUS_TONE: Record<string, string> = {
  PUBLISHED: "bg-good/15 text-good",
  SCHEDULED: "bg-accent/15 text-accent",
  FAILED: "bg-bad/15 text-bad",
};

function PostChip({ post }: { post: Post }) {
  return (
    <Link
      href={`/social-media/posts?status=${post.status}`}
      className="flex flex-col gap-0.5 rounded-md border border-[var(--line)] px-1.5 py-1 text-[11px] hover:bg-ink/5"
    >
      <span className="flex items-center justify-between gap-1">
        <span className="truncate font-medium">{post.versions.map((v) => v.account.platform).join(", ") || "—"}</span>
        <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] uppercase tracking-wide ${STATUS_TONE[post.status] ?? "bg-ink/8 text-ink/50"}`}>
          {post.status}
        </span>
      </span>
      {post.scheduledAt && <span className="text-ink/40">{new Date(post.scheduledAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>}
    </Link>
  );
}

/** Content calendar (Part: Content Calendar) — month/week/day views over
 *  scheduled and published posts; drafts have no date to place on a grid
 *  yet. Month stays a density-first overview (count per day, click for
 *  detail); week/day show posts inline since there's room for it. */
export default function CalendarPage() {
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Not keyed by `cursor`/`view` -- the underlying fetch (every scheduled/
  // published post) doesn't depend on which range is showing, only the
  // client-side grouping below does, so switching views/ranges never needs
  // a refetch.
  const postsQuery = useQuery({
    queryKey: ["social-media-calendar-posts"],
    queryFn: async () => {
      const [scheduled, published] = await Promise.all([
        api.getSocialPosts({ status: "SCHEDULED", pageSize: "200" }),
        api.getSocialPosts({ status: "PUBLISHED", pageSize: "200" }),
      ]);
      const all = [...(scheduled as { posts: Post[] }).posts, ...(published as { posts: Post[] }).posts];
      return all.filter((p) => p.scheduledAt);
    },
  });
  const posts = postsQuery.data ?? EMPTY_POSTS;
  const error = postsQuery.error ? (postsQuery.error as Error).message : null;

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const post of posts) {
      const key = toDateKey(post.scheduledAt!);
      map.set(key, [...(map.get(key) ?? []), post].sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()));
    }
    return map;
  }, [posts]);

  const weeks = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: (Date | null)[] = [...Array(startOffset).fill(null)];
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);

    const result: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) result.push(cells.slice(i, i + 7));
    return result;
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const dayPosts = byDay.get(dateKeyOf(cursor)) ?? EMPTY_POSTS;
  const selectedPosts = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  function step(direction: 1 | -1) {
    setCursor((c) => {
      if (view === "month") return new Date(c.getFullYear(), c.getMonth() + direction, 1);
      if (view === "week") return addDays(c, direction * 7);
      return addDays(c, direction);
    });
  }

  const headerLabel =
    view === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "week"
        ? `${weekDays[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
        : cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Calendar</h1>
            {postsQuery.isFetching && !postsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
          </div>
          <p className="mt-0.5 text-xs text-ink/50">Scheduled and published posts, by day.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-[var(--line)] p-0.5 text-xs">
            {(["month", "week", "day"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded px-2.5 py-1 capitalize transition-colors ${view === v ? "bg-accent text-white" : "text-ink/60 hover:bg-ink/5"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => step(-1)} className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs hover:bg-ink/5">
            ← Prev
          </button>
          <button onClick={() => setCursor(new Date())} className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs hover:bg-ink/5">
            Today
          </button>
          <button onClick={() => step(1)} className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs hover:bg-ink/5">
            Next →
          </button>
          <span className="min-w-[10rem] text-sm font-medium">{headerLabel}</span>
          <Link href="/social-media/create" className="ml-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
            + New Post
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {view === "month" && (
        <div className="overflow-hidden rounded-xl border border-[var(--line)]">
          <div className="grid grid-cols-7 border-b border-[var(--line)] bg-ink/5 text-center text-[10px] uppercase tracking-wide text-ink/50">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="py-1.5">{d}</div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7">
              {week.map((day, di) => {
                const key = day ? dateKeyOf(day) : `empty-${wi}-${di}`;
                const cellPosts = day ? byDay.get(key) ?? [] : [];
                return (
                  <button
                    key={key}
                    disabled={!day}
                    onClick={() => day && setSelectedDay(key)}
                    className={`min-h-[70px] border-b border-r border-[var(--line)] p-1.5 text-left align-top last:border-r-0 ${
                      day ? "hover:bg-ink/5" : "bg-ink/[0.02]"
                    } ${selectedDay === key ? "bg-accent/10" : ""}`}
                  >
                    {day && <div className="text-xs text-ink/50">{day.getDate()}</div>}
                    {cellPosts.length > 0 && (
                      <div className="mt-1 rounded bg-accent/15 px-1 py-0.5 text-[10px] text-accent">{cellPosts.length} post{cellPosts.length > 1 ? "s" : ""}</div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {view === "week" && (
        <div className="overflow-hidden rounded-xl border border-[var(--line)]">
          <div className="grid grid-cols-7 border-b border-[var(--line)] bg-ink/5 text-center text-[10px] uppercase tracking-wide text-ink/50">
            {weekDays.map((d) => (
              <div key={dateKeyOf(d)} className={`py-1.5 ${isSameDay(d, new Date()) ? "text-accent" : ""}`}>
                {WEEKDAY_LABELS[d.getDay()]} {d.getDate()}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {weekDays.map((d) => {
              const key = dateKeyOf(d);
              const cellPosts = byDay.get(key) ?? [];
              return (
                <div key={key} className="flex min-h-[220px] flex-col gap-1 border-r border-[var(--line)] p-1.5 last:border-r-0">
                  {cellPosts.map((p) => <PostChip key={p.id} post={p} />)}
                  {cellPosts.length === 0 && <span className="mt-2 text-center text-[11px] text-ink/30">—</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "day" && (
        <div className="card flex flex-col gap-2 p-4">
          {dayPosts.map((p) => (
            <div key={p.id} className="max-w-md">
              <PostChip post={p} />
            </div>
          ))}
          {dayPosts.length === 0 && <p className="text-sm text-ink/50">Nothing scheduled this day.</p>}
        </div>
      )}

      {view === "month" && selectedDay && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold">{new Date(selectedPosts[0]?.scheduledAt ?? "").toLocaleDateString() || "Selected day"}</h2>
          <div className="mt-2 flex max-w-md flex-col gap-2">
            {selectedPosts.map((p) => <PostChip key={p.id} post={p} />)}
            {selectedPosts.length === 0 && <p className="text-sm text-ink/50">Nothing scheduled this day.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
