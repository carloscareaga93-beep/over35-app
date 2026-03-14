const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const callClaude = async (key, system, messages, webSearch = false) => {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01'
  };
  if (webSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';
  const body = { model: 'claude-haiku-4-5-20251001', max_tokens: 2500, system, messages };
  if (webSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await r.json();
  let text = '';
  if (data.content) for (const b of data.content) if (b.type === 'text') text += b.text;
  return text.trim();
};

const safe = (obj, path, def) => {
  try {
    let cur = obj;
    for (const k of path.split('.')) { if (cur == null) return def; cur = cur[k]; }
    return cur != null ? cur : def;
  } catch(e) { return def; }
};

const parseJSON = (raw) => {
  let parsed = null;
  const tries = [raw, raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()];
  for (const t of tries) {
    if (parsed) break;
    try { parsed = JSON.parse(t); break; } catch(e) {}
    const m = t.match(/\{[\s\S]*\}/);
    if (m) try { parsed = JSON.parse(m[0]); break; } catch(e) {}
  }
  if (!parsed) {
    let fixed = raw.trim();
    let open = 0, inStr = false, esc = false;
    for (const ch of fixed) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (!inStr) { if (ch === '{') open++; if (ch === '}') open--; }
    }
    while (open > 0) { fixed += '}'; open--; }
    try { parsed = JSON.parse(fixed); } catch(e) {}
  }
  return parsed;
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
    // BLOQUE 1: Forma + estadísticas + tabla
    const formaStats = await callClaude(KEY,
      'Scout deportivo. Reportas datos reales concisos. Maximo 400 palabras total.',
      [{ role: 'user', content: `Busca datos reales 2024-25: "${home} recent results ${leagueStr} 2025" y "${away} recent results ${leagueStr} 2025". Reporta: (1) ultimos 5 resultados de cada equipo con marcadores exactos, (2) promedio goles marcados/recibidos por partido, (3) posicion en tabla con puntos. Maximo 400 palabras.` }],
      true
    );

    // BLOQUE 2: Bajas + xG
    const bajasXG = await callClaude(KEY,
      'Scout deportivo. Reportas lesiones y xG reales. Maximo 300 palabras.',
      [{ role: 'user', content: `Busca: "${home} injuries suspensions March 2025" y "${away} injuries suspensions March 2025" y "${home} ${away} xG 2024-25". Reporta jugadores no disponibles con motivo, y xG por partido de cada equipo. Maximo 300 palabras.` }],
      true
    );

    // BLOQUE 3: H2H + contexto
    const h2hCtx = await callClaude(KEY,
      'Scout deportivo. Reportas H2H y contexto real. Maximo 300 palabras.',
      [{ role: 'user', content: `Busca: "${home} vs ${away} head to head" y contexto de la ${leagueStr} marzo 2025. Reporta: ultimos 4-5 enfrentamientos con marcadores, promedio goles H2H, situacion en tabla y necesidad de puntos de cada equipo. Maximo 300 palabras.` }],
      true
    );

    const research = `FORMA/ESTADISTICAS:\n${formaStats}\n\nBAJAS/xG:\n${bajasXG}\n\nH2H/CONTEXTO:\n${h2hCtx}`;

    // BLOQUE 4: JSON final
    const step2Res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 7000,
        system: 'Produces JSON valido unicamente. Sin texto previo ni posterior. Sin markdown. Empieza con { termina con }.',
        messages: [
          {
            role: 'user',
            content: `Partido: ${home} vs ${away} | ${dateStr} | ${leagueStr}

DATOS REALES:
${research}

Genera JSON completo con exactamente estas claves. Textos descriptivos, concretos, basados en datos reales encontrados:

{
  "verdict": {
    "score": 65,
    "level": "high",
    "title": "titulo concreto del pronostico over 3.5",
    "summary": "3 oraciones sobre el escenario extraordinario over 3.5 con estadisticas reales"
  },
  "probabilities": { "home_win": 40, "draw": 27, "away_win": 33, "over_35": 61, "btts": 66 },
  "xg": {
    "home": "1.75", "home_sub": "descripcion xG local real",
    "away": "1.58", "away_sub": "descripcion xG visitante real"
  },
  "goals_avg": { "home": "2.1", "away": "1.7" },
  "lambda": { "value": "3.33", "sub": "lambda ${home} + lambda ${away} modelo Poisson" },
  "form": {
    "home": { "results": ["W","W","D","L","W"], "text": "descripcion completa forma local con marcadores reales de cada partido, rivales, tendencia ofensiva/defensiva real" },
    "away": { "results": ["W","L","W","W","D"], "text": "descripcion completa forma visitante con marcadores reales, rivales, tendencia real" }
  },
  "injuries": {
    "home": [{"name": "jugador real", "status": "tipo lesion/suspension real"}],
    "away": [{"name": "jugador real", "status": "tipo lesion/suspension real"}]
  },
  "scenario": {
    "title": "ESCENARIO EXTRAORDINARIO: titulo especifico al partido",
    "body": "descripcion exhaustiva del escenario over 3.5: vulnerabilidades defensivas reales segun estadisticas, impacto concreto de bajas en la zaga, como el ritmo y estilo de juego de ambos equipos genera goles multiples, en que momentos del partido se esperan los tantos segun patron real, por que el mercado subestima este partido y como los datos contradicen las cuotas mayoritarias. Minimo 120 palabras con datos reales.",
    "tags": ["factor real 1", "factor real 2", "factor real 3", "factor real 4", "factor real 5"]
  },
  "tactical": "analisis tactico completo: formaciones reales documentadas, como el sistema ofensivo de cada equipo explota al rival, zonas de peligro reales, transiciones, ritmo de juego esperado segun estadisticas, impacto de la motivacion en el planteamiento. Minimo 100 palabras.",
  "h2h": "historial real completo: resultados de los ultimos enfrentamientos con marcadores concretos, promedio de goles en este fixture, en cuantos partidos hubo over 2.5 y over 3.5, patron historico observable entre ambos equipos. Minimo 70 palabras.",
  "context": "contexto real completo: posicion exacta en tabla con puntos, puntos sobre/bajo zona critica, que necesita cada equipo de este partido, como la presion de clasificacion puede afectar el planteamiento y abrir espacios, factores externos relevantes. Minimo 70 palabras.",
  "recommendation": "recomendacion profesional completa: mercado especifico recomendado con justificacion clara, odds minimo para valor positivo, nivel de confianza 1-10 con justificacion numerica, porcentaje de bankroll sugerido, los 3 principales riesgos con probabilidad estimada de cada uno. Minimo 100 palabras."
}`
          },
          { role: 'assistant', content: '{' }
        ]
      })
    });

    const step2Data = await step2Res.json();
    let rawJson = '{';
    if (step2Data.content) for (const b of step2Data.content) if (b.type === 'text') rawJson += b.text;

    const parsed = parseJSON(rawJson);
    if (!parsed) return res.status(500).json({ error: 'Error parseando JSON. Intenta de nuevo.', debug: rawJson.substring(0,400) });

    const result = {
      verdict: {
        score: safe(parsed,'verdict.score',55),
        level: safe(parsed,'verdict.level','medium'),
        title: safe(parsed,'verdict.title','Análisis completado'),
        summary: safe(parsed,'verdict.summary','Análisis basado en datos reales.')
      },
      probabilities: {
        home_win: safe(parsed,'probabilities.home_win',38),
        draw: safe(parsed,'probabilities.draw',27),
        away_win: safe(parsed,'probabilities.away_win',35),
        over_35: safe(parsed,'probabilities.over_35',52),
        btts: safe(parsed,'probabilities.btts',57)
      },
      xg: {
        home: String(safe(parsed,'xg.home','—')),
        home_sub: safe(parsed,'xg.home_sub','xG por partido'),
        away: String(safe(parsed,'xg.away','—')),
        away_sub: safe(parsed,'xg.away_sub','xG por partido')
      },
      goals_avg: { home: String(safe(parsed,'goals_avg.home','—')), away: String(safe(parsed,'goals_avg.away','—')) },
      lambda: { value: String(safe(parsed,'lambda.value','—')), sub: safe(parsed,'lambda.sub','Modelo Poisson bivariante') },
      form: {
        home: { results: safe(parsed,'form.home.results',[]), text: safe(parsed,'form.home.text','—') },
        away: { results: safe(parsed,'form.away.results',[]), text: safe(parsed,'form.away.text','—') }
      },
      injuries: {
        home: safe(parsed,'injuries.home',[{name:'Sin datos disponibles',status:'Consultar fuentes oficiales'}]),
        away: safe(parsed,'injuries.away',[{name:'Sin datos disponibles',status:'Consultar fuentes oficiales'}])
      },
      scenario: {
        title: safe(parsed,'scenario.title','ESCENARIO EXTRAORDINARIO'),
        body: safe(parsed,'scenario.body','—'),
        tags: safe(parsed,'scenario.tags',[])
      },
      tactical: safe(parsed,'tactical','—'),
      h2h: safe(parsed,'h2h','—'),
      context: safe(parsed,'context','—'),
      recommendation: safe(parsed,'recommendation','—')
    };

    return res.status(200).json(result);

  } catch(err) {
    return res.status(500).json({ error: 'Error: ' + (err.message || 'desconocido') });
  }
}
