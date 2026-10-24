// Loaded only by the isolated test process through --import. Never used by normal startup.
import { appendFileSync } from 'node:fs';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (url !== 'https://api.deepseek.com/chat/completions') return realFetch(url, options);
  const request = JSON.parse(options.body),
    payload = JSON.parse(request.messages[1].content);
  appendFileSync(
    process.env.AI_TEST_LOG,
    JSON.stringify({
      request,
      bearerPresent: /^Bearer sk-/.test(options.headers.Authorization),
      redirect: options.redirect,
    }) + '\n',
  );
  if (payload.goal === 'simulate-service-error') return new Response('{}', { status: 401 });
  if (payload.goal === 'simulate-invalid-json')
    return Response.json({ choices: [{ message: { content: 'not json' } }] });
  let content;
  if (payload.request) content = { reply: `任务回复 ${request.messages.length}` };
  else if (payload.goal) {
    const date = new Date(Date.parse(payload.today) + 86400000).toISOString().slice(0, 10);
    const item =
      payload.goal === 'simulate-conflict'
        ? { ...payload.busy[0], title: '冲突建议' }
        : {
            date,
            start: '21:00',
            end: '22:00',
            title: '模拟 AI 学习建议',
            kind: 'study',
            done: true,
          };
    content = { items: [item], note: '这是一条测试建议，不代表真实 AI 输出。' };
  } else content = { summary: '这是模拟的月度总结，仅供测试。', suggestions: ['保持记录。'] };
  return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
};
