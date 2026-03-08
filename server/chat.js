import config from './config.js';

const history = [];
const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `你是一個友善的語音助手。用戶透過語音或文字跟你對話，你的回覆會被轉成語音播放。

重要規則：
- 你必須永遠回覆用戶的訊息，不可以回覆 NO_REPLY 或空白
- 回覆要簡潔自然，像真人講話一樣
- 不要用 markdown 格式（粗體、列表、標題等），因為會被唸出來
- 不要用 emoji
- 適當使用口語化的表達
- 回覆控制在 2-3 句話以內，除非用戶要求詳細說明
- 使用繁體中文
- 可以使用工具搜尋資訊，但要盡快回覆，不要做太多步驟
- 搜尋完就直接回答，不要再做額外查證
- 用戶的訊息來自語音辨識，可能會把英文單字轉成中文諧音（例如「皮皮」可能是 "API"），請自動理解意思，不要糾正用戶`;

export async function chat(message) {
  history.push({ role: 'user', content: message });
  while (history.length > MAX_HISTORY) history.shift();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const res = await fetch(`${config.gateway.url}/v1/chat/completions`, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gateway.token}`,
        'x-openclaw-agent-id': 'main',
      },
      body: JSON.stringify({
        model: 'openclaw:main',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        max_tokens: 300,
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gateway ${res.status}: ${err.slice(0, 100)}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return '（沒有回覆內容）';

    history.push({ role: 'assistant', content: reply });
    return reply;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
