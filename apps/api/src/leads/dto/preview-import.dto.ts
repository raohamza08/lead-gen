import { IsString } from "class-validator";

/** Raw CSV text, read client-side from the uploaded file (Part: lead import). */
export class PreviewImportDto {
  @IsString()
  csv!: string;
}
