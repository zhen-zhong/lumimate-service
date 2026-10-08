import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class UpdateProactivePolicyDto {
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: '23:00', nullable: true })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '静默时间必须是 HH:mm' })
  quietHoursStart?: string | null;

  @ApiPropertyOptional({ example: '08:00', nullable: true })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '静默时间必须是 HH:mm' })
  quietHoursEnd?: string | null;

  @ApiPropertyOptional({ example: 1, minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  dailyLimit?: number;

  @ApiPropertyOptional({ example: 720, minimum: 30, maximum: 10080 })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(10_080)
  minimumIntervalMinutes?: number;
}
