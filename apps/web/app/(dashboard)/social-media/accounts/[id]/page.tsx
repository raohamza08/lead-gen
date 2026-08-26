"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../../lib/api-client";

interface Account {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
}

interface FeedItem {
  externalPostId: string;
  content: string;
  mediaUrl?: string;
  permalink?: string;
  postedAt: string;
  likeCount: number;
  commentCount: number;
  isOwnPost?: boolean;
}

interface Conversation {
  externalConversationId: string;
  participantName: string;
  participantAvatarUrl?: string;
  lastMessageSnippet?: string;
  lastMessageAt: string;
  unread: boolean;
}

interface Message {
  externalMessageId: string;
  fromUs: boolean;
  senderName: string;
  text: string;
  sentAt: string;
}

const PLATFORM_HOME: Record<string, string> = {
  LINKEDIN: "https://www.linkedin.com/",
  TIKTOK: "https://www.tiktok.com/",
  YOUTUBE: "https://www.youtube.com/",
  X: "https://x.com/",
  FACEBOOK: "https://www.facebook.com/",
  INSTAGRAM: "https://www.instagram.com/",
};

function openInNewTabUrl(account: Account): string {
  if (account.platform === "X" && account.username.startsWith("@")) {
    return `https://x.com/${account.username.slice(1)}`;
  }
  return PLATFORM_HOME[account.platform] ?? "https://www.google.com/";
}

/** Not every platform has a real feed/DM API (Part: Social Media Hub — see
 *  PlatformNotConfiguredError from the provider). Rather than branch on
 *  platform in the UI, this always attempts the real call and falls back
 *  to an honest message + a plain "open the real site" link on failure —
 *  correct automatically if a platform gains support later. */
function UnavailableFallback({ account, message }: { account: Account; message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--line)] px-6 py-10 text-center">
      <p className="text-sm text-ink/60">{message}</p>
      <a
        href={openInNewTabUrl(account)}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
      >
        Open {account.platform.charAt(0) + account.platform.slice(1).toLowerCase()} in a new tab
      </a>
    </div>
  );
}

export default function SocialAccountDetailPage() {
  const params = useParams<{ id: string }>();
  const accountId = params.id;

  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [tab, setTab] = useState<"feed" | "messages">("feed");

  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api
      .getSocialAccounts()
      .then((res) => {
        const found = (res as Account[]).find((a) => a.id === accountId);
        if (!found) setAccountError("Account not found");
        else setAccount(found);
      })
      .catch((err) => setAccountError((err as Error).message));
  }, [accountId]);

  useEffect(() => {
    if (tab !== "feed" || feed || feedError) return;
    api
      .getAccountFeed(accountId)
      .then((res) => setFeed(res as FeedItem[]))
      .catch((err) => setFeedError((err as Error).message));
  }, [tab, accountId, feed, feedError]);

  useEffect(() => {
    if (tab !== "messages" || conversations || conversationsError) return;
    api
      .getAccountConversations(accountId)
      .then((res) => setConversations(res as Conversation[]))
      .catch((err) => setConversationsError((err as Error).message));
  }, [tab, accountId, conversations, conversationsError]);

  function openConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    setMessages(null);
    setMessagesError(null);
    api
      .getConversationMessages(accountId, conversationId)
      .then((res) => setMessages(res as Message[]))
      .catch((err) => setMessagesError((err as Error).message));
  }

  async function sendReply() {
    if (!selectedConversationId || !replyText.trim()) return;
    setSending(true);
    try {
      await api.sendConversationReply(accountId, selectedConversationId, replyText.trim());
      setReplyText("");
      openConversation(selectedConversationId);
    } catch (err) {
      setMessagesError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (accountError) {
    return <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">{accountError}</div>;
  }
  if (!account) return <p className="text-sm text-ink/50">Loading…</p>;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/social-media/${account.platform.toLowerCase()}`} className="text-xs text-accent hover:underline">
          ← {account.platform.charAt(0) + account.platform.slice(1).toLowerCase()}
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">{account.displayName || account.username}</h1>
        {account.displayName && <p className="text-xs text-ink/50">{account.username}</p>}
      </div>

      <div className="flex gap-1 border-b border-[var(--line)]">
        {(["feed", "messages"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize transition-colors ${
              tab === t ? "border-b-2 border-accent font-medium text-accent" : "text-ink/60 hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "feed" &&
        (feedError ? (
          <UnavailableFallback account={account} message={feedError} />
        ) : !feed ? (
          <p className="text-sm text-ink/50">Loading…</p>
        ) : feed.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/50">No posts found on this account yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {feed.map((item) => (
              <div key={item.externalPostId} className="card flex flex-col gap-2 p-4">
                {item.mediaUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.mediaUrl} alt="" className="aspect-square w-full rounded-md object-cover" />
                )}
                <p className="line-clamp-3 text-sm">{item.content || <span className="text-ink/40">(no caption)</span>}</p>
                <div className="mt-auto flex items-center justify-between text-xs text-ink/50">
                  <span>{new Date(item.postedAt).toLocaleDateString()}</span>
                  <span>
                    ♥ {item.likeCount} · 💬 {item.commentCount}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {item.isOwnPost && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">Published here</span>}
                  {item.permalink && (
                    <a href={item.permalink} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent hover:underline">
                      View on {account.platform.toLowerCase()}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === "messages" &&
        (conversationsError ? (
          <UnavailableFallback account={account} message={conversationsError} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="flex flex-col gap-1 rounded-lg border border-[var(--line)] p-2">
              {!conversations ? (
                <p className="p-3 text-sm text-ink/50">Loading…</p>
              ) : conversations.length === 0 ? (
                <p className="p-3 text-sm text-ink/50">No conversations yet.</p>
              ) : (
                conversations.map((c) => (
                  <button
                    key={c.externalConversationId}
                    onClick={() => openConversation(c.externalConversationId)}
                    className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      selectedConversationId === c.externalConversationId ? "bg-accent/15" : "hover:bg-ink/5"
                    } ${c.unread ? "font-semibold" : ""}`}
                  >
                    <div>{c.participantName}</div>
                    {c.lastMessageSnippet && <div className="line-clamp-1 text-xs font-normal text-ink/50">{c.lastMessageSnippet}</div>}
                  </button>
                ))
              )}
            </div>

            <div className="flex min-h-[320px] flex-col rounded-lg border border-[var(--line)] p-4">
              {!selectedConversationId ? (
                <p className="m-auto text-sm text-ink/50">Select a conversation to view it.</p>
              ) : (
                <>
                  {messagesError && (
                    <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
                      {messagesError}
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
                    {!messages ? (
                      <p className="text-sm text-ink/50">Loading…</p>
                    ) : (
                      messages.map((m) => (
                        <div
                          key={m.externalMessageId}
                          className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                            m.fromUs ? "self-end bg-accent text-white" : "self-start bg-ink/8"
                          }`}
                        >
                          {m.text}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-3 flex gap-2 border-t border-[var(--line)] pt-3">
                    <input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sendReply()}
                      placeholder="Type a reply…"
                      className="flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                    />
                    <button
                      onClick={sendReply}
                      disabled={sending || !replyText.trim()}
                      className="rounded-md bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
                    >
                      {sending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}
