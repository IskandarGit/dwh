export type AnnouncementState = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type AnnouncementBannerType = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AnnouncementAdminRecord {
  id: number;
  titleJson: Record<string, string>;
  bodyJson: Record<string, string>;
  bannerType: AnnouncementBannerType;
  state: AnnouncementState;
  createdBy: number | null;
  createdAt: string;
  modifiedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  lockVersion: number;
}

export interface AnnouncementDraftPayload {
  titleJson: Record<string, string>;
  bodyJson: Record<string, string>;
  bannerType: AnnouncementBannerType;
  lockVersion: number | null;
}

export interface Confirmation {
  action: 'publish' | 'archive';
  announcement: AnnouncementAdminRecord;
}

export interface ApiProblem {
  status?: number;
  code?: string;
  detail?: string;
}
