import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ConversationAccessService } from '../auth/conversation-access.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RegisterPushDeviceDto } from './dto/register-push-device.dto';
import { PushService } from './push.service';

@ApiTags('推送通知')
@Controller('/chats')
export class PushController {
  constructor(private readonly conversations: ConversationAccessService, private readonly push: PushService) {}

  @Get(':conversationId/push-devices')
  @ApiOperation({ summary: '获取当前用户已登记的推送设备' })
  async list(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.push.listDevices(conversation.userId);
  }

  @Post(':conversationId/push-devices')
  @ApiOperation({ summary: '登记或恢复 Expo Push 设备' })
  async register(
    @Param('conversationId') conversationId: string,
    @Body() body: RegisterPushDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.push.registerDevice(conversation.userId, body);
  }

  @Delete(':conversationId/push-devices/:expoPushToken')
  @ApiOperation({ summary: '停用当前设备的 Expo Push 推送' })
  @ApiParam({ name: 'expoPushToken', description: 'URL 编码后的 Expo Push Token' })
  async disable(
    @Param('conversationId') conversationId: string,
    @Param('expoPushToken') expoPushToken: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    await this.push.disableDevice(conversation.userId, expoPushToken);
  }
}
