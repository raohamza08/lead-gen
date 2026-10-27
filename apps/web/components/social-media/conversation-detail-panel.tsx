"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, resolveMediaUrl } from "../../lib/api-client";
import { Avatar } from "../ui/avatar";
import { LoadingRow, Spinner } from "../spinner";

interface SocialMessageItem {
  id: string;
  fromUs: boolean;
  senderName: string | null;
  messageText: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  sentAt: string;
}

interface SocialNoteItem {
  id: string;
  note: string;
  createdAt: string;
  user: { id: string; name: string };
}

interface ConversationDetail {
  id: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  assignedToUserId: string | null;
  socialAccount: { id: string; platform: string; username: string; displayName: string | null };
  contactName: string | null;
  contactUsername: string | null;
  contactProfileImageUrl?: string | null;
  messages: SocialMessageItem[];
  notes: SocialNoteItem[];
}

interface TeamUser {
  id: string;
  name: string;
}

interface Capabilities {
  dms: boolean;
  notes: string;
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Whether two consecutive messages should render as one visual group —
 *  same sender side, within 2 minutes of each other (Part: Social Inbox
 *  removal / WhatsApp-Web-style redesign, 2026-10-21) — collapses the
 *  repeated timestamp/spacing a rapid back-and-forth would otherwise show
 *  on every single bubble, same convention WhatsApp Web itself uses. */
function groupsWithPrev(prev: SocialMessageItem | undefined, cur: SocialMessageItem): boolean {
  if (!prev || prev.fromUs !== cur.fromUs) return false;
  return Math.abs(new Date(cur.sentAt).getTime() - new Date(prev.sentAt).getTime()) < 2 * 60 * 1000;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" stroke="none">
      <path d="M3 20.5v-17l19 8.5-19 8.5zm2.4-3.1 12.1-5.4-12.1-5.4v3.8l7.5 1.6-7.5 1.6v3.8z" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <path
        d="M19.5 10.5 12 18a4 4 0 0 1-5.7-5.6l8-8a2.8 2.8 0 0 1 4 4l-7.9 7.9a1.6 1.6 0 0 1-2.2-2.3L15 7.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 3v12m0 0-4-4m4 4 4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="m3 8.5 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmojiIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 10.5h.01M15.5 10.5h.01" strokeLinecap="round" />
      <path d="M8 14.5s1.3 2 4 2 4-2 4-2" strokeLinecap="round" />
    </svg>
  );
}

const QUICK_EMOJIS = [
  "😀", "😂", "😍", "🙏", "👍", "👏", "🔥", "🎉",
  "❤️", "😢", "😅", "🤔", "😎", "💯", "✅", "👋",
  "🙌", "😭", "🥳", "😡", "🤝", "⚡", "💡", "😁",
];

/**
 * Minimal emoji inserter for the composer (Part: WhatsApp module UI
 * redesign, 2026-10-27, explicit user request following a reference
 * screenshot showing an emoji icon next to the composer's send button). A
 * small fixed grid rather than a full picker library — no search/categories/
 * skin-tone variants — kept deliberately small since the ask was visual
 * parity with the reference, not a complete emoji-picker feature.
 */
function EmojiPickerButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Emoji"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink/55 hover:bg-ink/[0.05]"
      >
        <EmojiIcon />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-12 left-0 z-20 grid w-56 grid-cols-6 gap-1 rounded-lg border border-[var(--line)] bg-surface-elevated p-2 shadow-lg">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onPick(emoji);
                  setOpen(false);
                }}
                className="rounded p-1 text-lg hover:bg-ink/10"
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Full-screen in-page viewer (Part: attachment lightbox fix, 2026-10-27,
 * explicit user request — "it should not go to the next tab, it should
 * work in the same tab") — a message's image/video/doc opens here instead
 * of a new browser tab. Image and video render directly; a PDF gets an
 * iframe (the one doc type every browser can preview natively without a
 * plugin); everything else just offers Download since there's no sane
 * in-browser preview for e.g. .docx/.xlsx/.zip.
 */
function MediaLightbox({ url, downloadUrl, mimeType, filename, onClose }: { url: string; downloadUrl: string; mimeType: string | null; filename: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4" onClick={onClose}>
      <button type="button" onClick={onClose} className="absolute right-4 top-4 text-white/80 hover:text-white" aria-label="Close">
        <CloseIcon />
      </button>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] max-w-[90vw] flex-col items-center gap-3">
        {mimeType?.startsWith("image/") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={filename} className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain" />
        )}
        {mimeType?.startsWith("video/") && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={url} controls autoPlay className="max-h-[80vh] max-w-[90vw] rounded-lg" />
        )}
        {mimeType === "application/pdf" && <iframe src={url} title={filename} className="h-[80vh] w-[90vw] max-w-3xl rounded-lg bg-white" />}
        {!mimeType?.startsWith("image/") && !mimeType?.startsWith("video/") && mimeType !== "application/pdf" && (
          <div className="flex h-[40vh] w-[90vw] max-w-sm flex-col items-center justify-center gap-3 rounded-lg bg-surface-elevated p-6 text-center text-ink">
            <FileIcon />
            <div className="truncate text-sm font-medium">{filename}</div>
            <p className="text-xs text-ink/50">No in-browser preview for this file type.</p>
          </div>
        )}
        <a href={downloadUrl} download className="flex items-center justify-center gap-1 text-xs text-white/80 hover:text-white">
          <DownloadIcon /> Download
        </a>
      </div>
    </div>
  );
}

/**
 * Renders a message's attachment — inline preview for images/video (what
 * WhatsApp itself does), a filename chip for everything else (documents,
 * audio), tap-to-enlarge via MediaLightbox (same tab, no navigation), and
 * an explicit Download action on every kind (Part: WhatsApp attachment
 * view/download, 2026-10-26, explicit user request — "add an option to
 * view and download any kind of document, image or video"; same-tab
 * viewer added 2026-10-27 per follow-up request). mediaUrl from the API is
 * an opaque relative `/media/:id` path — never usable as-is (it only
 * exists on the API's own origin, not the web app's), so every render here
 * goes through resolveMediaUrl first.
 */
function MediaAttachment({ url, mimeType, filename, isOurs }: { url: string; mimeType: string | null; filename: string | null; isOurs: boolean }) {
  const [open, setOpen] = useState(false);
  const viewUrl = resolveMediaUrl(url);
  const downloadUrl = `${viewUrl}${viewUrl.includes("?") ? "&" : "?"}download=1`;
  const label = filename || "Attachment";
  const linkTone = isOurs ? "text-white/80 hover:text-white" : "text-accent hover:text-accent/80";
  const isImage = mimeType?.startsWith("image/") ?? false;
  const isVideo = mimeType?.startsWith("video/") ?? false;

  return (
    <>
      {isImage && (
        <div className="mt-1">
          <button type="button" onClick={() => setOpen(true)} className="block w-full">
            <img src={viewUrl} alt={label} className="max-h-60 w-full rounded-lg object-cover" />
          </button>
          <a href={downloadUrl} download className={`mt-1 flex items-center gap-1 text-xs ${linkTone}`}>
            <DownloadIcon /> Download
          </a>
        </div>
      )}
      {isVideo && (
        <div className="mt-1">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={viewUrl} controls className="max-h-60 w-full rounded-lg" />
          <a href={downloadUrl} download className={`mt-1 flex items-center gap-1 text-xs ${linkTone}`}>
            <DownloadIcon /> Download
          </a>
        </div>
      )}
      {!isImage && !isVideo && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`mt-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
            isOurs ? "border-white/25 hover:bg-white/10" : "border-[var(--line)] hover:bg-ink/5"
          }`}
        >
          <FileIcon />
          <span className="flex-1 truncate text-left">{label}</span>
          <DownloadIcon />
        </button>
      )}
      {open && <MediaLightbox url={viewUrl} downloadUrl={downloadUrl} mimeType={mimeType} filename={label} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The chat panel for one conversation — styled after WhatsApp Web (Part:
 * Social Inbox removal / WhatsApp-Web-style redesign, 2026-10-21, explicit
 * user request — "create the ui exactly like whatsapp web... same features
 * etc everthing"). The header stays as clean as WhatsApp Web's own (avatar +
 * name, nothing else by default); this app's CRM-only concepts (status,
 * assignment, internal notes, convert-to-lead — none of which exist in real
 * WhatsApp Web) live in a collapsible "Contact info" panel opened by
 * clicking the header, the same interaction WhatsApp Web itself uses for
 * its own contact-info panel. Internal notes still render in a visually
 * distinct card there, never inside the message thread, and are never sent
 * anywhere — POST/PATCH/DELETE here only ever hit social-inbox/notes
 * endpoints, never a provider's sendMessage.
 */
