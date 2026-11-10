import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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

  @ApiPropertyOptional({ description: '结构化角色档案；生成角色后由客户端随设置一起保存' })
  @IsOptional()
  @IsObject()
  personaProfile?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: '角色档案版本', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  personaVersion?: number;

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

  @ApiPropertyOptional({ description: '生图时是否参考角色档案与最近对话', default: true })
  @IsOptional()
  @IsBoolean()
  imageUseContext?: boolean;

  @ApiPropertyOptional({ description: '携带的历史消息条数', minimum: 1, maximum: 1_000, example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  contextMessageLimit?: number;
}

export class GeneratePersonaDraftDto {
  @ApiPropertyOptional({ description: '当前页面选择的聊天模型 ID；未传时使用会话已保存模型' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  modelId?: string;

  @ApiPropertyOptional({ description: '当前角色名称草稿，供 AI 延续或改写', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  agentName?: string;

  @ApiPropertyOptional({ description: '当前角色设定草稿，供 AI 延续或改写', maxLength: 2_000 })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  agentProfile?: string;

  @ApiPropertyOptional({ description: '当前回复风格草稿，供 AI 延续或改写', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  responseStyle?: string;

  @ApiPropertyOptional({ description: '关系类型偏好', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  relationshipType?: string;

  @ApiPropertyOptional({ description: '活跃度偏好', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  activityLevel?: string;

  @ApiPropertyOptional({ description: '说话语气偏好', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  speechTone?: string;

  @ApiPropertyOptional({ description: '主动陪伴边界偏好', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  proactiveBoundary?: string;
}
