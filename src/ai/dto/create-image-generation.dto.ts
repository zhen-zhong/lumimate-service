import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const IMAGE_MODELS = [
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
  'gpt-image-2',
  'gemini-3.1-flash-image',
] as const;

const DATA_URL_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export class ImageDataUrlDto {
  @ApiProperty({ description: 'Base64 data URL；支持 JPEG、PNG、WebP', maxLength: 15_728_640 })
  @IsString()
  @MaxLength(15_728_640)
  @Matches(DATA_URL_PATTERN, { message: '图片必须是 JPEG、PNG 或 WebP Base64 data URL' })
  dataUrl!: string;
}

export class CreateImageGenerationDto {
  @ApiProperty({ enum: IMAGE_MODELS, example: 'gpt-image-2.5-flare' })
  @IsIn(IMAGE_MODELS)
  modelId!: (typeof IMAGE_MODELS)[number];

  @ApiProperty({ description: '生图提示词', maxLength: 8_000, example: '夜晚的北京街头，电影感，暖色灯光' })
  @IsString()
  @MaxLength(8_000)
  prompt!: string;

  @ApiPropertyOptional({ description: 'GPT Image 像素尺寸；Gemini 请使用 aspectRatio 和 imageSize', example: '1024x1024' })
  @IsOptional()
  @Matches(/^(auto|\d{3,5}x\d{3,5})$/, { message: 'size 必须是 auto 或 宽x高，例如 1024x1024' })
  size?: string;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'auto'], default: 'auto' })
  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'auto'])
  quality?: 'low' | 'medium' | 'high' | 'auto';

  @ApiPropertyOptional({ minimum: 1, maximum: 4, default: 1, description: '仅 GPT Image 支持多图' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  n?: number;

  @ApiPropertyOptional({ enum: ['png', 'jpeg', 'webp'], default: 'png', description: '仅 GPT Image 支持' })
  @IsOptional()
  @IsIn(['png', 'jpeg', 'webp'])
  outputFormat?: 'png' | 'jpeg' | 'webp';

  @ApiPropertyOptional({ enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: '仅 Gemini 支持' })
  @IsOptional()
  @IsIn(['1:1', '16:9', '9:16', '4:3', '3:4'])
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

  @ApiPropertyOptional({ enum: ['1K', '2K', '4K'], description: '仅 Gemini 支持' })
  @IsOptional()
  @IsIn(['1K', '2K', '4K'])
  imageSize?: '1K' | '2K' | '4K';
}

export class EditImageDto extends CreateImageGenerationDto {
  @ApiProperty({ type: ImageDataUrlDto, description: '待编辑原图' })
  @ValidateNested()
  @Type(() => ImageDataUrlDto)
  image!: ImageDataUrlDto;

  @ApiPropertyOptional({ type: ImageDataUrlDto, description: 'GPT Image 可选遮罩；透明区域表示允许编辑区域' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageDataUrlDto)
  mask?: ImageDataUrlDto;

  @ApiPropertyOptional({ enum: ['transparent', 'opaque', 'auto'], description: '仅 GPT Image 支持' })
  @IsOptional()
  @IsIn(['transparent', 'opaque', 'auto'])
  background?: 'transparent' | 'opaque' | 'auto';

  @ApiPropertyOptional({ enum: ['low', 'high'], description: '仅 GPT Image 支持，控制对原图细节的保真度' })
  @IsOptional()
  @IsIn(['low', 'high'])
  inputFidelity?: 'low' | 'high';

  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: '仅 JPEG/WebP 的 GPT Image 输出压缩率' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  outputCompression?: number;
}
