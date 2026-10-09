import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class UpdateConversationSkillPluginDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^\d+\.\d+\.\d+$/u, { message: 'version 必须为语义版本，例如 1.0.0' })
  version?: string;

  @IsOptional()
  @IsInt()
  @Min(-100)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  memoryEnabled?: boolean;
}
