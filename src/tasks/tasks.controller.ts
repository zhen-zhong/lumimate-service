import { Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../database/prisma.service';
import { CreateIntentDto } from './dto/create-intent.dto';
import { TasksService } from './tasks.service';

@ApiTags('智能任务')
@Controller()
export class TasksController {
  constructor(private readonly prisma: PrismaService, private readonly tasks: TasksService) {}

  @Get('/chats/:conversationId/intents')
  @ApiOperation({ summary: '获取会话的提醒、跟进和主动陪伴任务' })
  @ApiParam({ name: 'conversationId', description: '会话 ID' })
  async list(@Param('conversationId') conversationId: string) {
    await this.requireConversation(conversationId);
    return this.tasks.list(conversationId);
  }

  @Post('/chats/:conversationId/intents')
  @ApiOperation({ summary: '创建待确认任务；不会立即调度' })
  @ApiParam({ name: 'conversationId', description: '会话 ID' })
  async create(@Param('conversationId') conversationId: string, @Body() body: CreateIntentDto) {
    const conversation = await this.requireConversation(conversationId);
    return this.tasks.create(conversation.id, conversation.userId, body);
  }

  @Post('/chats/:conversationId/intents/:intentId/confirm')
  @ApiOperation({ summary: '确认并调度任务' })
  async confirm(@Param('conversationId') conversationId: string, @Param('intentId') intentId: string) {
    await this.requireConversation(conversationId);
    return this.tasks.confirm(conversationId, intentId);
  }

  @Delete('/chats/:conversationId/intents/:intentId')
  @ApiOperation({ summary: '取消任务' })
  async cancel(@Param('conversationId') conversationId: string, @Param('intentId') intentId: string) {
    await this.requireConversation(conversationId);
    return this.tasks.cancel(conversationId, intentId);
  }

  private async requireConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true },
    });
    if (!conversation) throw new NotFoundException('会话不存在');
    return conversation;
  }
}
