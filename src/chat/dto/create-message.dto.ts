import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, Matches, MaxLength, ValidateBy, ValidateNested, isURL } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MessageAttachmentDto {
  @ApiProperty({ description: '附件地址；支持公开 HTTP(S) URL 或 data:image/...;base64,...', maxLength: 15_728_640 })
  @ValidateBy({
    name: 'isSupportedImageUrl',
    validator: {
      validate(value, args) {
        const mimeType = (args?.object as MessageAttachmentDto).mimeType;
        return typeof mimeType !== 'string' || !mimeType.startsWith('image/') ||
          (typeof value === 'string' && (
            isURL(value, { protocols: ['http', 'https'], require_protocol: true }) ||
            new RegExp(`^data:${mimeType};base64,[A-Za-z0-9+/]+={0,2}$`).test(value)
          ));
      },
      defaultMessage: () => '图片地址必须是公开 HTTP(S) URL 或 Base64 data URL',
    },
  })
  @IsString()
  @MaxLength(15_728_640)
  url!: string;

  @ApiProperty({ description: '附件 MIME 类型；支持图片 JPEG、PNG、GIF、WebP', maxLength: 128, example: 'image/png' })
  @IsString()
  @MaxLength(128)
  @Matches(/^(?!image\/)|^image\/(?:jpeg|png|gif|webp)$/, {
    message: '图片仅支持 JPEG、PNG、GIF、WebP',
  })
  mimeType!: string;
}

export class CreateMessageDto {
  @ApiProperty({ description: '用户消息内容', maxLength: 20_000, example: '你好' })
  @IsString()
  @MaxLength(20_000)
  content!: string;

  @ApiPropertyOptional({ description: '附件列表', type: [MessageAttachmentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
}
