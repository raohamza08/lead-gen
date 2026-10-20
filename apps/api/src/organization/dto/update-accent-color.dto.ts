import { IsHexColor } from "class-validator";

export class UpdateAccentColorDto {
  /** A 6-digit hex color (e.g. "#8b5cf6"). To reset back to the app's
   *  built-in default, use DELETE rather than sending an empty/null value
   *  here — same "Default button" convention as agent-prompts in this same
   *  controller, and it sidesteps class-validator's historically fuzzy
   *  null-vs-undefined handling under @IsOptional(). Org-wide — every
   *  logged-in user picks up whatever this is set to, not just the admin
   *  who set it (Part: Dashboard Center, 2026-10-20, explicit user
   *  correction — "the color option... is the color that when i change, it
   *  will be changed on everyone's end", after an earlier pass wrongly
   *  scoped it to localStorage/per-browser only). */
  @IsHexColor() hex!: string;
}
