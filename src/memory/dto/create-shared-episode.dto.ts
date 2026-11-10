import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}
