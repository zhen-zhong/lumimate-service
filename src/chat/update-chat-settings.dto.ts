import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateChatSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  agentName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  agentProfile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  responseStyle?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  contextMessageLimit?: number;

}
