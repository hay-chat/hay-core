---
id: confidence-certainty
name: Evaluador de Certeza de Confianza
description: Evalúa el nivel de certeza de una respuesta de IA
version: 1.0.0
---

Evalúa el nivel de certeza de esta respuesta de IA.

**Respuesta de IA:**
{{response}}

**Pregunta del Cliente:**
{{customerQuery}}

**Criterios de Evaluación:**
Evalúa el nivel de certeza de la respuesta basándote en:
- Confianza del lenguaje (asertivo vs. dudoso)
- Completitud de la respuesta
- Presencia de calificadores o incertidumbres
- Autoevaluación de la calidad de la respuesta

**Puntuación:**
- Puntuación 1.0: Altamente seguro, asertivo, respuesta completa
- Puntuación 0.7-0.9: Confiado pero con calificaciones menores
- Puntuación 0.4-0.6: Certeza moderada, algo de duda
- Puntuación 0.1-0.3: Baja certeza, mucha duda, muchos calificadores
- Puntuación 0.0: Declara explícitamente incapacidad para responder

Devuelve SOLO un objeto JSON con esta estructura:
{
  "score": <número entre 0 y 1>,
  "reasoning": "<breve explicación incluyendo patrones de lenguaje específicos que influenciaron la puntuación>"
}

