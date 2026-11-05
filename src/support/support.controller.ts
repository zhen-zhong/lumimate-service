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

function documentPage(input: { title: string; description: string; body: string }) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${input.description}" />
    <title>${input.title}｜LumiMate</title>
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; color: #14213d; background: #f4f7fc; }
      main { width: min(100% - 40px, 760px); margin: 0 auto; padding: 64px 0 56px; }
      .brand { color: #2879e6; font-size: 15px; font-weight: 700; letter-spacing: .04em; }
      h1 { margin: 12px 0 8px; font-size: clamp(32px, 7vw, 44px); letter-spacing: -.03em; }
      h2 { margin: 32px 0 8px; font-size: 20px; }
      p, li { color: #56657d; font-size: 16px; line-height: 1.8; }
      ul { margin: 8px 0; padding-left: 24px; }
      .updated { margin-top: 0; color: #8090a9; font-size: 14px; }
      .card { margin-top: 28px; padding: 28px; border: 1px solid #dfe7f4; border-radius: 24px; background: #fff; box-shadow: 0 12px 32px rgba(31, 67, 122, .08); }
      a { color: #1769d4; font-weight: 650; text-decoration: none; }
      a:hover { text-decoration: underline; }
      footer { margin-top: 44px; color: #8090a9; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">LumiMate</div>
      <h1>${input.title}</h1>
      <p class="updated">最近更新：2026 年 11 月 5 日</p>
      <section class="card">${input.body}</section>
      <footer>© 2026 LumiMate</footer>
    </main>
  </body>
</html>`;
}

const privacyPolicyPage = documentPage({
  title: '隐私政策',
  description: 'LumiMate 隐私政策',
  body: `
    <p>本政策说明 LumiMate 在提供陪伴对话、提醒、记忆和媒体功能时如何处理信息。使用 LumiMate 即表示你理解本政策。</p>
    <h2>我们处理的信息</h2>
    <ul>
      <li>你主动提交的聊天内容、图片、音频、视频及其相关上下文。</li>
      <li>你确认保存的长期记忆、陪伴偏好、提醒与任务信息。</li>
      <li>你主动在聊天中发送的位置；位置权限不会在后台持续用于追踪。</li>
      <li>在你允许通知后生成的推送令牌，用于发送你开启的提醒和陪伴通知。</li>
      <li>为维持游客会话生成的随机标识与访问凭据；我们不要求你提供姓名、邮箱或手机号。</li>
    </ul>
    <h2>我们如何使用信息</h2>
    <p>上述信息用于响应你的对话、生成或整理内容、保存你确认的记忆、发送提醒，以及保护服务安全和稳定。聊天内容及图片在请求回复或图片功能时，可能会发送至你所选功能对应的 AI 服务提供商处理。位置搜索与地图展示会调用地图服务提供商。推送会通过 Expo 的推送服务发送。</p>
    <h2>存储与保护</h2>
    <p>会话、记忆、提醒和媒体保存在 LumiMate 的服务基础设施中。媒体访问受会话鉴权保护。我们采取合理措施保护信息，但任何网络传输或存储方式都无法保证绝对安全。</p>
    <h2>你的控制权</h2>
    <p>候选记忆不会自动成为长期记忆。你可以在 App 的陪伴记忆页面确认、编辑、归档或删除记忆；归档和删除的记忆不会再注入后续对话。你也可以在系统设置中关闭位置、照片、麦克风和通知权限。</p>
    <h2>共享与不用于广告</h2>
    <p>我们不会出售你的个人信息，也不会将你的数据用于跨 App 或跨网站的定向广告。仅在提供上述 AI、地图、媒体存储和推送服务所必需时，才会向相应服务提供商传输必要信息。</p>
    <h2>删除请求与联系</h2>
    <p>如需请求删除与设备游客会话关联的数据，或对本政策有疑问，请发送邮件至 <a href="mailto:1987857842@qq.com?subject=LumiMate%20隐私请求">1987857842@qq.com</a>。请勿在邮件中发送密码、验证码或完整敏感聊天内容。</p>
  `,
});

const privacyChoicesPage = documentPage({
  title: '用户隐私选择',
  description: 'LumiMate 用户隐私选择与控制方式',
  body: `
    <p>LumiMate 不出售个人信息，也不提供基于跨 App 或跨网站活动的定向广告。以下是你可随时使用的隐私控制方式。</p>
    <h2>管理长期记忆</h2>
    <p>在 App 中进入「设置」→ 选择陪伴角色 →「陪伴记忆」，可以确认、编辑、归档或删除记忆。删除或归档后，该记忆不会再参与后续对话。</p>
    <h2>管理系统权限</h2>
    <p>在 iPhone 的「设置」→「LumiMate」中，可随时关闭照片、相机、麦克风、位置和通知权限。关闭后，相应功能将不再访问该类设备数据。</p>
    <h2>管理通知</h2>
    <p>在 App 的陪伴设置中可以关闭主动陪伴与提醒；也可以在系统设置中关闭通知。关闭后，我们不会再向该设备发送新的提醒通知。</p>
    <h2>管理图片生成上下文</h2>
    <p>在陪伴设置中关闭「图片生成参考上下文」后，图片生成只依据当前输入，不再参考角色档案与最近对话。</p>
    <h2>请求删除数据</h2>
    <p>如需删除与游客会话关联的数据，请发送邮件至 <a href="mailto:1987857842@qq.com?subject=LumiMate%20删除数据请求">1987857842@qq.com</a>。我们会说明完成核验所需的信息并处理你的请求。</p>
  `,
});

@Public()
@Controller('support')
export class SupportController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getSupportPage() {
    return supportPage;
  }

  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getPrivacyPolicy() {
    return privacyPolicyPage;
  }

  @Get('privacy-choices')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getPrivacyChoices() {
    return privacyChoicesPage;
  }
}
