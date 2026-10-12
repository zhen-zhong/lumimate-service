import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ConversationAccessService } from './conversation-access.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, ConversationAccessService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, ConversationAccessService],
})
export class AuthModule {}
