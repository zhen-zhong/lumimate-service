import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ConversationAccessService } from '../auth/conversation-access.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UpdateConversationSkillPluginDto } from './dto/update-conversation-skill-plugin.dto';
import { SkillPluginService } from './skill-plugin.service';

@ApiTags('技能插件')
@Controller()
export class SkillPluginController {
  constructor(private readonly conversations: ConversationAccessService, private readonly skills: SkillPluginService) {}

  @Get('/skill-plugins')
  @ApiOperation({ summary: '获取可启用的技能插件目录' })
  listCatalog() {
    return this.skills.listCatalog();
  }

  @Get('/chats/:conversationId/skill-plugins')
  @ApiOperation({ summary: '获取会话已绑定的技能插件' })
  @ApiParam({ name: 'conversationId', description: '会话 ID' })
  async listConversationPlugins(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.skills.listConversationPlugins(conversation.id);
  }

  @Put('/chats/:conversationId/skill-plugins/:pluginId')
  @ApiOperation({ summary: '启用、停用或切换会话技能插件版本' })
  async updateConversationPlugin(
    @Param('conversationId') conversationId: string,
    @Param('pluginId') pluginId: string,
    @Body() body: UpdateConversationSkillPluginDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.skills.updateConversationPlugin(conversation.id, pluginId, body);
  }
}
