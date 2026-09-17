import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthService } from './health.service';

@ApiTags('健康检查')
@Controller('/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: '检查 PostgreSQL 和 Redis 连接' })
  @ApiOkResponse({
    description: '依赖服务健康状态',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', example: true },
        database: { type: 'boolean', example: true },
        redis: { type: 'boolean', example: true },
      },
    },
  })
  getHealth() {
    return this.healthService.getHealth();
  }
}