export function ConversationDetailPanel({ conversationId, capabilitiesByPlatform }: { conversationId: string; capabilitiesByPlatform: Record<string, Capabilities> }) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [editingContactName, setEditingContactName] = useState(false);
  const [contactNameDraft, setContactNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdLeadId, setCreatedLeadId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detailQuery = useQuery({
    queryKey: ["social-inbox-conversation", conversationId],
    queryFn: () => api.getSocialInboxConversation(conversationId) as Promise<ConversationDetail>,
  });

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api.getUsers() as Promise<TeamUser[]>,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["social-inbox-conversation", conversationId] });
    queryClient.invalidateQueries({ queryKey: ["social-inbox-conversations"] });
    queryClient.invalidateQueries({ queryKey: ["social-inbox-stats"] });
  }

  const updateMutation = useMutation({
    mutationFn: (body: { status?: string; assignedToUserId?: string; contactName?: string }) => api.updateSocialInboxConversation(conversationId, body),
    onSuccess: invalidate,
    onError: (err) => setError((err as Error).message),
  });

  const replyMutation = useMutation({
    mutationFn: (text: string) => api.replySocialInboxConversation(conversationId, text),
    // Optimistic send (Part: WhatsApp QR instant-feel reply, 2026-10-26,
    // explicit user request — "the message should be sent from the chat
    // instantly, and then if it takes a little [longer] to deliver it
    // won't be an issue"). The WhatsApp QR send path has a real network
    // round trip plus an intentional anti-spam jitter delay before the
    // backend responds -- waiting for that before showing anything made
    // every reply feel slow. The bubble now appears the instant Send is
    // clicked; onSuccess's invalidate() swaps it for the real persisted
    // message moments later, onError rolls it back and restores the draft
    // text so nothing typed is lost.
    onMutate: async (text: string) => {
      const key = ["social-inbox-conversation", conversationId];
      const previous = queryClient.getQueryData<ConversationDetail>(key);
      const optimisticMessage: SocialMessageItem = {
        id: `optimistic-${Date.now()}`,
        fromUs: true,
        senderName: null,
        messageText: text,
        mediaUrl: null,
        mediaMimeType: null,
        mediaFilename: null,
        sentAt: new Date().toISOString(),
      };
      queryClient.setQueryData<ConversationDetail>(key, (old) => (old ? { ...old, messages: [...old.messages, optimisticMessage] } : old));
      setReplyText("");
      return { previous, text };
    },
    onSuccess: () => {
      invalidate();
    },
    // Facebook/Instagram's own 24-hour messaging-window policy (Part:
    // Social Inbox removal / per-module messaging follow-up, 2026-10-21,
    // explicit user request — "the msgs are not getting sent") surfaces as
    // a raw Graph API error (code 10 / error_subcode 2018278) that reads as
    // broken rather than a real, unavoidable platform rule — same
    // limitation WhatsApp already explains plainly in its own reply box.
    onError: (err, _text, context) => {
      if (context) {
        queryClient.setQueryData(["social-inbox-conversation", conversationId], context.previous);
        setReplyText(context.text);
      }
      const message = (err as Error).message;
      setError(
        /error_subcode["\s:]*2018278|outside the allowed window/i.test(message)
          ? "Can't send — it's been more than 24 hours since this person's last message. Meta only allows free-form replies within that window; after it, a business needs a pre-approved message template, which isn't built here yet."
          : message,
      );
    },
  });

  const mediaMutation = useMutation({
    // File attachments (Part: WhatsApp media-send, 2026-10-26, explicit user
    // request — "there is no option add or attach anything with it... make
    // sure i got each and every option that whatsapp offers" — scoped to
    // file attachments only per the user's own follow-up choice, no voice-
    // note recording). Only WHATSAPP_QR implements sendMedia today, so the
    // attach button itself is gated on that platform below.
    mutationFn: (file: File) => api.replySocialInboxConversationWithMedia(conversationId, file),
    onSuccess: invalidate,
    onError: (err) => setError((err as Error).message),
  });

  const createNoteMutation = useMutation({
    mutationFn: (note: string) => api.createSocialInboxNote(conversationId, note),
    onSuccess: () => {
      setNoteText("");
      invalidate();
    },
    onError: (err) => setError((err as Error).message),
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ noteId, note }: { noteId: string; note: string }) => api.updateSocialInboxNote(conversationId, noteId, note),
    onSuccess: () => {
      setEditingNoteId(null);
      invalidate();
    },
    onError: (err) => setError((err as Error).message),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => api.deleteSocialInboxNote(conversationId, noteId),
    onSuccess: invalidate,
    onError: (err) => setError((err as Error).message),
  });

  // Deliberately calls the existing, unmodified POST /leads/manual and the
  // existing internal-notes endpoint rather than adding any new backend
  // coupling between the Social Inbox and Leads modules -- social-inbox.
  // service.ts's own docblock says it never imports the leads module, and
  // LeadsService already depends on SocialMediaService the other way
  // (runAutomationsForNewLead), so a direct backend call here would create
  // a circular module dependency. Orchestrating the two existing endpoints
  // from the client is what keeps both modules exactly as they were.
  const convertToLeadMutation = useMutation({
    mutationFn: async () => {
      if (!conversation) throw new Error("Conversation not loaded");
      const name = conversation.contactName || conversation.contactUsername || "Unknown contact";
      const result = (await api.createManualLead({
        companyName: name,
        contactName: conversation.contactName || undefined,
        notes: `Converted from a ${conversation.socialAccount.platform} conversation with @${conversation.contactUsername ?? name} on account @${conversation.socialAccount.username}.`,
      })) as { status: "created" | "duplicate"; leadId?: string };
      if (result.status === "duplicate" || !result.leadId) {
        throw new Error("A lead for this contact already exists.");
      }
      return result.leadId;
    },
    onSuccess: (leadId) => {
      setCreatedLeadId(leadId);
      createNoteMutation.mutate(`Converted to a lead (${leadId}).`);
    },
    onError: (err) => setError((err as Error).message),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="card flex h-full items-center justify-center">
        <LoadingRow label="Loading conversation…" />
      </div>
    );
  }

  const conversation = detailQuery.data;
  if (!conversation) {
    return <div className="card flex h-full items-center justify-center text-sm text-ink/50">Conversation not found.</div>;
  }

  const platformCaps = capabilitiesByPlatform[conversation.socialAccount.platform];
  const canReply = platformCaps?.dms ?? false;
  const contactLabel = conversation.contactName || conversation.contactUsername || "Unknown contact";

  function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    replyMutation.mutate(replyText.trim());
  }

  function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    createNoteMutation.mutate(noteText.trim());
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) mediaMutation.mutate(file);
  }

  const canSendMedia = canReply && conversation.socialAccount.platform === "WHATSAPP_QR";

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      {/* Header — click the contact to open/close Contact info, same
          interaction as WhatsApp Web's own header. */}
      <button
        type="button"
        onClick={() => setInfoOpen((v) => !v)}
        className="flex items-center gap-2.5 border-b border-[var(--line)] px-4 py-3 text-left hover:bg-ink/[0.02]"
      >
        <Avatar name={contactLabel} imageUrl={conversation.contactProfileImageUrl} size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{contactLabel}</div>
          <div className="text-xs text-ink/50">
            {conversation.socialAccount.platform} · @{conversation.socialAccount.username}
          </div>
        </div>
        <span className="flex items-center gap-1 text-xs text-ink/45">
          Contact info <ChevronIcon open={infoOpen} />
        </span>
      </button>

      {infoOpen && (
        <div className="flex flex-col gap-3 border-b border-[var(--line)] bg-ink/[0.015] px-4 py-3">
          {/* Manual contact name override (Part: WhatsApp Team Inbox
              contact rename, 2026-10-26, explicit user request) -- the main
              use for this is WhatsApp QR's LID-routed contacts, where the
              platform never provides a real name/number to a linked device
              at all; letting a team member set one once they recognize who
              it is beats showing a raw id forever. */}
          <div className="flex items-center gap-1.5 text-xs text-ink/55">
            Contact name
            {editingContactName ? (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateMutation.mutate({ contactName: contactNameDraft.trim() });
                  setEditingContactName(false);
                }}
              >
                <input
                  autoFocus
                  value={contactNameDraft}
                  onChange={(e) => setContactNameDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setEditingContactName(false)}
                  placeholder="e.g. Alex (Light Force Center)"
                  className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
                />
                <button type="submit" disabled={updateMutation.isPending} className="font-medium text-accent disabled:opacity-50">
                  Save
                </button>
                <button type="button" className="text-ink/50" onClick={() => setEditingContactName(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="rounded border border-dashed border-[var(--line)] px-2 py-1 text-ink/70 hover:bg-ink/5"
                onClick={() => {
                  setContactNameDraft(conversation.contactName ?? "");
                  setEditingContactName(true);
                }}
              >
                {conversation.contactName || "Set a name"}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-ink/55">
              Status
              <select
                value={conversation.status}
                onChange={(e) => updateMutation.mutate({ status: e.target.value })}
                disabled={updateMutation.isPending}
                className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
              >
                <option value="OPEN">Open</option>
                <option value="PENDING">Pending</option>
                <option value="CLOSED">Closed</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink/55">
              Assigned to
              <select
                value={conversation.assignedToUserId ?? ""}
                onChange={(e) => updateMutation.mutate({ assignedToUserId: e.target.value })}
                disabled={updateMutation.isPending}
                className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
              >
                <option value="">Unassigned</option>
                {(usersQuery.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            {createdLeadId ? (
              <Link
                href={`/leads/${createdLeadId}`}
                className="rounded-md border border-good/40 bg-good/10 px-2.5 py-1 text-xs font-medium text-good hover:bg-good/15"
              >
                View Lead →
              </Link>
            ) : (
              <button
                onClick={() => convertToLeadMutation.mutate()}
                disabled={convertToLeadMutation.isPending}
                title="Create a Lead from this conversation's contact"
                className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5 disabled:opacity-50"
              >
                {convertToLeadMutation.isPending && <Spinner className="h-3 w-3" />}
                Convert to Lead
              </button>
            )}
          </div>

          {/* Internal notes — visually distinct from the message thread,
              and never sent to the platform (Part: Internal Notes). */}
          <div className="rounded-lg bg-gold/5 px-3 py-2.5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gold">Internal notes — team only</div>
            <div className="mb-2 space-y-1.5">
              {conversation.notes.map((n) => (
                <div key={n.id} className="rounded border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-xs">
                  {editingNoteId === n.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (editingNoteText.trim()) updateNoteMutation.mutate({ noteId: n.id, note: editingNoteText.trim() });
                      }}
                      className="flex gap-1.5"
                    >
                      <input
                        autoFocus
                        value={editingNoteText}
                        onChange={(e) => setEditingNoteText(e.target.value)}
                        className="flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
                      />
                      <button type="submit" className="text-accent hover:underline">Save</button>
                      <button type="button" onClick={() => setEditingNoteId(null)} className="text-ink/50 hover:underline">Cancel</button>
                    </form>
                  ) : (
                    <>
                      <div className="whitespace-pre-wrap">{n.note}</div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-ink/45">
                        <span>{n.user.name} · {timeAgo(n.createdAt)}</span>
                        <span className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingNoteId(n.id);
                              setEditingNoteText(n.note);
                            }}
                            className="hover:underline"
                          >
                            Edit
                          </button>
                          <button onClick={() => deleteNoteMutation.mutate(n.id)} className="text-bad hover:underline">
                            Delete
                          </button>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {conversation.notes.length === 0 && <p className="text-[11px] text-ink/40">No internal notes yet.</p>}
            </div>
            <form onSubmit={submitNote} className="flex gap-1.5">
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add an internal note (never sent to the contact)…"
                className="flex-1 rounded border border-gold/30 bg-transparent px-2.5 py-1.5 text-xs"
              />
              <button
                type="submit"
                disabled={createNoteMutation.isPending}
                className="rounded bg-gold px-2.5 py-1.5 text-xs text-white disabled:opacity-50"
              >
                Add
              </button>
            </form>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-2 rounded border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-1.5 text-xs text-bad">
          {error}
        </div>
      )}

      <div className="flex-1 space-y-1 overflow-y-auto bg-ink/[0.012] px-4 py-3">
        {conversation.messages.map((m, i) => {
          const grouped = groupsWithPrev(conversation.messages[i - 1], m);
          return (
            <div key={m.id} className={`flex ${m.fromUs ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : "mt-2.5"}`}>
              <div
                className={`max-w-[65%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                  m.fromUs ? "bg-accent text-white" : "bg-surface-elevated border border-[var(--line)]"
                }`}
              >
                <div className="whitespace-pre-wrap">{m.messageText}</div>
                {m.mediaUrl && <MediaAttachment url={m.mediaUrl} mimeType={m.mediaMimeType} filename={m.mediaFilename} isOurs={m.fromUs} />}
                <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${m.fromUs ? "text-white/70" : "text-ink/40"}`}>
                  <span>{timeAgo(m.sentAt)}</span>
                  {m.fromUs && <CheckIcon />}
                </div>
              </div>
            </div>
          );
        })}
        {conversation.messages.length === 0 && <p className="py-8 text-center text-xs text-ink/40">No messages yet.</p>}
      </div>

      {/* Composer — rounded pill like WhatsApp Web's own, disabled with an
          explanation when the platform's official API doesn't support
          sending (Part: Reply Interface / Platform API Limitations, never
          a workaround). */}
      <div className="border-t border-[var(--line)] px-4 py-3">
        {canReply ? (
          <form onSubmit={submitReply} className="flex items-center gap-2">
            {canSendMedia && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileChosen}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={mediaMutation.isPending}
                  title="Attach a file"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink/55 hover:bg-ink/[0.05] disabled:opacity-40"
                >
                  {mediaMutation.isPending ? <Spinner className="h-4 w-4" /> : <PaperclipIcon />}
                </button>
              </>
            )}
            <input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type a message"
              className="flex-1 rounded-full border-0 bg-ink/[0.05] px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-accent"
            />
            <EmojiPickerButton onPick={(emoji) => setReplyText((t) => t + emoji)} />
            <button
              type="submit"
              disabled={replyMutation.isPending || !replyText.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
            >
              {replyMutation.isPending ? <Spinner className="h-4 w-4" /> : <SendIcon />}
            </button>
          </form>
        ) : (
          <p className="text-xs text-ink/45">
            Replying isn&apos;t available here: {platformCaps?.notes || `${conversation.socialAccount.platform}'s official API doesn't support sending direct messages.`}
          </p>
        )}
      </div>
    </div>
  );
}
