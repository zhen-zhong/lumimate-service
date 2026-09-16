import { IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MessageAttachmentDto {
  @IsString()
  @MaxLength(512)
  url!: string;

  @IsString()
  @MaxLength(128)
  mimeType!: string;
}

export class CreateMessageDto {
  @IsString()
  @MaxLength(20_000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
}
