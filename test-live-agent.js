import http from 'node:http';

async function runLiveTest() {
  const sessionId = 'test_react_' + Date.now();
  console.log(`================================================================`);
  console.log(`🚀 启动 ReAct Agent 真实端到端测试`);
  console.log(`📡 会话 ID: ${sessionId}`);
  console.log(`================================================================\n`);

  // 1. 先建立 SSE 订阅连接
  console.log('>>> 步骤 1: 正在建立 SSE 实时事件流连接...');
  const sseReq = http.get(`http://localhost:3000/api/agent/react/stream/${sessionId}`, (res) => {
    console.log('>>> SSE 连接成功建立，状态码:', res.statusCode);
    console.log('>>> 正在实时捕获真实 DeepSeek 模型响应与工具调用...\n');

    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split('\n');
        let event = 'message';
        let dataStr = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            event = line.replace('event: ', '').trim();
          } else if (line.startsWith('data: ')) {
            dataStr = line.replace('data: ', '').trim();
          }
        }

        try {
          const data = JSON.parse(dataStr);
          renderEvent(event, data);
        } catch {
          console.log(`[SSE: ${event}]`, dataStr);
        }

        if (event === 'finish' || event === 'abort' || event === 'error') {
          console.log('\n================================================================');
          console.log(`🎯 真实 Agent 执行终态已达成 [事件: ${event}]！`);
          console.log('================================================================');
          setTimeout(() => process.exit(0), 1000);
        }
      }
    });

    res.on('end', () => {
      console.log('>>> SSE 连接已关闭');
    });
  });

  sseReq.on('error', (err) => {
    console.error('SSE 连接异常:', err);
    process.exit(1);
  });

  // 等待 SSE 连接就绪后发起 POST 请求
  await new Promise((r) => setTimeout(r, 600));

  console.log('>>> 步骤 2: 发送真实 Agent 指令到 /api/agent/react/run ...');
  const userPrompt = '请使用 search_code 工具查找引用了 callDeepSeek 的所有代码文件，然后使用 read_file 工具读取其中一个文件的第一行代码，最后在回答中向我总结你的发现。';
  console.log(`💬 任务提示词: "${userPrompt}"\n`);

  const reqBody = JSON.stringify({
    sessionId,
    prompt: userPrompt,
    maxSteps: 5,
    autoCommit: false // 纯查询任务无需 commit
  });

  const postReq = http.request(
    'http://localhost:3000/api/agent/react/run',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(reqBody),
      },
    },
    (res) => {
      let respData = '';
      res.on('data', (c) => (respData += c));
      res.on('end', () => {
        console.log('>>> POST 任务接收响应:', respData.trim());
      });
    }
  );

  postReq.on('error', (err) => console.error('POST 请求错误:', err));
  postReq.write(reqBody);
  postReq.end();
}

function renderEvent(event, data) {
  const timestamp = new Date().toLocaleTimeString();
  switch (event) {
    case 'step':
      console.log(`\n------------------------------------------------------------`);
      console.log(`[${timestamp}] 🔄 进入第 ${data.step} 轮循环 (Step ${data.step})`);
      break;
    case 'think':
      console.log(`[${timestamp}] 🧠 模型思考/推理:`);
      console.log(`   ${data.text.trim().replace(/\n/g, '\n   ')}`);
      break;
    case 'tool_call':
      console.log(`[${timestamp}] 🛠️ 模型调用工具: [${data.name}]`);
      console.log(`   参数: ${JSON.stringify(data.args, null, 2).replace(/\n/g, '\n   ')}`);
      break;
    case 'tool_result':
      const outPreview = typeof data.output === 'string'
        ? data.output.slice(0, 180) + (data.output.length > 180 ? '...' : '')
        : JSON.stringify(data.output);
      console.log(`[${timestamp}] 📥 工具执行结果 [${data.name}]:`);
      console.log(`   ${outPreview.replace(/\n/g, '\n   ')}`);
      break;
    case 'finish':
      console.log(`\n[${timestamp}] ✅ 任务顺利完成！最终回复:`);
      console.log(`   ${(data.message || '').replace(/\n/g, '\n   ')}`);
      break;
    case 'error':
      console.error(`\n[${timestamp}] ❌ 执行出错:`, data.error);
      break;
    default:
      console.log(`[${timestamp}] [事件: ${event}]`, data);
  }
}

runLiveTest();
