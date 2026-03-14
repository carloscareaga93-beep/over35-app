const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const parseJSON = (raw) => {
  let parsed = null;
  try { parsed = JSON.parse(raw); return parsed; } catch(e) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) try { parsed = JSON.parse(match[0]); return parsed; } catch(e) {}
  // Reparar llaves faltantes
  let fixed = raw.trim();
  let open = 0, inStr = false, esc = false;
  for (const ch of fixed) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (!inStr) { if (ch === '{') open++; if (ch === '}') open--; }
  }
  while (open > 0) { fixed += '}'; open--; }
  try { parsed = JSON.parse(fixed); return parsed; } catch(e) {}
  return null;
};

const safe = (obj, path, def) => {
  try {
    let cur = obj;
    for (const k of path.split('.')) { if (cur == null) return def; cur = cur[k]; }
    return cur != null ? cur : def;
  } catch(e) { return def; }
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

  try {
    // ═══════════════════════════════════════════════════════
    // PASO 1 — Investigación exhaustiva con Sonnet + web search
    // ═══════════════════════════════════════════════════════
    const researchRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `Eres un analista de futbol de elite con acceso a datos reales en internet. 
Tu trabajo es investigar exhaustivamente y reportar SOLO datos verificados y concretos.
Nunca inventas estadisticas. Si no encuentras algo lo dices claramente.
Buscas multiples fuentes para cada dato importante.`,
        messages: [{
          role: 'user',
          content: `Necesito un informe de scouting completo y detallado para el partido:
${home} vs ${away} | ${dateStr} | ${leagueStr}

Realiza todas estas busquedas y reporta los datos encontrados:

1. Busca "${home} ${leagueStr} 2024-25 statistics goals" → reporta goles marcados, recibidos, promedio por partido
2. Busca "${away} ${leagueStr} 2024-25 statistics goals" → reporta goles marcados, recibidos, promedio por partido  
3. Busca "${home} last 5 results March 2025" → lista los 5 ultimos resultados con fecha, rival y marcador exacto
4. Busca "${away} last 5 results March 2025" → lista los 5 ultimos resultados con fecha, rival y marcador exacto
5. Busca "${home} injuries suspensions unavailable March 2025" → lista jugadores no disponibles con motivo
6. Busca "${away} injuries suspensions unavailable March 2025" → lista jugadores no disponibles con motivo
7. Busca "${home} xG expected goals 2024-25" → reporta xG por partido atacando y defendiendo
8. Busca "${away} xG expected goals 2024-25" → reporta xG por partido atacando y defendiendo
9. Busca "${home} vs ${away} head to head results history" → lista los ultimos 6 enfrentamientos con marcadores
10. Busca "${leagueStr} table standings 2025" → posicion actual de ambos equipos con puntos

Organiza el informe en secciones claras. Incluye numeros concretos. Diferencia lo que encontraste de lo que no encontraste.`
        }]
      })
    });

    const researchData = await researchRes.json();
    let research = '';
    if (researchData.content) {
      for (const b of researchData.content) {
        if (b.type === 'text') research += b.text;
      }
    }

    // ═══════════════════════════════════════════════════════
    // PASO 2 — Análisis profundo y generación JSON con Sonnet
    // ═══════════════════════════════════════════════════════
    const analysisRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        system: `Eres un analista cuantitativo de futbol especializado en mercados de apuestas deportivas y modelos probabilisticos.
Tu especialidad es identificar partidos con alta probabilidad de over 3.5 goles que el mercado mayoritario SUBESTIMA — escenarios extraordinarios pero perfectamente plausibles.
Produces JSON valido solamente. Sin texto previo ni posterior. Sin markdown. El JSON empieza con { y termina con }.`,
        messages: [
          {
            role: 'user',
            content: `PARTIDO A ANALIZAR: ${home} (LOCAL) vs ${away} (VISITANTE)
FECHA: ${dateStr} | COMPETICION: ${leagueStr}

INFORME DE SCOUTING CON DATOS REALES:
${research}

Basandote en estos datos reales, produce un analisis exhaustivo y profesional. El JSON debe contener analisis PROFUNDOS con datos concretos, no generalidades.

REGLAS CRITICAS:
- Cada campo de texto debe citar datos reales del informe de scouting
- El campo "body" del scenario debe tener MINIMO 200 palabras
- Los campos tactical, h2h, context, recommendation deben tener MINIMO 120 palabras cada uno
- Las probabilidades deben reflejar el modelo Poisson basado en los lambda reales encontrados
- El score debe ser tu estimacion honesta de la probabilidad de over 3.5 (0-100)
- Si el partido NO es candidato fuerte a over 3.5, di la verdad con score bajo

Estructura JSON requerida (completa todos los campos con datos reales):`,
          },
          {
            role: 'assistant',
            content: `{
  "verdict": {
    "score":`
          }
        ]
      })
    });

    const analysisData = await analysisRes.json();
    let rawJson = `{
  "verdict": {
    "score":`;
    if (analysisData.content) {
      for (const b of analysisData.content) {
        if (b.type === 'text') rawJson += b.text;
      }
    }

    const parsed = parseJSON(rawJson);

    if (!parsed) {
      return res.status(500).json({
        error: 'Error parseando JSON. Intenta de nuevo.',
        debug: rawJson.substring(0, 500)
      });
    }

    // Normalizar estructura garantizando todos los campos
    const result = {
      verdict: {
        score: safe(parsed, 'verdict.score', 50),
        level: (() => {
          const s = safe(parsed, 'verdict.score', 50);
          return s > 60 ? 'high' : s >= 40 ? 'medium' : 'low';
        })(),
        title: safe(parsed, 'verdict.title', 'Análisis completado'),
        summary: safe(parsed, 'verdict.summary', '—')
      },
      probabilities: {
        home_win: safe(parsed, 'probabilities.home_win', 38),
        draw: safe(parsed, 'probabilities.draw', 27),
        away_win: safe(parsed, 'probabilities.away_win', 35),
        over_35: safe(parsed, 'probabilities.over_35', 50),
        btts: safe(parsed, 'probabilities.btts', 55)
      },
      xg: {
        home: String(safe(parsed, 'xg.home', '—')),
        home_sub: safe(parsed, 'xg.home_sub', '—'),
        away: String(safe(parsed, 'xg.away', '—')),
        away_sub: safe(parsed, 'xg.away_sub', '—')
      },
      goals_avg: {
        home: String(safe(parsed, 'goals_avg.home', '—')),
        away: String(safe(parsed, 'goals_avg.away', '—'))
      },
      lambda: {
        value: String(safe(parsed, 'lambda.value', '—')),
        sub: safe(parsed, 'lambda.sub', 'Modelo Poisson bivariante')
      },
      form: {
        home: {
          results: safe(parsed, 'form.home.results', []),
          text: safe(parsed, 'form.home.text', '—')
        },
        away: {
          results: safe(parsed, 'form.away.results', []),
          text: safe(parsed, 'form.away.text', '—')
        }
      },
      injuries: {
        home: safe(parsed, 'injuries.home', [{ name: 'Sin datos confirmados', status: 'Verificar en medios oficiales' }]),
        away: safe(parsed, 'injuries.away', [{ name: 'Sin datos confirmados', status: 'Verificar en medios oficiales' }])
      },
      scenario: {
        title: safe(parsed, 'scenario.title', 'ESCENARIO EXTRAORDINARIO'),
        body: safe(parsed, 'scenario.body', '—'),
        tags: safe(parsed, 'scenario.tags', [])
      },
      tactical: safe(parsed, 'tactical', '—'),
      h2h: safe(parsed, 'h2h', '—'),
      context: safe(parsed, 'context', '—'),
      recommendation: safe(parsed, 'recommendation', '—')
    };

    return res.status(200).json(result);

  } catch(err) {
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
}
