"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api-client";
import { Avatar } from "../../../components/avatar";
import { playNotificationTone, unlockNotificationAudio, SoundTone } from "../../../lib/notification-sounds";
import { LoadingRow } from "../../../components/spinner";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Toggle } from "../../../components/ui/toggle";
import { Select } from "../../../components/ui/select";

interface Me {
  id: string;
  email: string;
  name: string;
  role: string;
  displayName: string | null;
  jobTitle: string | null;
  phone: string | null;
  avatarUrl: string | null;
}

interface Preferences {
  inAppEnabled: boolean;
  desktopEnabled: boolean;
  soundEnabled: boolean;
  soundTone: SoundTone;
  emailEnabled: boolean;
  leadsEnabled: boolean;
  agentsEnabled: boolean;
  automationsEnabled: boolean;
  socialEnabled: boolean;
  systemEnabled: boolean;
}

const SOUND_TONES: SoundTone[] = ["DEFAULT", "SOFT", "PROFESSIONAL", "MINIMAL", "ALERT", "NONE"];
const SOUND_TONE_OPTIONS = SOUND_TONES.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() }));

/**
 * My Profile (Part: User Profile, 2026-08-31; restyled Part: UI/UX
 * Redesign, 2026-09-01 — the demo page for the new components/ui/* shared
 * component library, per the redesign plan's Phase 4 smoke-test step) —
 * personal details, avatar, password change, and notification preferences
 * (the settings form the bell's desktop/sound/category behavior reads
 * from — see notifications-bell.tsx).
 */
