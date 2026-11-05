import { Controller, Get, Header } from '@nestjs/common';

import { Public } from '../auth/public.decorator';

const supportPage = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="LumiMate 技术支持与联系方式" />
    <title>LumiMate 技术支持</title>
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; color: #14213d; background: #f4f7fc; }
      main { width: min(100% - 40px, 680px); margin: 0 auto; padding: 80px 0 56px; }
      .brand { color: #2879e6; font-size: 15px; font-weight: 700; letter-spacing: .04em; }
      h1 { margin: 12px 0 16px; font-size: clamp(32px, 7vw, 44px); letter-spacing: -.03em; }
      p { color: #56657d; font-size: 17px; line-height: 1.8; }
      .card { margin-top: 32px; padding: 28px; border: 1px solid #dfe7f4; border-radius: 24px; background: #fff; box-shadow: 0 12px 32px rgba(31, 67, 122, .08); }
      h2 { margin: 0 0 8px; font-size: 20px; }
      a { color: #1769d4; font-weight: 650; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .hint { margin-top: 22px; font-size: 14px; }
      footer { margin-top: 44px; color: #8090a9; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">LumiMate</div>
      <h1>技术支持</h1>
      <p>使用 LumiMate 时遇到问题、想提出建议，或需要协助处理账户与数据，请联系我们。</p>
      <section class="card">
        <h2>电子邮件</h2>
        <p><a href="mailto:1987857842@qq.com?subject=LumiMate%20技术支持">1987857842@qq.com</a></p>
        <p class="hint">来信请说明设备型号、系统版本、App 版本，以及问题出现的时间和步骤。请勿发送密码或验证码。</p>
      </section>
      <footer>© 2026 LumiMate</footer>
    </main>
  </body>
</html>`;

@Public()
@Controller('support')
export class SupportController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getSupportPage() {
    return supportPage;
  }
}
