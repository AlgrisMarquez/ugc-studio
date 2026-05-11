export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, imageType, prompt, stream } = req.body;

  if (!imageBase64 || !prompt) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key no configurada' });
  }

  // ── STREAMING ──
  if (stream) {
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'messages-2023-12-15',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          stream: true,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: imageType || 'image/jpeg', data: imageBase64 } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      if (!anthropicRes.ok) {
        const err = await anthropicRes.json();
        return res.status(anthropicRes.status).json({ error: err.error?.message || 'Error de API' });
      }

      // Pass-through SSE stream to client
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]' || data === 'event: message_stop') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                res.write(`data: ${JSON.stringify({ delta: { text: parsed.delta.text } })}\n\n`);
              }
            } catch {}
          }
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();

    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
      res.end();
    }

  } else {
    // ── NO STREAMING (fallback) ──
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: imageType || 'image/jpeg', data: imageBase64 } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      const data = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Error de API' });
      return res.status(200).json({ result: data.content?.[0]?.text || 'No se pudo generar el brief.' });

    } catch (error) {
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
}