export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [prefsSaving, setPrefsSaving] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission | "unsupported">("default");

  function loadMe() {
    api.getMe().then((res) => {
      const m = res as Me;
      setMe(m);
      setDisplayName(m.displayName ?? "");
      setJobTitle(m.jobTitle ?? "");
      setPhone(m.phone ?? "");
    });
  }

  useEffect(loadMe, []);
  useEffect(() => {
    api.getNotificationPreferences().then((res) => setPreferences(res as Preferences));
    setPermissionState(typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported");
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileError(null);
    setProfileNotice(null);
    try {
      await api.updateProfile({ displayName, jobTitle, phone });
      setProfileNotice("Profile updated.");
      loadMe();
    } catch (err) {
      setProfileError((err as Error).message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordSaving(true);
    setPasswordError(null);
    setPasswordNotice(null);
    try {
      await api.changePassword({ currentPassword, newPassword, confirmPassword });
      setPasswordNotice("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError((err as Error).message);
    } finally {
      setPasswordSaving(false);
    }
  }

  async function onAvatarSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      await api.uploadAvatar(file);
      loadMe();
    } catch (err) {
      setAvatarError((err as Error).message);
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeAvatar() {
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      await api.removeAvatar();
      loadMe();
    } catch (err) {
      setAvatarError((err as Error).message);
    } finally {
      setAvatarUploading(false);
    }
  }

  async function updatePreference(patch: Partial<Preferences>) {
    if (!preferences) return;
    const next = { ...preferences, ...patch };
    setPreferences(next);
    setPrefsSaving(true);
    try {
      await api.updateNotificationPreferences(patch);
    } catch {
      setPreferences(preferences); // revert on failure
    } finally {
      setPrefsSaving(false);
    }
  }

  async function toggleDesktop(enabled: boolean) {
    if (enabled && typeof window !== "undefined" && "Notification" in window) {
      const result = await window.Notification.requestPermission();
      setPermissionState(result);
      if (result !== "granted") return; // don't flip the preference on if the browser itself refused
    }
    updatePreference({ desktopEnabled: enabled });
  }

  function previewTone(tone: SoundTone) {
    unlockNotificationAudio();
    playNotificationTone(tone);
  }

  if (!me) return <LoadingRow label="Loading profile…" />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-page-title text-ink">My Profile</h1>
        <p className="mt-0.5 text-metadata text-ink/55">Manage your personal details, password, and notification preferences.</p>
      </div>

      <section className="card flex items-center gap-4 p-5">
        <Avatar name={me.displayName || me.name} email={me.email} avatarUrl={me.avatarUrl} sizeClass="h-16 w-16 text-lg" />
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={avatarUploading}
              loading={avatarUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {me.avatarUrl ? "Replace picture" : "Upload picture"}
            </Button>
            {me.avatarUrl && (
              <Button type="button" variant="danger" size="sm" disabled={avatarUploading} onClick={removeAvatar}>
                Remove
              </Button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarSelected} />
          {avatarError && <p className="text-xs text-error">{avatarError}</p>}
          <p className="text-[11px] text-ink/40">JPG, PNG, or GIF. Shown wherever your identity appears in the app.</p>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-section-title text-ink">Personal details</h2>
        {profileError && <p className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-error">{profileError}</p>}
        {profileNotice && <p className="mb-3 rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">{profileNotice}</p>}
        <form onSubmit={saveProfile} className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Full name</span>
            <Input value={me.name} disabled />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Email</span>
            <Input value={me.email} disabled />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Display name</span>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={me.name} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Job title</span>
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-ink/60">Phone</span>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" loading={profileSaving}>
              Save changes
            </Button>
          </div>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-section-title text-ink">Change password</h2>
        {passwordError && <p className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-error">{passwordError}</p>}
        {passwordNotice && <p className="mb-3 rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">{passwordNotice}</p>}
        <form onSubmit={savePassword} className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Current password</span>
            <Input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">New password</span>
            <Input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Confirm new password</span>
            <Input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </label>
          <div className="sm:col-span-3">
            <Button type="submit" loading={passwordSaving} disabled={newPassword.length < 8 || newPassword !== confirmPassword}>
              Update password
            </Button>
          </div>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-section-title text-ink">Notification settings</h2>
        {!preferences ? (
          <p className="text-xs text-ink/40">Loading…</p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--line)]">
            <div className="py-1.5">
              <Toggle checked={preferences.inAppEnabled} onCheckedChange={(v) => updatePreference({ inAppEnabled: v })} label="In-app notifications" />
            </div>
            <div className="py-1.5">
              <Toggle checked={preferences.desktopEnabled} onCheckedChange={toggleDesktop} label="Desktop notifications" />
              {permissionState === "denied" && (
                <p className="pt-1.5 text-[11px] text-error">
                  Blocked at the browser level — enable notifications for this site in your browser settings first.
                </p>
              )}
              {permissionState === "unsupported" && (
                <p className="pt-1.5 text-[11px] text-ink/40">Desktop notifications aren&apos;t supported in this browser.</p>
              )}
            </div>
            <div className="py-1.5">
              <Toggle checked={preferences.soundEnabled} onCheckedChange={(v) => updatePreference({ soundEnabled: v })} label="Notification sound" />
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5 text-sm text-ink/80">
              <span>Sound</span>
              <div className="flex items-center gap-2">
                <div className="w-36">
                  <Select
                    value={preferences.soundTone}
                    onValueChange={(v) => updatePreference({ soundTone: v as SoundTone })}
                    options={SOUND_TONE_OPTIONS}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => previewTone(preferences.soundTone)}
                  disabled={preferences.soundTone === "NONE"}
                >
                  Preview
                </Button>
              </div>
            </div>

            <div className="pt-2">
              <p className="pb-1 text-label uppercase text-ink/40">Categories</p>
              <div className="flex flex-col gap-1.5 py-1">
                <Toggle checked={preferences.emailEnabled} onCheckedChange={(v) => updatePreference({ emailEnabled: v })} label="New emails" />
                <Toggle checked={preferences.leadsEnabled} onCheckedChange={(v) => updatePreference({ leadsEnabled: v })} label="Lead activity" />
                <Toggle checked={preferences.agentsEnabled} onCheckedChange={(v) => updatePreference({ agentsEnabled: v })} label="Agent failures" />
                <Toggle checked={preferences.automationsEnabled} onCheckedChange={(v) => updatePreference({ automationsEnabled: v })} label="Automation events" />
                <Toggle checked={preferences.socialEnabled} onCheckedChange={(v) => updatePreference({ socialEnabled: v })} label="Social media" />
                <Toggle checked={preferences.systemEnabled} onCheckedChange={(v) => updatePreference({ systemEnabled: v })} label="System alerts" />
              </div>
            </div>
            {prefsSaving && <p className="pt-2 text-[11px] text-ink/35">Saving…</p>}
          </div>
        )}
      </section>
    </div>
  );
}
