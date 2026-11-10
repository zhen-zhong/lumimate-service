import { ApiPropertyOptional } from '@nestjs/swagger';
import { SharedEpisodeResolution } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSharedEpisodeDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ maxLength: 4_000 })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  content?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiPropertyOptional({ enum: SharedEpisodeResolution })
  @IsOptional()
  @IsEnum(SharedEpisodeResolution)
  resolution?: SharedEpisodeResolution;
}
