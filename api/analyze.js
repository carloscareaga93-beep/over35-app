const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

export default async function handler(req, res) {

  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key no configurada.' });
  }

  const { home, away, date, league } = req.body || {};
  if (!home || !away) {
    return res.status(400).json({ error: 'Faltan home y away.' });
  }

  const dateStr = date || 'proximo partido';
  const leagueStr = league || 'liga';

  // ── PASO 1: Recopilar datos con búsqueda web (respuesta libre) ──
  let researchData = '';
  try {
    const step1 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Eres un scout de futbol. Buscas datos reales en internet y los resumis en texto claro y organizado. Sin JSON, solo texto con los datos encontrados.',
        messages: [{
          role: 'user',
          content: `Busca datos reales sobre el partido ${home} vs ${away} del ${dateStr} en ${leagueStr}. Necesito:
1. Goles marcados y recibidos por partido esta temporada 2024-25 de cada equipo
2. Resultados reales de los ultimos 5 partidos de cada equipo con marcadores
3. Bajas, lesionados o suspendidos confirmados para este partido
4. xG por partido de cada equipo esta temporada
5. Posicion actual en la tabla con puntos
6. Historial reciente de enfrentamientos directos entre ambos

Busca "${home} form results 2025", "${away} form results 2025", "${home} ${away} injuries March 2025", "${home} ${away} head to head", "${home} xG 2024-25", "${away} xG 2024-25"`
        }]
      })
    });

    const step1Data = await step1.json();
    if (step1Data.content) {
      for (const block of step1Data.content) {
        if (block.type === 'text') researchData += block.text;
      }
    }
  } catch(e) {
    researchData = 'No se pudieron obtener datos externos. Usa conocimiento general sobre estos equipos.';
  }

  // ── PASO 2: Generar JSON estructurado basado en los datos ──
  try {
    const step2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: `Eres un generador de JSON para analisis de futbol. 
REGLA ABSOLUTA: Tu respuesta debe comenzar con { y terminar con }. 
NADA antes del {. NADA despues del }. 
Solo JSON puro. Ni una sola palabra fuera del JSON.`,
        messages: [{
          role: 'user',
          content: `Partido: ${home} vs ${away} | ${dateStr} | ${leagueStr}

DATOS REALES RECOPILADOS:
${researchData}

Con estos datos genera exactamente este JSON (empieza con { directamente):

{"verdict":{"score":65,"level":"high","title":"titulo especifico basado en datos reales","summary":"2-3 oraciones sobre el escenario over 3.5 extraordinario con estadisticas concretas de los datos recopilados"},"probabilities":{"home_win":40,"draw":26,"away_win":34,"over_35":61,"btts":66},"xg":{"home":"1.75","home_sub":"xG real de ${home} segun datos","away":"1.58","away_sub":"xG real de ${away} segun datos"},"goals_avg":{"home":"2.1","away":"1.7"},"lambda":{"value":"3.33","sub":"lambda total Poisson basada en estadisticas reales"},"form":{"home":{"results":["W","W","D","L","W"],"text":"ultimos 5 partidos reales de ${home} con marcadores y rivales"},"away":{"results":["W","L","W","W","D"],"text":"ultimos 5 partidos reales de ${away} con marcadores y rivales"}},"injuries":{"home":[{"name":"nombre real o Sin bajas confirmadas","status":"estado real"}],"away":[{"name":"nombre real o Sin bajas confirmadas","status":"estado real"}]},"scenario":{"title":"ESCENARIO EXTRAORDINARIO: titulo especifico","body":"minimo 130 palabras: escenario plausible over 3.5 basado en datos reales encontrados, vulnerabilidades defensivas reales, impacto de bajas, estilo de juego documentado, por que supera el consenso del mercado"},"tags":["factor1","factor2","factor3","factor4"],"tactical":"minimo 100 palabras analisis tactico real basado en datos encontrados","h2h":"minimo 70 palabras historial real de enfrentamientos con marcadores concretos","context":"minimo 70 palabras contexto real: posicion tabla, puntos, motivaciones actuales","recommendation":"minimo 100 palabras: mercado especifico, nivel confianza 1-10, unidades bankroll, riesgos principales"}`
        }, {
          role: 'assistant',
          content: '{'
        }]
      })
    });

    const step2Text = await step2.text();
    let step2Data;
    try { step2Data = JSON.parse(step2Text); }
    catch(e) { return res.status(500).json({ error: 'Error en paso 2: ' + step2Text.substring(0,200) }); }

    let rawText = '{';
    if (step2Data.content) {
      for (const block of step2Data.content) {
        if (block.type === 'text') rawText += block.text;
      }
    }

    // Parsear JSON
    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch(e) {}

    if (!parsed) {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) try { parsed = JSON.parse(match[0]); } catch(e) {}
    }

    if (!parsed) {
      // Intentar reparar JSON truncado
      let fixedText = rawText.trim();
      if (!fixedText.endsWith('}')) {
        const lastBrace = fixedText.lastIndexOf('}');
        if (lastBrace > 0) fixedText = fixedText.substring(0, lastBrace + 1);
      }
      try { parsed = JSON.parse(fixedText); } catch(e) {}
    }

    if (!parsed) {
      return res.status(500).json({ 
        error: 'Error parseando JSON final. Intenta de nuevo.',
        debug: rawText.substring(0, 300)
      });
    }

    return res.status(200).json(parsed);

  } catch(err) {
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
}
