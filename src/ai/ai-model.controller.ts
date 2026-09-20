import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AiModelCatalogService } from './ai-model-catalog.service';
import type { AiModelCapability } from './model-catalog';

@ApiTags('AI 模型')
@Controller('ai/models')
export class AiModelController {
  constructor(private readonly models: AiModelCatalogService) {}

  @Get()
  @ApiOperation({ summary: '获取启用的 AI 模型' })
  @ApiQuery({ name: 'capability', required: false, enum: ['chat', 'image-generation'] })
  @ApiOkResponse({ description: '仅返回 enabled=true 的模型' })
  listEnabled(@Query('capability') capability?: string) {
    if (capability && capability !== 'chat' && capability !== 'image-generation') {
      throw new BadRequestException('capability 必须是 chat 或 image-generation');
    }
    return this.models.listEnabled(capability as AiModelCapability | undefined);
  }
}
