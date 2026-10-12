import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDate, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateIntentDto {
  @ApiPropertyOptional({ example: '提醒我参加产品会议', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ example: '2026-10-10T01:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueAt?: Date;

  @ApiPropertyOptional({ example: 'Asia/Shanghai' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional({ description: '任务补充参数；只接受 JSON 对象' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
