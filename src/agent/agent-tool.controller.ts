import { Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../database/prisma.service';
import { AgentToolService } from './agent-tool.service';

@ApiTags('智能体工具')
@Controller('/chats')
export class AgentToolController {
  constructor(private readonly prisma: PrismaService, private readonly tools: AgentToolService) {}

  @Get(':conversationId/agent-runs')
  @ApiOperation({ summary: '获取可审计的智能体工具调用' })
  @ApiParam({ name: 'conversationId', description: '会话 ID' })
  async list(@Param('conversationId') conversationId: string) {
    await this.requireConversation(conversationId);
    return this.tools.list(conversationId);
  }

  @Post(':conversationId/agent-runs/:runId/confirm')
  @ApiOperation({ summary: '确认并执行需要授权的工具调用' })
  async confirm(@Param('conversationId') conversationId: string, @Param('runId') runId: string) {
    await this.requireConversation(conversationId);
    return this.tools.confirm(conversationId, runId);
  }

  @Delete(':conversationId/agent-runs/:runId')
  @ApiOperation({ summary: '取消待确认的工具调用' })
  async cancel(@Param('conversationId') conversationId: string, @Param('runId') runId: string) {
    await this.requireConversation(conversationId);
    return this.tools.cancel(conversationId, runId);
  }

  private async requireConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } });
    if (!conversation) throw new NotFoundException('会话不存在');
  }
}
