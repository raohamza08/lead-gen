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

const EMPTY_POSTS: Post[] = [];

function toDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Content calendar, month view (Part: Content Calendar). Scheduled and
 *  published posts only — drafts have no date to place on a grid yet. */
export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Not keyed by `cursor` -- the underlying fetch (every scheduled/published
  // post) doesn't depend on which month is showing, only the client-side
  // grouping below does, so switching months never needs a refetch.
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
      map.set(key, [...(map.get(key) ?? []), post]);
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

  const selectedPosts = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Calendar</h1>
            {postsQuery.isFetching && !postsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
          </div>
          <p className="mt-0.5 text-xs text-ink/50">Scheduled and published posts, by day.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs hover:bg-ink/5"
          >
            ← Prev
          </button>
          <span className="text-sm font-medium">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs hover:bg-ink/5"
          >
            Next →
          </button>
          <Link href="/social-media/create" className="ml-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
            + New Post
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-[var(--line)]">
        <div className="grid grid-cols-7 border-b border-[var(--line)] bg-ink/5 text-center text-[10px] uppercase tracking-wide text-ink/50">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-1.5">{d}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((day, di) => {
              const key = day ? `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}` : `empty-${wi}-${di}`;
              const dayPosts = day ? byDay.get(key) ?? [] : [];
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
                  {dayPosts.length > 0 && (
                    <div className="mt-1 rounded bg-accent/15 px-1 py-0.5 text-[10px] text-accent">{dayPosts.length} post{dayPosts.length > 1 ? "s" : ""}</div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selectedDay && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold">{new Date(selectedPosts[0]?.scheduledAt ?? "").toLocaleDateString() || "Selected day"}</h2>
          <div className="mt-2 flex flex-col gap-2">
            {selectedPosts.map((p) => (
              <Link key={p.id} href={`/social-media/posts?status=${p.status}`} className="flex items-center justify-between rounded-lg border border-[var(--line)] p-2 text-sm hover:bg-ink/5">
                <span>{p.versions.map((v) => v.account.platform).join(", ")}</span>
                <span className="text-xs text-ink/50">{new Date(p.scheduledAt!).toLocaleTimeString()} — {p.status}</span>
              </Link>
            ))}
            {selectedPosts.length === 0 && <p className="text-sm text-ink/50">Nothing scheduled this day.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
