import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const ALLOWED_TEXT_MIME_TYPES = ['text/plain', 'text/markdown'] as const;

export class CreateTextDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  filename!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  content!: string;

  @IsOptional()
  @IsString()
  @IsIn(ALLOWED_TEXT_MIME_TYPES)
  mimeType?: (typeof ALLOWED_TEXT_MIME_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  knowledgeBaseName?: string;
}
