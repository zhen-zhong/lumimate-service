import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class RegisterPushDeviceDto {
  @IsString()
  @MaxLength(512)
  @Matches(/^(?:ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/u, {
    message: 'expoPushToken 格式无效',
  })
  expoPushToken!: string;

  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';
}
