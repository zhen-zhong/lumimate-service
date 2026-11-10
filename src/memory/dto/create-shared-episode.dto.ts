import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SharedEpisodeKind } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSharedEpisodeDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 4_000 })
  @IsString()
  @MaxLength(4_000)
  content!: string;

  @ApiPropertyOptional({ description: '来源聊天消息 ID；手动创建时可省略' })
  @IsOptional()
  @IsString()
  sourceMessageId?: string;

  @ApiPropertyOptional({ enum: SharedEpisodeKind, default: SharedEpisodeKind.TODAY_FRAGMENT })
  @IsOptional()
  @IsEnum(SharedEpisodeKind)
  kind?: SharedEpisodeKind;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}
