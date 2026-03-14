const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'API key no configurada.' });

  const { home, away, date, league } = req.body || {};
  if (!home || !away) return res.status(400).json({ error: 'Faltan home y away.' });

  const dateStr = date || 'proximo partido';
  const leagueStr = league || 'liga';

  const callClaude = async (system, messages, useWebSearch = false) => {
    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system,
      messages
    };
    if (useWebSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01'
    };
    if (useWebSearch) {
      headers['anthropic-beta'] = 'web-search-2025-03-05';
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await r.json();
    let text = '';
    if (data.content) {
      for (const b of data.content) {
        if (b.type === 'text') text += b.text;
      }
    }
    return text;
  };

  try {
    // ── PASO 1: Investigación web ──
    const research = await callClaude(
      'Eres un scout de futbol. Buscas informacion real en internet y la resumis en puntos claros y concretos. Solo texto, sin JSON.',
      [{
        role: 'user',
        content: `Investiga el partido ${home} vs ${away} del ${dateStr} en ${leagueStr}. Busca y reporta:
- Goles marcados/recibidos por partido promedio esta temporada 2024-25
- Ultimos 5 resultados con marcadores exactos de cada equipo  
- Jugadores lesionados o suspendidos confirmados
- xG por partido esta temporada
- Posicion en la tabla con puntos
- Ultimos 3-4 enfrentamientos directos con marcadores`
      }],
      true
    );

    // ── PASO 2: JSON puro via prefill ──
    const jsonText = await callClaude(
      'Eres un generador de JSON. NUNCA escribes texto. SOLO produces JSON valido. Tu output comienza con { y termina con }. Absolutamente nada mas.',
      [
        {
          role: 'user',
          content: `Datos investigados sobre ${home} vs ${away} (${dateStr}, ${leagueStr}):\n\n${research}\n\nGenera el analisis completo como JSON. El objeto debe tener exactamente estas claves: verdict (con score numero 0-100, level string high/medium/low, title string, summary string), probabilities (home_win numero, draw numero, away_win numero, over_35 numero, btts numero), xg (home string, home_sub string, away string, away_sub string), goals_avg (home string, away string), lambda (value string, sub string), form (home con results array de W/D/L y text string, away igual), injuries (home array de objetos con name y status, away igual), scenario (title string, body string minimo 130 palabras, tags array de strings), tactical string minimo 100 palabras, h2h string minimo 70 palabras, context string minimo 70 palabras, recommendation string minimo 100 palabras. Usa los datos reales investigados. Empieza directamente con {`
        },
        {
          role: 'assistant',
          content: '{'
        }
      ],
      false
    );

    // Reconstruir JSON completo
    const fullJson = '{' + jsonText;

    // Intentar parsear con multiples estrategias
    let parsed = null;

    // Estrategia 1: directo
    try { parsed = JSON.parse(fullJson); } catch(e) {}

    // Estrategia 2: buscar el objeto mas grande
    if (!parsed) {
      const match = fullJson.match(/\{[\s\S]*\}/);
      if (match) try { parsed = JSON.parse(match[0]); } catch(e) {}
    }

    // Estrategia 3: reparar cierre incompleto
    if (!parsed) {
      let fixed = fullJson.trim();
      // Contar llaves para cerrar las que faltan
      let open = 0, inStr = false, escape = false;
      for (const ch of fixed) {
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (!inStr) {
          if (ch === '{') open++;
          if (ch === '}') open--;
        }
      }
      // Cerrar llaves faltantes
      while (open > 0) { fixed += '}'; open--; }
      try { parsed = JSON.parse(fixed); } catch(e) {}
    }

    if (!parsed) {
      return res.status(500).json({
        error: 'Error parseando JSON. Intenta de nuevo.',
        debug: fullJson.substring(0, 400)
      });
    }

    return res.status(200).json(parsed);

  } catch(err) {
    return res.status(500).json({ error: 'Error: ' + (err.message || 'desconocido') });
  }
}
