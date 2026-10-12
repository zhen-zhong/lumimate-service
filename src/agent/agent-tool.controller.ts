import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { AgentToolService } from './agent-tool.service';
import { ConversationAccessService } from '../auth/conversation-access.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@ApiTags('智能体工具')
@Controller('/chats')
export class AgentToolController {
  constructor(private readonly conversations: ConversationAccessService, private readonly tools: AgentToolService) {}

  @Get(':conversationId/agent-runs')
  @ApiOperation({ summary: '获取可审计的智能体工具调用' })
  @ApiParam({ name: 'conversationId', description: '会话 ID' })
  async list(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.tools.list(conversation.id);
  }

  @Post(':conversationId/agent-runs/:runId/confirm')
  @ApiOperation({ summary: '确认并执行需要授权的工具调用' })
  async confirm(@Param('conversationId') conversationId: string, @Param('runId') runId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.tools.confirm(conversation.id, runId);
  }

  @Delete(':conversationId/agent-runs/:runId')
  @ApiOperation({ summary: '取消待确认的工具调用' })
  async cancel(@Param('conversationId') conversationId: string, @Param('runId') runId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.tools.cancel(conversation.id, runId);
  }
}
