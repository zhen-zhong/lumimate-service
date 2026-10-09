import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SkillPluginController } from './skill-plugin.controller';
import { SkillPolicyResolverService } from './skill-policy-resolver.service';
import { SkillPluginService } from './skill-plugin.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SkillPluginController],
  providers: [SkillPluginService, SkillPolicyResolverService],
  exports: [SkillPluginService, SkillPolicyResolverService],
})
export class SkillPluginModule {}
