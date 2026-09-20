import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetch as undiciFetch, FormData, ProxyAgent, type Dispatcher } from 'undici';

import { AiModelCatalogService } from './ai-model-catalog.service';
import type { CreateImageGenerationDto, EditImageDto, ImageDataUrlDto } from './dto/create-image-generation.dto';

const REQUEST_TIMEOUT_MS = 300_000;

type GeneratedImage = {
  mimeType: string;
  dataUrl: string;
};

type ImageGenerationInput = Omit<CreateImageGenerationDto, 'modelId'> & { modelId: string };
type ImageEditInput = Omit<EditImageDto, 'modelId'> & { modelId: string };

@Injectable()
export class ImageGenerationService {
  private readonly dispatcher?: Dispatcher;

  constructor(
    private readonly config: ConfigService,
    private readonly models: AiModelCatalogService,
  ) {
    const proxyUrl = config.get<string>('TEAMOROUTER_PROXY_URL')?.trim();
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  }

  async generate(input: ImageGenerationInput) {
    const { model, apiKey, baseUrl } = await this.resolveModel(input.modelId);
    const images = model.protocol === 'openai-images'
      ? await this.generateOpenAiImage(baseUrl, apiKey, input)
      : await this.generateGeminiImage(baseUrl, apiKey, input);

    if (!images.length) throw new BadGatewayException('图片模型未返回图片');
    return { modelId: model.id, modelLabel: model.label, images };
  }

  async edit(input: ImageEditInput) {
    const { model, apiKey, baseUrl } = await this.resolveModel(input.modelId);
    const images = model.protocol === 'openai-images'
      ? await this.editOpenAiImage(baseUrl, apiKey, input)
      : await this.editGeminiImage(baseUrl, apiKey, input);

    if (!images.length) throw new BadGatewayException('图片模型未返回图片');
    return { modelId: model.id, modelLabel: model.label, images };
  }

  private async resolveModel(modelId: string) {
    const model = await this.models.findEnabled(modelId, 'image-generation');
    if (!model) throw new ServiceUnavailableException('所选生图模型不存在或已停用');

    const apiKey = model.apiKeyEnv ? this.config.get<string>(model.apiKeyEnv)?.trim() : undefined;
    if (!apiKey) throw new ServiceUnavailableException(`未配置 ${model.apiKeyEnv ?? '图片模型 API Key'}`);
    const baseUrl = this.config.get<string>('TEAMOROUTER_BASE_URL')?.trim().replace(/\/$/, '')
      || 'https://api.teamorouter.com';
    return { model, apiKey, baseUrl };
  }

  private async generateOpenAiImage(baseUrl: string, apiKey: string, input: ImageGenerationInput) {
    const response = await this.fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.modelId,
        prompt: input.prompt,
        ...(input.size ? { size: input.size } : {}),
        ...(input.quality ? { quality: input.quality } : {}),
        ...(input.n ? { n: input.n } : {}),
        ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new BadGatewayException(`图片生成服务失败（HTTP ${response.status}）`);

    return this.openAiResponseImages(await response.json(), input.outputFormat);
  }

  private async editOpenAiImage(baseUrl: string, apiKey: string, input: ImageEditInput) {
    const form = new FormData();
    form.set('model', input.modelId);
    form.set('prompt', input.prompt);
    form.set('image', this.toImageBlob(input.image), 'image-input');
    if (input.mask) form.set('mask', this.toImageBlob(input.mask), 'image-mask');
    if (input.size) form.set('size', input.size);
    if (input.quality) form.set('quality', input.quality);
    if (input.n) form.set('n', String(input.n));
    if (input.outputFormat) form.set('output_format', input.outputFormat);
    if (input.outputCompression !== undefined) form.set('output_compression', String(input.outputCompression));
    if (input.background) form.set('background', input.background);
    if (input.inputFidelity) form.set('input_fidelity', input.inputFidelity);

    const response = await this.fetch(`${baseUrl}/v1/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new BadGatewayException(`图片编辑服务失败（HTTP ${response.status}）`);
    return this.openAiResponseImages(await response.json(), input.outputFormat);
  }

  private async generateGeminiImage(baseUrl: string, apiKey: string, input: ImageGenerationInput) {
    const response = await this.fetch(`${baseUrl}/v1beta/models/${input.modelId}:generateContent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          ...(input.aspectRatio || input.imageSize
            ? { imageConfig: { ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}), ...(input.imageSize ? { imageSize: input.imageSize } : {}) } }
            : {}),
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new BadGatewayException(`图片生成服务失败（HTTP ${response.status}）`);

    return this.geminiResponseImages(await response.json());
  }

  private async editGeminiImage(baseUrl: string, apiKey: string, input: ImageEditInput) {
    const source = this.dataUrlParts(input.image);
    const response = await this.fetch(`${baseUrl}/v1beta/models/${input.modelId}:generateContent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: input.prompt },
            { inlineData: { mimeType: source.mimeType, data: source.base64 } },
          ],
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          ...(input.aspectRatio || input.imageSize
            ? { imageConfig: { ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}), ...(input.imageSize ? { imageSize: input.imageSize } : {}) } }
            : {}),
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new BadGatewayException(`图片编辑服务失败（HTTP ${response.status}）`);
    return this.geminiResponseImages(await response.json());
  }

  private openAiResponseImages(body: unknown, outputFormat?: 'png' | 'jpeg' | 'webp') {
    const data = body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];
    return data.flatMap((item): GeneratedImage[] => {
      if (!item || typeof item !== 'object') return [];
      const image = item as { b64_json?: unknown; url?: unknown };
      if (typeof image.b64_json === 'string' && image.b64_json) {
        const mimeType = outputFormat === 'jpeg' ? 'image/jpeg' : `image/${outputFormat ?? 'png'}`;
        return [{ mimeType, dataUrl: `data:${mimeType};base64,${image.b64_json}` }];
      }
      if (typeof image.url === 'string' && /^https?:\/\//i.test(image.url)) {
        return [{ mimeType: 'image/png', dataUrl: image.url }];
      }
      return [];
    });
  }

  private geminiResponseImages(body: unknown) {
    const candidates = body && typeof body === 'object' && Array.isArray((body as { candidates?: unknown }).candidates)
      ? (body as { candidates: unknown[] }).candidates
      : [];
    return candidates.flatMap((candidate): GeneratedImage[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const content = (candidate as { content?: { parts?: unknown } }).content;
      if (!content || !Array.isArray(content.parts)) return [];
      return content.parts.flatMap((part): GeneratedImage[] => {
        if (!part || typeof part !== 'object') return [];
        const inlineData = (part as { inlineData?: { mimeType?: unknown; data?: unknown } }).inlineData;
        if (typeof inlineData?.mimeType !== 'string' || typeof inlineData.data !== 'string') return [];
        return [{ mimeType: inlineData.mimeType, dataUrl: `data:${inlineData.mimeType};base64,${inlineData.data}` }];
      });
    });
  }

  private dataUrlParts(image: ImageDataUrlDto) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
    if (!match) throw new BadGatewayException('图片数据格式无效');
    return { mimeType: match[1], base64: match[2] };
  }

  private toImageBlob(image: ImageDataUrlDto) {
    const { mimeType, base64 } = this.dataUrlParts(image);
    return new Blob([Buffer.from(base64, 'base64')], { type: mimeType });
  }

  private fetch(url: string, init: Parameters<typeof undiciFetch>[1]) {
    return undiciFetch(url, { ...init, dispatcher: this.dispatcher });
  }
}
