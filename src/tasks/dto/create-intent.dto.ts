import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgentIntentType } from '@prisma/client';
import { IsDate, IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateIntentDto {
  @ApiProperty({ enum: AgentIntentType, example: AgentIntentType.REMINDER })
  @IsEnum(AgentIntentType)
  type!: AgentIntentType;

  @ApiProperty({ example: '提醒我参加产品会议', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  title!: string;

  @ApiProperty({ example: '2026-10-09T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  dueAt!: Date;

  @ApiProperty({ example: 'Asia/Shanghai' })
  @IsString()
  @MaxLength(100)
  timezone!: string;

  @ApiPropertyOptional({ description: '任务补充参数；只接受 JSON 对象' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
