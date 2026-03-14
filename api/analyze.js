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

  try {
    // PASO 1: Investigacion web - texto libre
    const step1Res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Eres un scout de futbol. Buscas datos reales en internet. Respondes en texto claro organizado por puntos. Sin JSON.',
        messages: [{
          role: 'user',
          content: `Busca datos reales sobre: ${home} vs ${away} | ${dateStr} | ${leagueStr}

Necesito exactamente esto:
1. Promedio de goles marcados y recibidos por partido esta temporada de ${home}
2. Promedio de goles marcados y recibidos por partido esta temporada de ${away}  
3. Ultimos 5 resultados de ${home} con marcadores (ej: 2-1 vs X)
4. Ultimos 5 resultados de ${away} con marcadores
5. Lesionados y suspendidos de ${home} para este partido
6. Lesionados y suspendidos de ${away} para este partido
7. xG por partido de ${home} esta temporada
8. xG por partido de ${away} esta temporada
9. Posicion actual de ${home} en la tabla con puntos
10. Posicion actual de ${away} en la tabla con puntos
11. Ultimos 4 enfrentamientos directos entre ambos con marcadores`
        }]
      })
    });

    const step1Data = await step1Res.json();
    let research = '';
    if (step1Data.content) {
      for (const b of step1Data.content) {
        if (b.type === 'text') research += b.text;
      }
    }

    // PASO 2: Generar JSON con prefill forzado
    const step2Res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4500,
        system: 'Produces JSON valido solamente. Sin texto. Sin explicaciones. Sin markdown. Solo JSON.',
        messages: [
          {
            role: 'user',
            content: `Datos reales investigados sobre ${home} vs ${away} (${dateStr}, ${leagueStr}):

${research}

Usando esos datos reales, completa este JSON exactamente con esta estructura (reemplaza todos los valores de ejemplo con datos reales):

{
  "verdict": {
    "score": 65,
    "level": "high",
    "title": "ESCRIBE AQUI EL TITULO DEL PRONOSTICO",
    "summary": "ESCRIBE AQUI EL RESUMEN DE 2-3 ORACIONES CON DATOS REALES"
  },
  "probabilities": {
    "home_win": 40,
    "draw": 27,
    "away_win": 33,
    "over_35": 61,
    "btts": 66
  },
  "xg": {
    "home": "1.75",
    "home_sub": "DESCRIPCION XG LOCAL",
    "away": "1.58",
    "away_sub": "DESCRIPCION XG VISITANTE"
  },
  "goals_avg": {
    "home": "2.1",
    "away": "1.7"
  },
  "lambda": {
    "value": "3.33",
    "sub": "DESCRIPCION DEL LAMBDA"
  },
  "form": {
    "home": {
      "results": ["W","W","D","L","W"],
      "text": "DESCRIPCION DETALLADA FORMA LOCAL CON MARCADORES REALES"
    },
    "away": {
      "results": ["W","L","W","W","D"],
      "text": "DESCRIPCION DETALLADA FORMA VISITANTE CON MARCADORES REALES"
    }
  },
  "injuries": {
    "home": [{"name": "NOMBRE JUGADOR O Sin bajas confirmadas", "status": "ESTADO REAL"}],
    "away": [{"name": "NOMBRE JUGADOR O Sin bajas confirmadas", "status": "ESTADO REAL"}]
  },
  "scenario": {
    "title": "ESCENARIO EXTRAORDINARIO: TITULO ESPECIFICO",
    "body": "ESCRIBE AQUI MINIMO 130 PALABRAS DESCRIBIENDO EL ESCENARIO OVER 3.5 PLAUSIBLE BASADO EN DATOS REALES: vulnerabilidades defensivas reales, impacto de bajas, estilo de juego documentado, momentos del partido donde se esperan goles, por que supera el consenso del mercado",
    "tags": ["FACTOR REAL 1", "FACTOR REAL 2", "FACTOR REAL 3", "FACTOR REAL 4"]
  },
  "tactical": "ESCRIBE AQUI MINIMO 100 PALABRAS DE ANALISIS TACTICO REAL: sistemas de juego documentados, debilidades defensivas reales, como el estilo de cada equipo genera espacios y oportunidades de gol en este matchup especifico",
  "h2h": "ESCRIBE AQUI MINIMO 70 PALABRAS SOBRE HISTORIAL REAL: resultados concretos de enfrentamientos previos con marcadores, promedio de goles en este fixture, si suelen ser partidos abiertos",
  "context": "ESCRIBE AQUI MINIMO 70 PALABRAS SOBRE CONTEXTO REAL: posicion exacta en la tabla, puntos, necesidad de puntos, etapa de la temporada, factores motivacionales",
  "recommendation": "ESCRIBE AQUI MINIMO 100 PALABRAS DE RECOMENDACION: mercado especifico a apostar, odds minimo recomendado, nivel de confianza 1-10 con justificacion, porcentaje de bankroll, los 2-3 principales riesgos"
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

    // Parsear con multiples estrategias
    let parsed = null;

    // Estrategia 1: directo
    try { parsed = JSON.parse(rawJson); } catch(e) {}

    // Estrategia 2: extraer objeto JSON mas grande
    if (!parsed) {
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) try { parsed = JSON.parse(match[0]); } catch(e) {}
    }

    // Estrategia 3: reparar llaves faltantes
    if (!parsed) {
      let fixed = rawJson.trim();
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

    // Estrategia 4: limpiar caracteres invalidos y reintentar
    if (!parsed) {
      const cleaned = rawJson
        .replace(/[\x00-\x1F\x7F]/g, ' ')
        .replace(/,(\s*[}\]])/g, '$1')
        .trim();
      const match2 = cleaned.match(/\{[\s\S]*\}/);
      if (match2) try { parsed = JSON.parse(match2[0]); } catch(e) {}
    }

    if (!parsed) {
      return res.status(500).json({
        error: 'Error parseando JSON. Por favor intenta de nuevo.',
        debug: rawJson.substring(0, 500)
      });
    }

    // Validar y rellenar campos faltantes con defaults
    const safe = (obj, path, def) => {
      const keys = path.split('.');
      let cur = obj;
      for (const k of keys) {
        if (cur == null || typeof cur !== 'object') return def;
        cur = cur[k];
      }
      return cur != null ? cur : def;
    };

    const result = {
      verdict: {
        score: safe(parsed, 'verdict.score', 50),
        level: safe(parsed, 'verdict.level', 'medium'),
        title: safe(parsed, 'verdict.title', 'Análisis completado'),
        summary: safe(parsed, 'verdict.summary', 'Análisis basado en datos reales disponibles.')
      },
      probabilities: {
        home_win: safe(parsed, 'probabilities.home_win', 38),
        draw: safe(parsed, 'probabilities.draw', 27),
        away_win: safe(parsed, 'probabilities.away_win', 35),
        over_35: safe(parsed, 'probabilities.over_35', 50),
        btts: safe(parsed, 'probabilities.btts', 55)
      },
      xg: {
        home: safe(parsed, 'xg.home', '—'),
        home_sub: safe(parsed, 'xg.home_sub', 'xG por partido'),
        away: safe(parsed, 'xg.away', '—'),
        away_sub: safe(parsed, 'xg.away_sub', 'xG por partido')
      },
      goals_avg: {
        home: safe(parsed, 'goals_avg.home', '—'),
        away: safe(parsed, 'goals_avg.away', '—')
      },
      lambda: {
        value: safe(parsed, 'lambda.value', '—'),
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
        home: safe(parsed, 'injuries.home', []),
        away: safe(parsed, 'injuries.away', [])
      },
      scenario: {
        title: safe(parsed, 'scenario.title', 'Escenario extraordinario'),
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
    return res.status(500).json({ error: 'Error: ' + (err.message || 'desconocido') });
  }
}
