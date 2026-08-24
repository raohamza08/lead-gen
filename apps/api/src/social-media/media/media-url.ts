import { apiPublicUrl } from "../../common/api-url";

export function mediaPublicUrl(mediaAssetId: string): string {
  return `${apiPublicUrl()}/media/${mediaAssetId}`;
}
