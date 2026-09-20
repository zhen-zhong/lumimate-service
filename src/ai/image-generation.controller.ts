import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CreateImageGenerationDto, EditImageDto } from './dto/create-image-generation.dto';
import { ImageGenerationService } from './image-generation.service';

@ApiTags('AI 图片生成')
@Controller('ai/images')
export class ImageGenerationController {
  constructor(private readonly images: ImageGenerationService) {}

  @Post('generations')
  @ApiOperation({ summary: '生成图片' })
  @ApiCreatedResponse({ description: '统一返回 Base64 data URL 图片列表' })
  generate(@Body() body: CreateImageGenerationDto) {
    return this.images.generate(body);
  }

  @Post('edits')
  @ApiOperation({ summary: '编辑图片' })
  @ApiCreatedResponse({ description: 'GPT Image 使用 multipart 编辑；Gemini 使用 Gemini 原生 inlineData 编辑；统一返回 Base64 data URL 图片列表' })
  edit(@Body() body: EditImageDto) {
    return this.images.edit(body);
  }
}
