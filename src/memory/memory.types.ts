import { MemoryCategory } from '@prisma/client';

export const MEMORY_EXTRACTION_QUEUE = 'memory-extraction';

export type ExtractMemoryJob = {
  userId: string;
  conversationId: string;
  sourceMessageId: string;
  content: string;
};

export type MemoryCandidate = {
  category: MemoryCategory;
  content: string;
  confidence: number;
};
