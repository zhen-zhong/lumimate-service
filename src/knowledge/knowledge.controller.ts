import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CreateTextDocumentDto } from './dto/create-text-document.dto';
import { SearchKnowledgeDto } from './dto/search-knowledge.dto';
import { KnowledgeService } from './knowledge.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@ApiTags('知识库')
@Controller('/chats/:conversationId/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('bases')
  @ApiOperation({ summary: '列出当前用户的知识库' })
  listBases(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.knowledge.listBases(conversationId, user.userId);
  }

  @Get('documents')
  @ApiOperation({ summary: '列出知识文档' })
  listDocuments(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('knowledgeBaseName') knowledgeBaseName?: string,
  ) {
    return this.knowledge.listDocuments(conversationId, user.userId, knowledgeBaseName);
  }

  @Post('documents/text')
  @ApiOperation({ summary: '写入文本或 Markdown 文档并立即分块' })
  createTextDocument(@Param('conversationId') conversationId: string, @Body() body: CreateTextDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.knowledge.createTextDocument(conversationId, user.userId, body);
  }

  @Get('search')
  @ApiOperation({ summary: '在当前用户知识库中进行关键词检索并返回引用' })
  search(@Param('conversationId') conversationId: string, @Query() query: SearchKnowledgeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.knowledge.search(conversationId, user.userId, query);
  }

  @Delete('documents/:documentId')
  @ApiOperation({ summary: '删除知识文档及其分块' })
  @ApiParam({ name: 'documentId', description: '知识文档 ID' })
  async removeDocument(@Param('conversationId') conversationId: string, @Param('documentId') documentId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.knowledge.removeDocument(conversationId, user.userId, documentId);
  }
}
