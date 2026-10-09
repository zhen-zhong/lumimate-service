import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SearchKnowledgeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  query!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  knowledgeBaseName?: string;
}
