import { Body, Controller, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../database/prisma.service';
import { UpdateConversationSkillPluginDto } from './dto/update-conversation-skill-plugin.dto';
import { SkillPluginService } from './skill-plugin.service';

@ApiTags('技能插件')
@Controller()
export class SkillPluginController {
  constructor(private readonly prisma: PrismaService, private readonly skills: SkillPluginService) {}

  @Get('/skill-plugins')
  @ApiOperation({ summary: '获取可启用的技能插件目录' })
  listCatalog() {
    return this.skills.listCatalog();
  }

  @Get('/chats/:conversationId/skill-plugins')
  @ApiOperation({ summary: '获取会话已绑定的技能插件' })
  @ApiParam({ name: 'conversationId', description: '会话 ID' })
  async listConversationPlugins(@Param('conversationId') conversationId: string) {
    await this.requireConversation(conversationId);
    return this.skills.listConversationPlugins(conversationId);
  }

  @Put('/chats/:conversationId/skill-plugins/:pluginId')
  @ApiOperation({ summary: '启用、停用或切换会话技能插件版本' })
  async updateConversationPlugin(
    @Param('conversationId') conversationId: string,
    @Param('pluginId') pluginId: string,
    @Body() body: UpdateConversationSkillPluginDto,
  ) {
    await this.requireConversation(conversationId);
    return this.skills.updateConversationPlugin(conversationId, pluginId, body);
  }

  private async requireConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } });
    if (!conversation) throw new NotFoundException('会话不存在');
  }
}
