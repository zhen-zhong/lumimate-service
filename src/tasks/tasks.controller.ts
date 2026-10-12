import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CreateIntentDto } from './dto/create-intent.dto';
import { UpdateIntentDto } from './dto/update-intent.dto';
import { TasksService } from './tasks.service';
import { ConversationAccessService } from '../auth/conversation-access.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@ApiTags('智能任务')
@Controller()
export class TasksController {
  constructor(private readonly conversations: ConversationAccessService, private readonly tasks: TasksService) {}

  @Get('/chats/:conversationId/intents')
  @ApiOperation({ summary: '获取会话的提醒、跟进和主动陪伴任务' })
  @ApiParam({ name: 'conversationId', description: '会话 ID' })
  async list(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.tasks.list(conversation.id);
  }

  @Post('/chats/:conversationId/intents')
  @ApiOperation({ summary: '创建待确认任务；不会立即调度' })
  @ApiParam({ name: 'conversationId', description: '会话 ID' })
  async create(@Param('conversationId') conversationId: string, @Body() body: CreateIntentDto, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.tasks.create(conversation.id, conversation.userId, body);
  }

  @Post('/chats/:conversationId/intents/:intentId/confirm')
  @ApiOperation({ summary: '确认并调度任务' })
  async confirm(@Param('conversationId') conversationId: string, @Param('intentId') intentId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.tasks.confirm(conversation.id, intentId);
  }

  @Patch('/chats/:conversationId/intents/:intentId')
  @ApiOperation({ summary: '修改待确认或已安排任务；已安排任务会重新入队' })
  async update(
    @Param('conversationId') conversationId: string,
    @Param('intentId') intentId: string,
    @Body() body: UpdateIntentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.tasks.update(conversation.id, intentId, body);
  }

  @Delete('/chats/:conversationId/intents/:intentId')
  @ApiOperation({ summary: '取消任务' })
  async cancel(@Param('conversationId') conversationId: string, @Param('intentId') intentId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.tasks.cancel(conversation.id, intentId);
  }
}
