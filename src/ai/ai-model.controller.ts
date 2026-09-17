import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AiModelCatalogService } from './ai-model-catalog.service';

@ApiTags('AI 模型')
@Controller('ai/models')
export class AiModelController {
  constructor(private readonly models: AiModelCatalogService) {}

  @Get()
  @ApiOperation({ summary: '获取启用的聊天模型' })
  @ApiOkResponse({ description: '仅返回 enabled=true 的模型' })
  listEnabled() {
    return this.models.listEnabled();
  }
}
