import { ApiPropertyOptional } from '@nestjs/swagger';
import { MemoryCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMemoryDto {
  @ApiPropertyOptional({ maxLength: 2_000 })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  content?: string;

  @ApiPropertyOptional({ enum: MemoryCategory })
  @IsOptional()
  @IsEnum(MemoryCategory)
  category?: MemoryCategory;
}
