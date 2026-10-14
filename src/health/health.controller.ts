import { Controller, Get } from '@nestjs/common';

import { HealthService } from './health.service';
import { Public } from '../auth/public.decorator';

@Public()
@Controller('/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth() {
    return this.healthService.getHealth();
  }
}
