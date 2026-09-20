import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateChatSettingsDto {
  @ApiPropertyOptional({ description: '助手名称', maxLength: 32, example: 'LumiMate' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  agentName?: string;

  @ApiPropertyOptional({ description: '助手角色设定', maxLength: 2_000 })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  agentProfile?: string;

  @ApiPropertyOptional({ description: '回复风格', maxLength: 500, example: '温和、简洁' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  responseStyle?: string;

  @ApiPropertyOptional({ description: '聊天模型 ID；必须为启用模型' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  modelId?: string;

  @ApiPropertyOptional({ description: '图片创作模型 ID；必须为启用的图片生成模型' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  imageModelId?: string;

  @ApiPropertyOptional({ description: '携带的历史消息条数', minimum: 1, maximum: 1_000, example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  contextMessageLimit?: number;
}
