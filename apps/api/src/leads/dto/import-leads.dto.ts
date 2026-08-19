import { IsObject, IsString } from "class-validator";

/** Confirmed on the mapping screen after PreviewImportDto's suggested
 *  mapping — the user may have corrected it, so this is the source of truth
 *  for the actual import, not the suggestion (Part: lead import). */
export class ImportLeadsDto {
  @IsString()
  csv!: string;

  /** CSV header -> Lead field key. A header mapped to null/omitted is skipped. */
  @IsObject()
  mapping!: Record<string, string | null>;
}
