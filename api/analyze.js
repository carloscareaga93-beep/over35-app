const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

export default async function handler(req, res) {

  // CORS preflight
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
    return res.status(500).json({ error: 'API key no configurada en variables de entorno de Vercel.' });
  }

  const { home, away, date, league } = req.body;
  if (!home || !away) {
    return res.status(400).json({ error: 'Faltan parametros: home y away son requeridos.' });
  }

  const dateStr = date || 'proximo partido';
  const leagueStr = league || 'competicion';

  const prompt = `Analiza exhaustivamente el partido: ${home} vs ${away} | Fecha: ${dateStr} | Competicion: ${leagueStr}

Realiza TODAS estas busquedas web para obtener datos reales y actualizados:
1. "${home} statistics goals scored conceded 2024-25"
2. "${away} statistics goals scored conceded 2024-25"
3. "${home} last 5 matches results 2025"
4. "${away} last 5 matches results 2025"
5. "${home} injuries suspensions unavailable players March 2025"
6. "${away} injuries suspensions unavailable players March 2025"
7. "${home} ${away} head to head history results"
8. "${home} xG expected goals per game 2024-25"
9. "${away} xG expected goals per game 2024-25"
10. "${home} ${away} ${leagueStr} table standings 2025"

Con TODOS los datos reales encontrados, construye el siguiente analisis y responde UNICAMENTE con este JSON valido (sin texto extra, sin backticks, sin markdown):

{
  "verdict": {
    "score": 68,
    "level": "high",
    "title": "Titulo concreto y especifico del pronostico over 3.5 basado en datos reales",
    "summary": "3 oraciones explicando por que este es un escenario extraordinario over 3.5 basado en los datos reales encontrados. Menciona estadisticas concretas."
  },
  "probabilities": {
    "home_win": 40,
    "draw": 26,
    "away_win": 34,
    "over_35": 62,
    "btts": 67
  },
  "xg": {
    "home": "1.78",
    "home_sub": "xG real encontrado en busqueda con fuente",
    "away": "1.61",
    "away_sub": "xG real encontrado en busqueda con fuente"
  },
  "goals_avg": {
    "home": "2.1",
    "away": "1.7"
  },
  "lambda": {
    "value": "3.39",
    "sub": "lambda ${home} (ataque) x lambda ${away} (defensa) + inverso, modelo Poisson bivariante"
  },
  "form": {
    "home": {
      "results": ["W","W","D","L","W"],
      "text": "Descripcion detallada con resultados REALES y marcadores exactos de los ultimos 5 partidos del equipo local. Incluye goles marcados y recibidos en cada partido, rivales enfrentados y si fue local o visitante."
    },
    "away": {
      "results": ["W","L","W","W","D"],
      "text": "Descripcion detallada con resultados REALES y marcadores exactos de los ultimos 5 partidos del equipo visitante. Incluye goles marcados y recibidos en cada partido."
    }
  },
  "injuries": {
    "home": [
      {"name": "Nombre real del jugador", "status": "Tipo y gravedad real de la lesion o suspension"},
      {"name": "Otro jugador si aplica", "status": "Estado real"}
    ],
    "away": [
      {"name": "Nombre real del jugador", "status": "Tipo y gravedad real de la lesion o suspension"}
    ]
  },
  "scenario": {
    "title": "ESCENARIO EXTRAORDINARIO: titulo descriptivo especifico al partido",
    "body": "Minimo 150 palabras describiendo el escenario plausible de over 3.5 BASADO EN DATOS REALES ENCONTRADOS: vulnerabilidades defensivas reales documentadas con estadisticas, impacto concreto de las bajas en la linea defensiva (si un central clave esta lesionado o un portero titular), estilo de juego documentado de ambos equipos y como interactuan, momentos especificos del partido donde se esperan los goles segun el patron de juego real de estos equipos, por que este escenario esta por encima del consenso del mercado. Todo con base en datos reales encontrados en la busqueda web.",
    "tags": ["factor real 1", "factor real 2", "factor real 3", "factor real 4", "factor real 5"]
  },
  "tactical": "Minimo 120 palabras de analisis tactico basado en datos reales: formaciones documentadas que usan estos equipos, estadisticas reales de presion alta/baja, ritmo de juego, como el estilo ofensivo de un equipo explota las debilidades defensivas del otro segun estadisticas reales de la temporada, zonas especificas del campo donde se generan las oportunidades.",
  "h2h": "Minimo 80 palabras sobre historial real de enfrentamientos directos: ultimos 5-6 resultados con marcadores concretos, promedio de goles totales en este fixture historicamente, porcentaje de veces que se han visto mas de 2.5 o 3.5 goles en sus enfrentamientos, patron de juego historico entre estos dos equipos.",
  "context": "Minimo 80 palabras sobre contexto real actual: posicion exacta en la tabla con puntos reales, diferencia con zonas de ascenso/descenso/playoffs, necesidad urgente o no de puntos para cada equipo, etapa de la temporada, si hay partidos importantes proximos que puedan influir en la alineacion, historial reciente de este estadio.",
  "recommendation": "Minimo 120 palabras con recomendacion profesional y detallada: mercado especifico recomendado (over 3.5 goles / BTTS si/si / resultado exacto / doble oportunidad combinada), odds minimo recomendado para que tenga valor, justificacion del valor esperado positivo frente al consenso del mercado con datos concretos, nivel de confianza del 1 al 10 con justificacion numerica, porcentaje de bankroll sugerido segun el nivel de confianza, los 2-3 principales escenarios de riesgo que podrian anular el pronostico y como de probable son cada uno."
}

CRITICO: score 0-100 representa tu confianza en que el over 3.5 se da en este escenario extraordinario. level es high si score mayor a 60, medium si entre 40-60, low si menor a 40. USA EXCLUSIVAMENTE datos reales encontrados en las busquedas web. Reemplaza TODO valor de ejemplo con datos reales. JSON valido y completo, absolutamente nada mas.`;

  try {
    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Eres un analista de futbol de elite especializado en estadistica avanzada, modelos probabilisticos y mercados de apuestas deportivas. Tu fortaleza es identificar escenarios over 3.5 goles que el mercado mayoritario subestima. SIEMPRE realizas multiples busquedas web para obtener datos reales y actualizados antes de analizar. NUNCA inventas ni supones datos: si no encuentras algo, lo indicas claramente. Respondes UNICAMENTE con JSON valido y completo. Cero texto fuera del JSON. Sin backticks. Sin markdown. Solo el objeto JSON con todos los campos completos.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const responseText = await apiResponse.text();

    if (!apiResponse.ok) {
      return res.status(apiResponse.status).json({
        error: `Error API Anthropic: ${apiResponse.status} — ${responseText.substring(0, 400)}`
      });
    }

    let data;
    try { data = JSON.parse(responseText); }
    catch(e) { return res.status(500).json({ error: 'Respuesta invalida de Anthropic' }); }

    // Extraer texto de bloques (puede incluir tool_use blocks de web search)
    let rawText = '';
    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') rawText += block.text;
      }
    }

    if (!rawText) {
      return res.status(500).json({ error: 'Respuesta vacia. Stop reason: ' + (data.stop_reason || 'unknown') });
    }

    // Parsear JSON - 4 estrategias progresivas
    let parsed = null;

    try { parsed = JSON.parse(rawText.trim()); } catch(e) {}

    if (!parsed) {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) try { parsed = JSON.parse(match[0]); } catch(e) {}
    }

    if (!parsed) {
      const clean = rawText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      try { parsed = JSON.parse(clean); } catch(e) {}
      if (!parsed) {
        const m = clean.match(/\{[\s\S]*\}/);
        if (m) try { parsed = JSON.parse(m[0]); } catch(e) {}
      }
    }

    if (!parsed) {
      return res.status(500).json({ error: 'No se pudo parsear el JSON de la IA. Intenta de nuevo.' });
    }

    return res.status(200).json(parsed);

  } catch(err) {
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
}
