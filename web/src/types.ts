export type Role = 'employee' | 'admin';
export interface User { id: number; name: string; email: string; team: string; region: string; role: Role; hasPassword: boolean }
export type Status = 'draft' | 'live' | 'closed' | 'published';
export type EntryType = 'image' | 'writing' | 'document' | 'video';

export interface Contest {
  id: number; name: string; theme: string; description: string; rules: string; bannerUrl: string | null;
  entryTypes: EntryType[]; regions: string[]; isGlobal: boolean; scope: 'regional' | 'selected' | 'global'; regionLabel: string; canVote?: boolean; places: number; status: Status; statusLabel: string; announced: boolean;
  timezone: string; endAt: string | null; endLocal: string; deadlineLabel: string;
  startedAt: string | null; closedAt: string | null; publishedAt: string | null; copiedFrom: number | null; createdAt: string;
  entryCount?: number; voterCount?: number; hasVoted?: boolean; myStatus?: 'none' | 'draft' | 'submitted';
}
export interface Entry {
  id: number; number: number; label: string; type: EntryType; title: string; description: string; altText: string;
  url: string | null; thumbUrl: string | null; pageCount: number | null; fileName: string | null;
  body?: string; excerpt?: string; competitorName?: string; size?: number; complete?: boolean;
}
export interface ResultEntry extends Entry { points: number; firsts: number; seconds: number; thirds: number; place: number; shared: boolean }
export interface Results { contest: Contest; totalVoters: number; winners: ResultEntry[]; others: ResultEntry[]; myVoted?: boolean; myPicks?: Pick[] }
export interface Pick { entryId: number; rank: number }
