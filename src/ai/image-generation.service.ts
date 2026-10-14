import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetch as undiciFetch, FormData, ProxyAgent, type Dispatcher } from 'undici';

import { AiModelCatalogService } from './ai-model-catalog.service';
import type { CreateImageGenerationDto, EditImageDto, ImageDataUrlDto } from './dto/create-image-generation.dto';

const REQUEST_TIMEOUT_MS = 90_000;
const REQUEST_MAX_ATTEMPTS = 2;

type GeneratedImage = {
  mimeType: string;
  dataUrl: string;
};

type ImageProviderResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

type ImageGenerationInput = Omit<CreateImageGenerationDto, 'modelId'> & { modelId: string };
type ImageEditInput = Omit<EditImageDto, 'modelId'> & { modelId: string };

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
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
    const response = await this.request(`${baseUrl}/v1/images/generations`, {
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
    });
    if (!response.ok) throw new BadGatewayException(`图片生成服务失败（HTTP ${response.status}）`);

    return this.openAiResponseImages(response.body, input.outputFormat);
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

    const response = await this.request(`${baseUrl}/v1/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!response.ok) throw new BadGatewayException(`图片编辑服务失败（HTTP ${response.status}）`);
    return this.openAiResponseImages(response.body, input.outputFormat);
  }

  private async generateGeminiImage(baseUrl: string, apiKey: string, input: ImageGenerationInput) {
    const response = await this.request(`${baseUrl}/v1beta/models/${input.modelId}:generateContent`, {
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
    });
    if (!response.ok) throw new BadGatewayException(`图片生成服务失败（HTTP ${response.status}）`);

    return this.geminiResponseImages(response.body);
  }

  private async editGeminiImage(baseUrl: string, apiKey: string, input: ImageEditInput) {
    const source = this.dataUrlParts(input.image);
    const response = await this.request(`${baseUrl}/v1beta/models/${input.modelId}:generateContent`, {
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
    });
    if (!response.ok) throw new BadGatewayException(`图片编辑服务失败（HTTP ${response.status}）`);
    return this.geminiResponseImages(response.body);
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

  private async request(url: string, init: Parameters<typeof undiciFetch>[1]): Promise<ImageProviderResponse> {
    const { signal: _signal, ...requestInit } = init ?? {};
    let lastError: unknown;

    for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.fetch(url, {
          ...requestInit,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        // fetch 在收到响应头后就会返回。必须在重试范围内读完整个 body，
        // 否则图片响应下载超时会绕过重试并把 AbortError 直接返回给用户。
        const body = response.ok ? await response.json() : await response.text();
        if (response.status < 500 || attempt === REQUEST_MAX_ATTEMPTS) {
          return { ok: response.ok, status: response.status, body };
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }

      const message = lastError instanceof Error ? lastError.message : String(lastError);
      this.logger.warn(`图片上游请求失败，第 ${attempt} 次尝试：${url}，${message}`);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    this.logger.error(`图片上游请求最终失败：${url}`, message);
    throw new ServiceUnavailableException('图片生成上游网络不可用，请稍后重试');
  }
}
