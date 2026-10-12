import { Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from './public.decorator';
import { AuthService } from './auth.service';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('guest')
  @ApiOperation({ summary: '创建游客设备会话' })
  @ApiCreatedResponse({ description: 'Token 仅在创建时返回，客户端必须安全保存。' })
  createGuestSession() {
    return this.auth.createGuestSession();
  }
}
