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

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    system,
    messages
  };
  if (webSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

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
  return text.trim();
};

const safe = (obj, path, def) => {
  try {
    const keys = path.split('.');
    let cur = obj;
    for (const k of keys) {
      if (cur == null) return def;
      cur = cur[k];
    }
    return cur != null ? cur : def;
  } catch(e) { return def; }
};

const parseJSON = (raw) => {
  let parsed = null;
  const attempts = [
    raw,
    raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim(),
    raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,' ').trim(),
  ];
  for (const attempt of attempts) {
    if (parsed) break;
    try { parsed = JSON.parse(attempt); break; } catch(e) {}
    const match = attempt.match(/\{[\s\S]*\}/);
    if (match) try { parsed = JSON.parse(match[0]); break; } catch(e) {}
  }
  // Reparar llaves faltantes
  if (!parsed) {
    let fixed = raw.trim();
    let open = 0, inStr = false, esc = false;
    for (const ch of fixed) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (ch === '{') open++;
        if (ch === '}') open--;
      }
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
    // ══════════════════════════════════════════
    // BLOQUE 1 — Forma reciente y estadísticas
    // ══════════════════════════════════════════
    const formaStats = await callClaude(KEY,
      'Eres un analista de datos deportivos. Buscas y reportas datos reales con precision. Formato: texto claro por puntos.',
      [{
        role: 'user',
        content: `Busca los datos mas recientes de la temporada 2024-25 para:

EQUIPO LOCAL: ${home}
- Busca: "${home} results 2025 League One"
- Busca: "${home} goals scored conceded per game 2024-25"
- Reporta: ultimos 5 partidos con fecha, rival, marcador y si fue local o visitante
- Reporta: promedio de goles marcados y recibidos por partido
- Reporta: posicion en la tabla ${leagueStr} con puntos exactos

EQUIPO VISITANTE: ${away}
- Busca: "${away} results 2025 League One"  
- Busca: "${away} goals scored conceded per game 2024-25"
- Reporta: ultimos 5 partidos con fecha, rival, marcador y si fue local o visitante
- Reporta: promedio de goles marcados y recibidos por partido
- Reporta: posicion en la tabla ${leagueStr} con puntos exactos`
      }],
      true
    );

    // ══════════════════════════════════════
    // BLOQUE 2 — Bajas y xG
    // ══════════════════════════════════════
    const bajasXG = await callClaude(KEY,
      'Analista deportivo. Reportas datos de lesiones y metricas avanzadas con precision.',
      [{
        role: 'user',
        content: `Busca informacion actualizada a marzo 2025 sobre:

BAJAS E INDISPONIBLES:
- Busca: "${home} injuries suspensions March 2025"
- Busca: "${away} injuries suspensions March 2025"
- Lista todos los jugadores no disponibles con motivo y fecha estimada de regreso
- Indica si alguna baja afecta especialmente la linea defensiva (centrales, portero)

METRICAS xG:
- Busca: "${home} xG expected goals 2024-25 season"
- Busca: "${away} xG expected goals 2024-25 season"
- Reporta xG por partido marcado y recibido de cada equipo
- Indica si el equipo marca mas o menos de lo esperado por sus xG`
      }],
      true
    );

    // ══════════════════════════════════════
    // BLOQUE 3 — H2H y contexto
    // ══════════════════════════════════════
    const h2hContext = await callClaude(KEY,
      'Analista deportivo. Reportas historial y contexto con datos concretos.',
      [{
        role: 'user',
        content: `Busca y reporta:

HISTORIAL DIRECTO:
- Busca: "${home} vs ${away} head to head history results"
- Lista los ultimos 5-6 enfrentamientos con fecha, marcador y competicion
- Calcula el promedio de goles totales en estos enfrentamientos
- Indica en cuantos de estos partidos hubo mas de 2.5 goles y mas de 3.5 goles

CONTEXTO ACTUAL:
- Busca: "${leagueStr} table standings March 2025"
- ¿Cuantos puntos separan a cada equipo de los playoffs y de la zona de descenso?
- ¿Que necesita cada equipo para este partido (ganar, un punto, etc)?
- ¿Hay algun partido importante proximo que pueda afectar la alineacion?
- ¿Como es el ambiente en cada club actualmente (presion del entrenador, aficion)?`
      }],
      true
    );

    // Consolidar toda la investigacion
    const fullResearch = `
=== FORMA RECIENTE Y ESTADISTICAS ===
${formaStats}

=== BAJAS, INDISPONIBLES Y xG ===
${bajasXG}

=== HISTORIAL H2H Y CONTEXTO ===
${h2hContext}
    `.trim();

    // ══════════════════════════════════════════════════
    // BLOQUE 4 — Generar JSON final con todos los datos
    // ══════════════════════════════════════════════════
    const step2Res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5000,
        system: 'Eres un generador de JSON. Tu output es UNICAMENTE JSON valido. Sin texto previo. Sin explicaciones. Sin markdown. Empiezas con { y terminas con }.',
        messages: [
          {
            role: 'user',
            content: `Partido: ${home} (LOCAL) vs ${away} (VISITANTE) | ${dateStr} | ${leagueStr}

DATOS REALES INVESTIGADOS:
${fullResearch}

Con estos datos reales construye el siguiente JSON. Usa SOLO datos encontrados en la investigacion. Si algo no esta disponible escribe "No disponible en fuentes consultadas".

El JSON debe tener EXACTAMENTE estas claves con estos tipos:

{
  "verdict": {
    "score": [numero 0-100 representando probabilidad over 3.5 en escenario extraordinario],
    "level": "[high si score mayor 60 / medium si 40-60 / low si menor 40]",
    "title": "[titulo especifico y concreto del pronostico basado en los datos]",
    "summary": "[3 oraciones explicando el escenario extraordinario over 3.5. Menciona estadisticas reales concretas encontradas. Por que este analisis supera el consenso del mercado.]"
  },
  "probabilities": {
    "home_win": [numero],
    "draw": [numero],
    "away_win": [numero],
    "over_35": [numero probabilidad over 3.5],
    "btts": [numero probabilidad ambos marcan]
  },
  "xg": {
    "home": "[numero xG real encontrado]",
    "home_sub": "[contexto del xG local: si sobre o sub-rinde respecto al xG]",
    "away": "[numero xG real encontrado]",
    "away_sub": "[contexto del xG visitante]"
  },
  "goals_avg": {
    "home": "[promedio goles marcados por partido local]",
    "away": "[promedio goles marcados por partido visitante]"
  },
  "lambda": {
    "value": "[suma lambda local + lambda visitante]",
    "sub": "Modelo Poisson: lambda ${home} + lambda ${away} ajustado por localía"
  },
  "form": {
    "home": {
      "results": ["W o D o L", "W o D o L", "W o D o L", "W o D o L", "W o D o L"],
      "text": "[descripcion detallada de los 5 ultimos partidos REALES de ${home} con rivales, marcadores exactos, goles marcados y recibidos en cada partido, tendencia reciente]"
    },
    "away": {
      "results": ["W o D o L", "W o D o L", "W o D o L", "W o D o L", "W o D o L"],
      "text": "[descripcion detallada de los 5 ultimos partidos REALES de ${away} con rivales, marcadores exactos, tendencia reciente]"
    }
  },
  "injuries": {
    "home": [
      {"name": "[nombre jugador real o Sin bajas confirmadas]", "status": "[lesion/suspension/duda con detalles]"}
    ],
    "away": [
      {"name": "[nombre jugador real o Sin bajas confirmadas]", "status": "[lesion/suspension/duda con detalles]"}
    ]
  },
  "scenario": {
    "title": "ESCENARIO EXTRAORDINARIO: [titulo descriptivo especifico al partido]",
    "body": "[MINIMO 150 PALABRAS. Describe el escenario plausible de over 3.5 basado en datos reales: 1) Que vulnerabilidades defensivas reales existen segun estadisticas, 2) Como las bajas afectan la solidez defensiva concretamente, 3) En que momentos especificos del partido se esperan los goles segun el patron real de juego de estos equipos, 4) Por que el mercado mayoritario subestima este partido, 5) Que combinacion de factores hace extraordinario este escenario. Todo fundamentado en los datos reales investigados.]",
    "tags": ["[factor clave 1 real]", "[factor clave 2 real]", "[factor clave 3 real]", "[factor clave 4 real]", "[factor clave 5 real]"]
  },
  "tactical": "[MINIMO 120 PALABRAS. Analisis tactico basado en datos reales: sistemas de juego documentados de cada equipo, estadisticas de ataque y defensa reales, como el estilo ofensivo de uno explota las debilidades del otro segun datos, zonas del campo donde se generan las oportunidades segun estadisticas, ritmo de juego esperado, como la necesidad de puntos puede abrir el partido tacticamente]",
  "h2h": "[MINIMO 80 PALABRAS. Historial real: lista los enfrentamientos encontrados con marcadores concretos, calcula el promedio real de goles en este fixture, porcentaje historico de partidos con mas de 2.5 y 3.5 goles entre ambos, patron de juego historico observable en este matchup]",
  "context": "[MINIMO 80 PALABRAS. Contexto real actual: posicion exacta de cada equipo en la tabla con puntos reales, diferencia con zonas de ascenso/descenso/playoffs, urgencia real de puntos para cada equipo, como esta urgencia puede afectar el planteamiento tactico y la apertura del partido, factores externos relevantes]",
  "recommendation": "[MINIMO 120 PALABRAS. Recomendacion profesional: 1) Mercado especifico recomendado con justificacion, 2) Odds minimo para que exista valor esperado positivo, 3) Nivel de confianza del 1 al 10 con justificacion numerica basada en los datos, 4) Porcentaje de bankroll recomendado segun el Kelly criterion aproximado, 5) Los 3 principales escenarios de riesgo que podrian invalidar el pronostico y probabilidad estimada de cada uno]"
}`
          },
          {
            role: 'assistant',
            content: '{'
          }
        ]
      })
    });

    const step2Data = await step2Res.json();
    let rawJson = '{';
    if (step2Data.content) {
      for (const b of step2Data.content) {
        if (b.type === 'text') rawJson += b.text;
      }
    }

    const parsed = parseJSON(rawJson);

    if (!parsed) {
      return res.status(500).json({
        error: 'Error parseando JSON final. Intenta de nuevo.',
        debug: rawJson.substring(0, 400)
      });
    }

    // Normalizar y garantizar estructura completa
    const result = {
      verdict: {
        score: safe(parsed, 'verdict.score', 55),
        level: safe(parsed, 'verdict.level', 'medium'),
        title: safe(parsed, 'verdict.title', 'Análisis completado con datos reales'),
        summary: safe(parsed, 'verdict.summary', 'Análisis basado en investigación de fuentes reales.')
      },
      probabilities: {
        home_win: safe(parsed, 'probabilities.home_win', 38),
        draw: safe(parsed, 'probabilities.draw', 27),
        away_win: safe(parsed, 'probabilities.away_win', 35),
        over_35: safe(parsed, 'probabilities.over_35', 52),
        btts: safe(parsed, 'probabilities.btts', 57)
      },
      xg: {
        home: String(safe(parsed, 'xg.home', '—')),
        home_sub: safe(parsed, 'xg.home_sub', 'xG por partido'),
        away: String(safe(parsed, 'xg.away', '—')),
        away_sub: safe(parsed, 'xg.away_sub', 'xG por partido')
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
        home: safe(parsed, 'injuries.home', [{ name: 'Sin datos disponibles', status: 'Consultar fuentes oficiales' }]),
        away: safe(parsed, 'injuries.away', [{ name: 'Sin datos disponibles', status: 'Consultar fuentes oficiales' }])
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
